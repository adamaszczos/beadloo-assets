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
 * Sample-card and catalogue crops are the opposite of a pile — one strand of beads on a light card,
 * its soft grey shadow underneath — and take their own path (`estimateStrandColor`, below).
 *
 * Pure maths lives at the top (unit-testable, no I/O); the Sharp decode is at the bottom.
 */

import * as path from 'path';
import { getDownloadedBeadTypeDirectory } from './paths.js';

export type RGB = { r: number; g: number; b: number };

/** Finish-derived nudge. Built from `BeadInfo` by callers (see `colorHintsFromInfo`). */
export interface ColorHints {
  /**
   * Metallic / galvanized / plated bead whose colour lives in the mid-tones beneath a bright
   * specular sheen — but NOT a silver-lined bead (there the bright core is the colour). When set we
   * trim a larger bright tail so the sheen doesn't wash the body colour out. Not used on a strand
   * (see `STRAND_TRIM_BRIGHT`).
   */
  metallic?: boolean;
  /**
   * Whether the photo may be one strand on a sample card or catalogue page. Unset, it follows from
   * where the original lives (`mayBeStrandCrop`).
   */
  strandCrop?: boolean;
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

/** A blown near-neutral specular glint: bright AND desaturated. */
function isSpecular(p: Oklab): boolean {
  return p.L > SPEC_L && chroma(p) < SPEC_C;
}

function byLightness(x: Oklab, y: Oklab): number {
  return x.L - y.L;
}

/** The pixels without speculars, sorted by lightness; all of them when that would starve the estimate. */
function sortedWithoutSpeculars(pixels: Oklab[]): Oklab[] {
  const survivors = pixels.filter((p) => !isSpecular(p));
  return (survivors.length < pixels.length * MIN_SURVIVOR_FRACTION ? pixels.slice() : survivors).sort(byLightness);
}

/** Mean of lightness-sorted pixels from the dark trim up to the bright cut (both fractions of the count). */
function lightnessBandMean(sorted: Oklab[], darkTrim: number, brightCut: number): RGB {
  const lo = Math.floor(sorted.length * darkTrim);
  const hi = Math.max(lo + 1, Math.ceil(sorted.length * brightCut));
  return oklabToRgb255(meanOklab(sorted.slice(lo, hi)));
}

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

  const survivors = sortedWithoutSpeculars(pixels);

  // Size the dark trim from the gap/bead split, gated by how bimodal the crop is. A clear
  // bright-bead / dark-gap separation (large separation) trims the whole gap class so the light
  // body is recovered; a unimodal dark bead (small separation) is barely trimmed and stays dark.
  const { gapFraction, darkMean, brightMean } = otsuSplit(survivors.map((p) => p.L));
  const separation = brightMean - darkMean;
  const bimodality = Math.max(0, Math.min(1, (separation - SEP_LO) / (SEP_HI - SEP_LO)));
  const darkTrim = Math.max(DARK_TRIM_MIN, Math.min(DARK_TRIM_MAX, bimodality * (gapFraction + 0.05)));
  const brightHi = hints.metallic ? BRIGHT_HI_METALLIC : BRIGHT_HI;
  return lightnessBandMean(survivors, darkTrim, brightHi);
}

// ---------------------------------------------------------------------------
// strand estimator (sample-card and catalogue crops; pure: operates on an OKLab grid)
// ---------------------------------------------------------------------------
//
// A card crop is one strand of beads lying on a light card, with the strand's soft grey shadow
// under it. The pile path's centre square takes in card rows and that shadow band, and its bimodal
// dark trim then discards the beads themselves as "gaps": a dark olive strand came out #8b8c76, a
// cobalt one #69709a, a dark iris one near-white. So a strand is read from its bead rows alone.
// Bead rows are told from the shadow by horizontal texture: bead edges, holes and highlights make a
// bead row busy, while a shadow is a smooth ramp back to the card. Validated against Miyuki's
// directory heap photos of the same colour number (Delica cut swatches: median ΔE2000 21 → 10).
// The thresholds were tuned on Miyuki's crops at their own resolution (heights 49-282 px, median 75);
// texture and run lengths are measured in steps that grow with the image, so a photo of the same
// strand at twice the resolution reads the same (`strandStep`).

/** A decoded image as OKLab pixels, row-major. */
export interface OklabGrid {
  pixels: Oklab[];
  width: number;
  height: number;
}

