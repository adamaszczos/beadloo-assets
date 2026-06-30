/**
 * Shared, robust, perceptual bead-colour sampler.
 *
 * Single source of truth for "what colour is this bead?", consumed by BOTH the published
 * `colorMappings` hex (extract-colors.ts → what the Beadloo app fills preview cells with) and the
 * 16x16 render base colour (beadRender.ts `sampleBead`). It replaces the old approach of averaging
 * the *whole* multi-bead pile photo in gamma-encoded sRGB, which blended in the dark inter-bead
 * shadow gaps, the gray/white background, and the blown specular glints — making light beads
 * (silver-lined, AB, lustre) come out far too dark and muddy (champagne gold → brown, silvery green
 * → forest green).
 *
 * How it stays accurate (validated against magnified real beads, see PR notes):
 *  1. Sample a CENTRE CROP — the well-exposed, in-focus beads, which is exactly why the 48x48
 *     centre-crop derivative already looks right — not the whole frame.
 *  2. Work entirely in linear-light OKLab. Never average gamma-encoded sRGB (that darkens), and
 *     OKLab distances approximate the ΔE the result is judged by.
 *  3. ADAPTIVE TRIMMED MEAN over lightness: drop the dark inter-bead gaps (low-L tail) and the
 *     blown speculars (high-L tail), average the rest. The dark-trim fraction scales with the
 *     image's lightness spread, so a light bead sitting above dark gaps is lifted to its true
 *     luminous colour, while a genuinely dark bead (jet, cobalt) — which has no bright body to
 *     move toward — is left dark. Saturated beads keep their saturation because nothing is
 *     chroma-weighted away.
 *
 * The only finish hint that matters is metallic *glint*: galvanized/plated/metallic beads carry
 * their colour in the mid-tones under a bright specular sheen, so we trim a larger bright tail for
 * them. Silver-lined beads are NOT treated this way — their bright silver core *is* the colour.
 *
 * Pure maths lives at the top (unit-testable, no I/O); the Sharp decode is at the bottom.
 */

export type RGB = { r: number; g: number; b: number };

/** Finish-derived nudge. Built from `BeadInfo` by callers (see `colorHintsFromInfo`). */
export interface ColorHints {
  /**
   * Metallic / galvanized / plated bead whose colour lives in the mid-tones beneath a bright
   * specular sheen — but NOT a silver-lined bead (there the bright core is the colour). When set we
   * trim a larger bright tail so the sheen doesn't wash the body colour out.
   */
  metallic?: boolean;
}

// ---------------------------------------------------------------------------
// tunables (exposed so the verification harness can sweep them)
// ---------------------------------------------------------------------------

/** Fraction of the shorter image side kept as the centred sampling window. */
export const CROP_FRACTION = 0.6;
/** Working resolution the crop is resampled to before estimation. */
export const SAMPLE_N = 64;
/** Blown-specular cut: bright AND near-neutral (keeps bright *saturated* body pixels). */
const SPEC_L = 0.92;
const SPEC_C = 0.04;
/** Bright tail trimmed from the lightness-sorted survivors (more for metallic sheen). */
const BRIGHT_HI = 0.9;
const BRIGHT_HI_METALLIC = 0.76;
/**
 * Adaptive dark-tail trim. When the lightness histogram is clearly bimodal (bright beads sitting
 * above dark inter-bead gaps) we trim the whole gap class — sized by an Otsu split — so the light
 * body is recovered instead of muddied. When it is unimodal (a genuinely dark/uniform bead, where
 * gaps and body share a lightness) we trim almost nothing, leaving the bead dark. `bimodality`
 * ramps between the two from the between-class lightness separation.
 */
const DARK_TRIM_MIN = 0.12;
const DARK_TRIM_MAX = 0.75;
const SEP_LO = 0.08; // below this separation → treat as unimodal (trim little)
const SEP_HI = 0.3; // above this → fully bimodal (trim the gap class)
/** Minimum surviving fraction before we relax rejection rather than starve. */
const MIN_SURVIVOR_FRACTION = 0.05;
const HIST_BINS = 64;

// ---------------------------------------------------------------------------
// sRGB ⇄ linear ⇄ OKLab  (hand-rolled; fast + deterministic, no deps in the hot path)
// ---------------------------------------------------------------------------

export type Oklab = { L: number; a: number; b: number };

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** sRGB byte (0..255) triple → OKLab. */
export function rgb255ToOklab(r: number, g: number, b: number): Oklab {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/** OKLab → sRGB bytes (0..255), gamut-clamped into [0,255]. */
export function oklabToRgb255(c: Oklab): RGB {
  const l_ = c.L + 0.3963377774 * c.a + 0.2158037573 * c.b;
  const m_ = c.L - 0.1055613458 * c.a - 0.0638541728 * c.b;
  const s_ = c.L - 0.0894841775 * c.a - 1.291485548 * c.b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const to = (v: number): number => Math.max(0, Math.min(255, Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255)));
  return { r: to(lr), g: to(lg), b: to(lb) };
}

export function chroma(c: Oklab): number {
  return Math.hypot(c.a, c.b);
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1);
}

/** Build sampler hints from a classified bead (structural type to avoid a circular import). */
export function colorHintsFromInfo(info: { material: 'glass' | 'metal' | 'opaque'; silver: boolean }): ColorHints {
  return { metallic: info.material === 'metal' && !info.silver };
}

// ---------------------------------------------------------------------------
// estimator (pure: operates on an OKLab pixel list)
// ---------------------------------------------------------------------------

function meanOklab(pixels: Oklab[]): Oklab {
  let L = 0, a = 0, b = 0;
  for (const p of pixels) { L += p.L; a += p.a; b += p.b; }
  const n = Math.max(1, pixels.length);
  return { L: L / n, a: a / n, b: b / n };
}

/**
 * Otsu split of a lightness list: the threshold that maximises between-class variance, plus the
 * fraction below it (the dark "gap" class) and each class's mean lightness. Used to size the
 * adaptive dark trim and to gauge how bimodal (bead-vs-gap) the crop actually is.
 */
function otsuSplit(sortedL: number[]): { gapFraction: number; darkMean: number; brightMean: number } {
  const n = sortedL.length;
  const hist = new Array(HIST_BINS).fill(0) as number[];
  for (const L of sortedL) hist[Math.max(0, Math.min(HIST_BINS - 1, Math.floor(L * HIST_BINS)))]++;
  let total = 0;
  for (let i = 0; i < HIST_BINS; i++) total += i * hist[i];
  let wB = 0, sumB = 0, maxVar = -1, threshBin = 0;
  for (let i = 0; i < HIST_BINS; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (total - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; threshBin = i; }
  }
  const threshold = (threshBin + 1) / HIST_BINS;
  let below = 0, dSum = 0, bSum = 0, bCount = 0;
  for (const L of sortedL) {
    if (L < threshold) { below++; dSum += L; } else { bSum += L; bCount++; }
  }
  return {
    gapFraction: below / Math.max(1, n),
    darkMean: below > 0 ? dSum / below : 0,
    brightMean: bCount > 0 ? bSum / bCount : (n > 0 ? sortedL[n - 1] : 0),
  };
}

/**
 * Core estimator over an OKLab pixel list (no I/O — unit-testable).
 *
 * Rejects blown speculars, then takes an adaptive trimmed mean over lightness: the dark-tail trim
 * grows with the lightness spread so light beads are lifted off the dark gaps while genuinely dark
 * beads stay dark; the bright tail (and a wider one for metallic sheen) is dropped so highlights
 * don't wash the body colour out.
 */
export function estimateBodyColor(pixels: Oklab[], hints: ColorHints = {}): RGB {
  if (pixels.length === 0) return { r: 128, g: 128, b: 128 };

  // Drop blown near-neutral specular glints (bright AND desaturated). Never starve.
  let survivors = pixels.filter((p) => !(p.L > SPEC_L && chroma(p) < SPEC_C));
  if (survivors.length < pixels.length * MIN_SURVIVOR_FRACTION) survivors = pixels.slice();

  survivors.sort((x, y) => x.L - y.L);
  const n = survivors.length;

  // Size the dark trim from the gap/bead split, gated by how bimodal the crop is. A clear
  // bright-bead / dark-gap separation (large separation) trims the whole gap class so the light
  // body is recovered; a unimodal dark bead (small separation) is barely trimmed and stays dark.
  const { gapFraction, darkMean, brightMean } = otsuSplit(survivors.map((p) => p.L));
  const separation = brightMean - darkMean;
  const bimodality = Math.max(0, Math.min(1, (separation - SEP_LO) / (SEP_HI - SEP_LO)));
  const darkTrim = Math.max(DARK_TRIM_MIN, Math.min(DARK_TRIM_MAX, bimodality * (gapFraction + 0.05)));
  const brightHi = hints.metallic ? BRIGHT_HI_METALLIC : BRIGHT_HI;

  const lo = Math.floor(n * darkTrim);
  const hi = Math.max(lo + 1, Math.ceil(n * brightHi));
  return oklabToRgb255(meanOklab(survivors.slice(lo, hi)));
}