/**
 * The height one texture step stands for: an image twice as tall measures texture over two pixels.
 * Resampling every crop to one height instead lost real strands (their card band squeezed to a row).
 */
const STRAND_REFERENCE_HEIGHT = 96;
/** Larger crops are decoded at this height: only to bound the work, the steps already keep the reading. */
export const STRAND_MAX_DECODE_HEIGHT = 384;
/**
 * Strands and catalogue swatch rows are at least 1.85 times as wide as tall; Miyuki's directory
 * photos are square. The margin below 1.85 is for a strand cut a little tight.
 */
export const STRAND_MIN_ASPECT = 1.75;
/** Too few rows to hold a band of card above a strand. */
const STRAND_MIN_GRID_HEIGHT = 12;
/** Card rows: light (a vignetted card reads as dark as L 0.73), near neutral, smooth. */
const CARD_MIN_L = 0.6;
const CARD_MAX_C = 0.035;
const CARD_SHARE = 0.9;
const CARD_MAX_TEXTURE = 0.006;
/** The card is looked for in the top rows only (a cell's frame line may sit above it). */
const CARD_SEARCH_FRACTION = 0.3;
/** A card row is judged without its ends, where a cell's frame line or the thread can sit. */
const CARD_EDGE_SKIP = 0.05;
/** Rows this close to the card colour measure the card's own texture (grain, JPEG noise). */
const CARD_ROW_DISTANCE = 0.03;
/** Rows and columns are measured away from the crop's ends (thread, the rounded end beads). */
const STRAND_CENTRE_MARGIN = 0.1;
/** A bead row is busier than the card's own texture by this factor, and never below the floor. */
const BEAD_ROW_TEXTURE_MIN = 0.008;
const BEAD_ROW_TEXTURE_FACTOR = 3;
/** Shorter runs are frame lines or noise; the run's outer rows show card between round beads. */
const BEAD_RUN_MIN_ROWS = 4;
const BEAD_RUN_MIN_FRACTION = 0.1;
const BEAD_RUN_INSET = 0.2;
/** A matte bead's smooth middle can dip under the texture floor for a row or two: bridge that. */
const BEAD_RUN_GAP = 2;
/**
 * A run of a coloured strand also takes the neighbouring rows that stay nearly as colourful (a matte
 * bead's smooth lower half); the grey shadow stops it. Not for near-neutral strands: their shadow
 * is as colourful as they are.
 */
const BEAD_RUN_EXTEND_MIN_CHROMA = 0.04;
const BEAD_RUN_EXTEND_SHARE = 0.75;
/**
 * Columns the strand covers: off the card, small gaps bridged, ends (thread) trimmed. A pale strand
 * barely differs from its card; the crop is cut to the strand, so its middle is used instead.
 */
const STRAND_COLUMN_OFF_CARD = 0.06;
const STRAND_MIN_SPAN = 0.3;
const STRAND_COLUMN_GAP = 0.02;
const STRAND_COLUMN_INSET = 0.04;
/**
 * Bead rows hold no inter-bead gaps, so a plain trimmed mean replaces the adaptive one. Metallic
 * beads get no extra sheen trim here: on strands it darkened them against their directory twins.
 */
const STRAND_TRIM_DARK = 0.1;
const STRAND_TRIM_BRIGHT = 0.9;
/**
 * When this share of a strand's pixels reads as specular, they are a white or pale bead's body, not
 * glints: dropping them left only the shaded edges (a white strand read as mid-grey).
 */
const STRAND_PALE_SPECULAR_SHARE = 0.4;

function oklabDistance(p: Oklab, q: Oklab): number {
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function pixelAt(grid: OklabGrid, x: number, y: number): Oklab {
  return grid.pixels[y * grid.width + x];
}

/** Pixels per texture step and per run row unit: 1 up to 1.5 × the reference height, 2 up to 2.5 × … */
export function strandStep(height: number): number {
  return Math.max(1, Math.round(height / STRAND_REFERENCE_HEIGHT));
}

function centreSpan(width: number): [number, number] {
  return [Math.floor(width * STRAND_CENTRE_MARGIN), Math.ceil(width * (1 - STRAND_CENTRE_MARGIN)) - 1];
}

/** Mean OKLab distance between pixels one texture step apart in a row, over columns [x0, x1). */
function rowTexture(grid: OklabGrid, y: number, x0: number, x1: number): number {
  const step = strandStep(grid.height);
  let total = 0;
  for (let x = x0; x < x1 - step; x++) total += oklabDistance(pixelAt(grid, x, y), pixelAt(grid, x + step, y));
  return total / Math.max(1, x1 - x0 - step);
}

function cardPixels(grid: OklabGrid, y: number): Oklab[] | null {
  const x0 = Math.floor(grid.width * CARD_EDGE_SKIP), x1 = Math.ceil(grid.width * (1 - CARD_EDGE_SKIP));
  if (rowTexture(grid, y, x0, x1) > CARD_MAX_TEXTURE) return null;
  const row: Oklab[] = [];
  for (let x = x0; x < x1; x++) row.push(pixelAt(grid, x, y));
  const light = row.filter((p) => p.L >= CARD_MIN_L && chroma(p) <= CARD_MAX_C);
  return light.length >= row.length * CARD_SHARE ? light : null;
}

/**
 * The card a strand lies on: the first two clean card rows near the top (a shadow falls downward,
 * so the top is the side that shows the card). Null when the image is not that wide or has no such
 * rows; a pile on a white background can still have them, so callers only ask about strand crops.
 */
export function findStrandCard(grid: OklabGrid): { color: Oklab; row: number } | null {
  if (grid.height < STRAND_MIN_GRID_HEIGHT || grid.width < grid.height * STRAND_MIN_ASPECT) return null;
  for (let y = 0; y + 1 < Math.floor(grid.height * CARD_SEARCH_FRACTION); y++) {
    const upper = cardPixels(grid, y);
    const lower = upper && cardPixels(grid, y + 1);
    if (!upper || !lower) continue;
    const light = [...upper, ...lower];
    return { color: { L: median(light.map((p) => p.L)), a: median(light.map((p) => p.a)), b: median(light.map((p) => p.b)) }, row: y + 1 };
  }
  return null;
}

function runsOf(on: boolean[], from: number): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = from; i <= on.length; i++) {
    if (i < on.length && on[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}

/** Runs merged where at most `gap` indices separate them (overlapping runs merge too). */
function bridgeRuns(runs: [number, number][], gap: number): [number, number][] {
  const bridged: [number, number][] = [];
  for (const run of [...runs].sort((x, y) => x[0] - y[0])) {
    const previous = bridged[bridged.length - 1];
    if (previous && run[0] - previous[1] - 1 <= gap) previous[1] = Math.max(previous[1], run[1]);
    else bridged.push([run[0], run[1]]);
  }
  return bridged;
}

function extendByChroma(run: [number, number], rowChroma: number[], top: number): [number, number] {
  const runChroma = median(rowChroma.slice(run[0], run[1] + 1));
  if (runChroma < BEAD_RUN_EXTEND_MIN_CHROMA) return run;
  const floor = runChroma * BEAD_RUN_EXTEND_SHARE;
  let [first, last] = run;
  while (first - 1 > top && rowChroma[first - 1] >= floor) first--;
  while (last + 1 < rowChroma.length && rowChroma[last + 1] >= floor) last++;
  return [first, last];
}

/** Rows below the card busier than the card itself (coloured strands: or as colourful), each run less its outer rows. */
export function strandBeadRows(grid: OklabGrid, card: { color: Oklab; row: number }): number[] {
  const [x0, last] = centreSpan(grid.width);
  const x1 = last + 1;
  const texture = Array.from({ length: grid.height }, (_, y) => rowTexture(grid, y, x0, x1));
  const rowChroma = Array.from({ length: grid.height }, (_, y) => {
    let total = 0;
    for (let x = x0; x < x1; x++) total += chroma(pixelAt(grid, x, y));
    return total / (x1 - x0);
  });
  const cardTexture = texture.filter((_, y) => {
    let distance = 0;
    for (let x = x0; x < x1; x++) distance += oklabDistance(pixelAt(grid, x, y), card.color);
    return distance / (x1 - x0) < CARD_ROW_DISTANCE;
  });
  const threshold = Math.max(BEAD_ROW_TEXTURE_MIN, BEAD_ROW_TEXTURE_FACTOR * median(cardTexture));
  const step = strandStep(grid.height);
  const busy = bridgeRuns(runsOf(texture.map((t) => t >= threshold), card.row + 1), BEAD_RUN_GAP * step);
  const rows: number[] = [];
  for (const [first, end] of bridgeRuns(busy.map((run) => extendByChroma(run, rowChroma, card.row)), 0)) {
    const length = end - first + 1;
    if (length < Math.max(BEAD_RUN_MIN_ROWS * step, grid.height * BEAD_RUN_MIN_FRACTION)) continue;
    const inset = Math.floor(length * BEAD_RUN_INSET);
    for (let y = first + inset; y <= end - inset; y++) rows.push(y);
  }
  return rows;
}

/** The longest run of columns off the card in the bead rows (a cell's frame line stands apart). */
export function strandBeadColumns(grid: OklabGrid, card: Oklab, rows: number[]): [number, number] {
  const off = Array.from({ length: grid.width }, (_, x) => {
    let distance = 0;
    for (const y of rows) distance += oklabDistance(pixelAt(grid, x, y), card);
    return distance / Math.max(1, rows.length) > STRAND_COLUMN_OFF_CARD;
  });
  const runs = bridgeRuns(runsOf(off, 0), Math.ceil(grid.width * STRAND_COLUMN_GAP));
  const longest = runs.reduce<[number, number] | null>((best, run) => (!best || run[1] - run[0] > best[1] - best[0] ? run : best), null);
  const [first, last] = longest && longest[1] - longest[0] >= grid.width * STRAND_MIN_SPAN ? longest : centreSpan(grid.width);
  const inset = Math.floor((last - first + 1) * STRAND_COLUMN_INSET);
  return [first + inset, last - inset];
}

/**
 * The body colour of a strand photographed on a card, from its bead rows only. Null when the image
 * is not one (a pile photo, or a strand too smooth to tell from its shadow, such as white enamel):
 * the caller then keeps the pile path.
 */
export function estimateStrandColor(grid: OklabGrid): RGB | null {
  const card = findStrandCard(grid);
  if (!card) return null;
  const rows = strandBeadRows(grid, card);
  if (rows.length === 0) return null;
  const [x0, x1] = strandBeadColumns(grid, card.color, rows);
  const pixels: Oklab[] = [];
  for (const y of rows) for (let x = x0; x <= x1; x++) pixels.push(pixelAt(grid, x, y));
  const pale = pixels.filter(isSpecular).length > pixels.length * STRAND_PALE_SPECULAR_SHARE;
  const sorted = pale ? pixels.slice().sort(byLightness) : sortedWithoutSpeculars(pixels);
  return lightnessBandMean(sorted, STRAND_TRIM_DARK, STRAND_TRIM_BRIGHT);
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

/** Bead types whose originals can be one strand cut from a sample card or catalogue page: Miyuki's. */
const STRAND_CROP_BEAD_TYPES = ['miyuki-delica', 'miyuki-round_rocailles'];

/**
 * Whether an original may be a strand crop, from where it lives. Every other brand photographs piles,
 * and TOHO's are 2:1, so a pile of pale beads on white can pass the card test (TOHO TR-03-53 did).
 */
export function mayBeStrandCrop(imagePath: string): boolean {
  const resolved = path.resolve(imagePath);
  return STRAND_CROP_BEAD_TYPES.some((beadType) => resolved.startsWith(getDownloadedBeadTypeDirectory(beadType) + path.sep));
}

/** Decode an image into an OKLab grid, at most `STRAND_MAX_DECODE_HEIGHT` rows (forced to sRGB, so always 3 bytes/pixel). */
async function decodeStrandGrid(imagePath: string): Promise<OklabGrid> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(imagePath, { limitInputPixels: false })
    .resize({ height: STRAND_MAX_DECODE_HEIGHT, withoutEnlargement: true })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels: Oklab[] = new Array(info.width * info.height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = rgb255ToOklab(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
  return { pixels, width: info.width, height: info.height };
}

/**
 * Decode a bead photo and return its robust true body colour (RGB 0..255): a strand crop on a card
 * from its bead rows (`hints.metallic` does not apply there), anything else (a pile) from the
 * centred crop. Never throws on odd inputs: degenerate photos fall back to a neutral grey.
 */
export async function sampleBaseColor(imagePath: string, hints: ColorHints = {}): Promise<RGB> {
  const sharp = (await import('sharp')).default;

  const meta = await sharp(imagePath, { limitInputPixels: false }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const strandCrop = hints.strandCrop ?? mayBeStrandCrop(imagePath);
  if (strandCrop && height > 0 && width >= height * STRAND_MIN_ASPECT) {
    const strand = estimateStrandColor(await decodeStrandGrid(imagePath));
    if (strand) return strand;
  }

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