/**
 * Calibrate a rendered RGBA buffer (SS×SS, 4 channels) so the bead's covered-pixel area-average
 * equals `target`, by translating every covered pixel uniformly in OKLab. A uniform shift preserves
 * the 3D shading/specular/finish texture (those are relative variations around the mean) while
 * landing the mean on the true bead colour — undoing the systematic darkening the shader otherwise
 * introduces. Fully-transparent corner pixels (alpha 0) are ignored; partial edges are alpha-weighted.
 */
export function calibrateToTarget(buf: Buffer, target: RGB, iterations = 3): void {
  const t = rgb255ToOklab(target.r, target.g, target.b);
  // Iterate: a single uniform OKLab shift can push saturated/bright pixels out of sRGB gamut, where
  // they clamp and the clamped mean falls short of the target. Re-measuring and re-shifting the
  // residual converges the clamped mean onto the target (a few passes suffice).
  for (let iter = 0; iter < iterations; iter++) {
    let sL = 0, sa = 0, sb = 0, sw = 0;
    for (let o = 0; o + 3 < buf.length; o += 4) {
      const al = buf[o + 3];
      if (al === 0) continue;
      const c = rgb255ToOklab(buf[o], buf[o + 1], buf[o + 2]);
      const w = al / 255;
      sL += c.L * w; sa += c.a * w; sb += c.b * w; sw += w;
    }
    if (sw <= 0) return;
    const dL = t.L - sL / sw, da = t.a - sa / sw, db = t.b - sb / sw;
    if (Math.abs(dL) + Math.abs(da) + Math.abs(db) < 1e-4) break;
    for (let o = 0; o + 3 < buf.length; o += 4) {
      if (buf[o + 3] === 0) continue;
      const c = rgb255ToOklab(buf[o], buf[o + 1], buf[o + 2]);
      const rgb = oklabToRgb255({ L: c.L + dL, a: c.a + da, b: c.b + db });
      buf[o] = rgb.r; buf[o + 1] = rgb.g; buf[o + 2] = rgb.b;
    }
  }
}

// ---------------------------------------------------------------------------
// I/O entry point
// ---------------------------------------------------------------------------

/**
 * Decode the centred crop of a bead photo and return its robust true body colour (RGB 0..255).
 * Never throws on odd inputs: degenerate photos fall back to a neutral grey.
 */
export async function sampleBaseColor(imagePath: string, hints: ColorHints = {}): Promise<RGB> {
  const sharp = (await import('sharp')).default;

  const meta = await sharp(imagePath, { limitInputPixels: false }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  let pipeline = sharp(imagePath, { limitInputPixels: false });
  if (width > 0 && height > 0) {
    const side = Math.max(1, Math.floor(Math.min(width, height) * CROP_FRACTION));
    const left = Math.max(0, Math.floor((width - side) / 2));
    const top = Math.max(0, Math.floor((height - side) / 2));
    pipeline = pipeline.extract({ left, top, width: Math.min(side, width), height: Math.min(side, height) });
  }

  // Force sRGB so the raw buffer is always 3 bytes/pixel (a grayscale or CMYK source would otherwise
  // misalign the stride-of-3 reads below).
  const { data } = await pipeline
    .resize(SAMPLE_N, SAMPLE_N, { fit: 'fill' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels: Oklab[] = [];
  for (let i = 0; i + 2 < data.length; i += 3) {
    pixels.push(rgb255ToOklab(data[i], data[i + 1], data[i + 2]));
  }

  return estimateBodyColor(pixels, hints);
}

/** Convenience: robust true body colour as a `#rrggbb` hex string. */
export async function sampleBaseColorHex(imagePath: string, hints: ColorHints = {}): Promise<string> {
  const { r, g, b } = await sampleBaseColor(imagePath, hints);
  return rgbToHex(r, g, b);
}
