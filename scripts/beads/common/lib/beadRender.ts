/**
 * Single-bead thumbnail renderer.
 *
 * Renders a stylised-but-authentic bead into the 16x16 thumbnail space, driven by the bead's
 * own metadata (glassGroup / finish / shape / …) and a colour sampled from its source photo.
 * Replaces the old "centre-crop the pile photo" approach, which produced a muddy average.
 *
 * Shapes:    tube (Delica cylinder)        | round (rocailles / round seed beads)
 * Materials: glass | metal | opaque        (from glassGroup + finish)
 * Finishes:  matte, luster, lined, silver-lined, iris (multi-hue), picasso (earthy mottle),
 *            cornelian (white core), silk (satin streak)
 *
 * The bead fills the frame edge-to-edge with concave left/right ends that hint the hole openings,
 * composited on a dark background (JPEG has no alpha).
 */
import sharp from 'sharp';
import { sampleBaseColor, colorHintsFromInfo, calibrateToTarget } from './colorSampler.js';

export const RENDER_BG = '#0d0d0d';
const SS = 192; // supersample resolution; downscaled to 16 for clean anti-aliasing
const HALF = 1.0;

// ---------------------------------------------------------------------------
// metadata + classification
// ---------------------------------------------------------------------------

export interface BeadMetadata {
  glassGroup?: string;
  finish?: string;
  shape?: string;
  galvanized?: string;
  plating?: string;
  dyed?: string;
  colorGroup?: string;
  [key: string]: unknown;
}

export interface BeadInfo {
  material: 'glass' | 'metal' | 'opaque';
  shape: 'tube' | 'round';
  matte: boolean;
  luster: boolean;
  lined: boolean;
  silver: boolean;
  iris: boolean;
  picasso: boolean;
  cornelian: boolean;
  silk: boolean;
  alabaster: boolean;
}

export function classifyBead(m: BeadMetadata): BeadInfo {
  const g = String(m.glassGroup || '').toLowerCase();
  const f = String(m.finish || '').toLowerCase();
  const sh = String(m.shape || '').toLowerCase();
  const galvField = String(m.galvanized || '').toLowerCase();
  const galv = (/galvaniz/.test(galvField) && !/non/.test(galvField)) || /galvaniz|duracoat/.test(f);
  const plated = /plat/.test(String(m.plating || '').toLowerCase()) && !/non/.test(String(m.plating || '').toLowerCase());
  const silver = /silver-?line|silverline/.test(f);

  let material: BeadInfo['material'];
  if (g === 'metallic' || galv || plated || silver || /metallic|permalux|bronze|hematite|sfinx|solgel/.test(f)) material = 'metal';
  else if (g === 'transparent') material = 'glass';
  else material = 'opaque'; // Opaque, Alabaster, Silk, Other

  return {
    material,
    shape: /delica/.test(sh) ? 'tube' : 'round',
    matte: /frost|matte|semi-frost/.test(f),
    luster: /luster|ceylon|pearl/.test(f),
    lined: /lined|inside-color|copperline|goldline/.test(f),
    silver,
    iris: /rainbow|iris|\bab\b|aurora|magic color|harlequin|peacock|special coating/.test(f),
    picasso: /picasso|travertine|terra/.test(f),
    cornelian: /cornelian/.test(f),
    silk: g === 'silk' || /glass enamel/.test(f),
    alabaster: g === 'alabaster',
  };
}

// ---------------------------------------------------------------------------
// small maths helpers
// ---------------------------------------------------------------------------

type RGB = { r: number; g: number; b: number };
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
const c255 = (v: number): number => Math.max(0, Math.min(255, v));
const smooth = (e: number): number => { e = clamp(e); return e * e * (3 - 2 * e); };
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

function rrSDF(x: number, y: number, hx: number, hy: number, r: number): number {
  const qx = Math.abs(x) - (hx - r), qy = Math.abs(y) - (hy - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2; const d = mx - mn;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number): number => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function adjust(r: number, g: number, b: number, satMul: number, valMul: number): [number, number, number] {
  const [h, s, l] = rgb2hsl(r, g, b);
  return hsl2rgb(h, clamp(s * satMul), clamp(l * valMul));
}
function hash2(x: number, y: number): number { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return mix(mix(hash2(xi, yi), hash2(xi + 1, yi), u), mix(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
}
function fbm(x: number, y: number): number { return vnoise(x, y) * 0.6 + vnoise(x * 2.3, y * 2.3) * 0.3 + vnoise(x * 5.1, y * 5.1) * 0.1; }

interface ShapeDef { CR: number; INDENT: number; RC: number; KY: number; sphere: 0 | 1; }
const SHAPE: Record<'tube' | 'round', ShapeDef> = {
  tube: { CR: 0.05, INDENT: 0.13, RC: 0.50, KY: 0.42, sphere: 0 },
  round: { CR: 0.62, INDENT: 0.10, RC: 0.42, KY: 0.58, sphere: 1 },
};
function silSDF(x: number, y: number, S: ShapeDef): number {
  const s = rrSDF(x, y, HALF, HALF, S.CR);
  const cxR = HALF + S.RC - S.INDENT, cxL = -(HALF + S.RC - S.INDENT);
  return Math.max(s, -(Math.hypot(x - cxR, y * S.KY) - S.RC), -(Math.hypot(x - cxL, y * S.KY) - S.RC));
}

// ---------------------------------------------------------------------------
// colour + iridescence sampling from the source photo
// ---------------------------------------------------------------------------

export interface BeadSample {
  base: RGB;
  smoky?: RGB;        // dark body colour for iridescent beads
  irisStops?: number[]; // hue stops (0..1) spanning the iridescent range
  mottle?: RGB;       // earthy speckle colour for picasso beads
}

export async function sampleBead(src: string, info: BeadInfo): Promise<BeadSample> {
  // The body colour now comes from the shared robust sampler (centre-crop, OKLab, adaptive trimmed
  // mean) — the single source of truth shared with the published `colorMappings` hex.
  const base: RGB = await sampleBaseColor(src, colorHintsFromInfo(info));
  const out: BeadSample = { base };

  // Iridescence (iris) and earthy mottle (picasso) need extra colour cues — a dark body tone, the
  // dominant hue spread, and the darkest speckle — that the single base colour can't carry. Only
  // these finishes pay for the second decode pass; every other bead is done above.
  if (!info.iris && !info.picasso) return out;

  const N = 56;
  // Force sRGB so the raw buffer is always 3 bytes/pixel: a grayscale (1ch) or CMYK (4ch) source
  // would otherwise misalign the stride-of-3 reads below (poisoning the average with NaN or wrong hues).
  const { data } = await sharp(src, { limitInputPixels: false }).resize(N, N, { fit: 'fill' }).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let dr = 0, dg = 0, db = 0, dn = 0;
  let darkest: [number, number, number] = [999, 999, 999];
  const hueW = new Array(360).fill(0) as number[];
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const br = (r + g + b) / 3;
    if (br < 16 || br > 244) continue;
    if (br < 150) { dr += r; dg += g; db += b; dn++; }
    if (br < (darkest[0] + darkest[1] + darkest[2]) / 3) darkest = [r, g, b];
    const [h, s] = rgb2hsl(r, g, b);
    if (s > 0.18) hueW[Math.round(h * 360) % 360] += s;
  }
  if (info.iris) {
    out.smoky = dn ? { r: dr / dn, g: dg / dn, b: db / dn } : base;
    const sm = hueW.map((_, i) => { let s = 0; for (let d = -8; d <= 8; d++) s += hueW[(i + d + 360) % 360]; return s; });
    let peak = 0;
    for (let i = 0; i < 360; i++) if (sm[i] > sm[peak]) peak = i;
    out.irisStops = [-70, -23, 23, 70].map((d) => (((peak + d) % 360 + 360) % 360) / 360);
  }
  if (info.picasso) {
    // `darkest` keeps its sentinel when no pixel was in range — fall back to a darkened base.
    out.mottle = darkest[0] <= 255 ? { r: darkest[0], g: darkest[1], b: darkest[2] } : { r: base.r * 0.6, g: base.g * 0.6, b: base.b * 0.6 };
  }
  return out;
}

// ---------------------------------------------------------------------------
// material parameters
// ---------------------------------------------------------------------------

interface MatParams {
  ambient: number; shin: number; spec: number; bands: number; transl: number;
  edgeSat: number; edgeDark: number; botRim: number; contrast: number; grain: number; desatTop?: number;
}
function matParams(info: BeadInfo): MatParams {
  const table: Record<BeadInfo['material'], MatParams> = {
    glass: { ambient: 0.52, shin: 200, spec: 0.85, bands: 1, transl: 0.5, edgeSat: 0.6, edgeDark: 0.40, botRim: 0.45, contrast: 1.0, grain: 0.02 },
    metal: { ambient: 0.32, shin: 60, spec: 1.1, bands: 3, transl: 0.0, edgeSat: 0.2, edgeDark: 0.30, botRim: 0.25, contrast: 1.22, grain: 0.03 },
    opaque: { ambient: 0.50, shin: 34, spec: 0.5, bands: 1, transl: 0.0, edgeSat: 0.12, edgeDark: 0.22, botRim: 0.18, contrast: 1.0, grain: 0.03 },
  };
  const P: MatParams = { ...table[info.material] };
  if (info.matte) { P.spec *= 0.16; P.ambient = Math.min(0.64, P.ambient + 0.1); P.grain = 0.06; P.botRim *= 0.4; P.contrast *= 0.8; }
  if (info.luster) { P.spec *= 0.72; P.transl = Math.max(P.transl, 0.22); P.desatTop = 0.4; }
  return P;
}

// ---------------------------------------------------------------------------
// the renderer — returns an SSxSS RGBA buffer
// ---------------------------------------------------------------------------

export function renderBead(sample: BeadSample, info: BeadInfo): Buffer {
  const S = SHAPE[info.shape];
  const P = matParams(info);
  const base0: RGB = info.iris && sample.smoky ? sample.smoky : sample.base;
  const buf = Buffer.alloc(SS * SS * 4);
  const aaPx = (1.5 / SS) * 2;
  const ly = -0.5, lz = 0.866;
  const hN = Math.hypot(ly, lz + 1); const hyV = ly / hN, hzV = (lz + 1) / hN;
  const stops = sample.irisStops;
  const hueAt = (t: number): number => {
    if (!stops) return 0;
    t = clamp(t) * (stops.length - 1);
    const i = Math.floor(t), fr = t - i;
    let a = stops[i], b = stops[Math.min(stops.length - 1, i + 1)];
    if (b - a > 0.5) b -= 1; if (a - b > 0.5) b += 1;
    return (a + (b - a) * fr + 1) % 1;
  };

  for (let py = 0; py < SS; py++) {
    for (let px = 0; px < SS; px++) {
      const x = ((px + 0.5) / SS) * 2 - 1, y = ((py + 0.5) / SS) * 2 - 1;
      const sdf = silSDF(x, y, S);
      const cover = clamp(0.5 - sdf / aaPx);
      const o = (py * SS + px) * 4;
      if (cover <= 0) { buf[o + 3] = 0; continue; }
      const ed = -sdf, edgeFade = smooth(ed / 0.12);
      let nx: number, ny: number, nz: number, rad: number;
      const v = clamp(y / HALF, -1, 1), u = clamp(x / HALF, -1, 1);
      if (S.sphere) {
        const r2 = u * u + v * v; const z = Math.sqrt(Math.max(0.02, 1 - r2));
        const n = Math.hypot(u, v, z) || 1; nx = u / n; ny = v / n; nz = z / n; rad = Math.min(1, Math.sqrt(r2));
      } else {
        nz = Math.sqrt(Math.max(0, 1 - v * v)); nx = 0; ny = v; rad = Math.abs(v);
      }
      const diff = Math.max(0, ny * ly + nz * lz);
      const midTone = P.ambient + 0.5 * (1 - P.ambient);
      const tone = midTone + ((P.ambient + diff * (1 - P.ambient)) - midTone) * P.contrast;
      const [br, bg, bb] = adjust(base0.r, base0.g, base0.b, 1 + P.edgeSat * rad * rad, 1 - P.edgeDark * rad * rad);
      let R = br * tone, G = bg * tone, B = bb * tone;
      if (P.transl > 0) {
        const core = (1 - rad * rad) * P.transl;
        R = mix(R, 255, core * 0.28) + br * core * 0.2;
        G = mix(G, 255, core * 0.28) + bg * core * 0.2;
        B = mix(B, 255, core * 0.28) + bb * core * 0.2;
      }
      const ndoth = Math.max(0, ny * hyV + nz * hzV);
      const capFade = S.sphere ? 1 : smooth((HALF - Math.abs(x)) / 0.34);
      let spec = Math.pow(ndoth, P.shin) * P.spec * capFade;
      if (P.bands >= 3 && !S.sphere) {
        const b2 = Math.pow(Math.max(0, ny * 0.7 + nz * 0.7), P.shin * 0.5) * P.spec * 0.5 * capFade;
        const b3 = Math.exp(-(((ny + 0.78) / 0.10) ** 2)) * P.spec * 0.55 * capFade;
        spec = Math.min(1.4, spec + b2 + b3);
      }
      const isMetal = info.material === 'metal';
      const sR = isMetal ? Math.min(255, br * 1.3 + 80) : 255;
      const sG = isMetal ? Math.min(255, bg * 1.3 + 80) : 255;
      const sB = isMetal ? Math.min(255, bb * 1.3 + 80) : 255;
      const sp = Math.min(1, spec);
      R += (sR - R) * sp; G += (sG - G) * sp; B += (sB - B) * sp;
      if (P.botRim > 0) {
        const brim = Math.exp(-(((ny - 0.92) / 0.08) ** 2)) * P.botRim * capFade;
        const t: [number, number, number] = info.material === 'glass'
          ? [Math.min(255, br * 1.6 + 40), Math.min(255, bg * 1.6 + 40), Math.min(255, bb * 1.6 + 40)]
          : [255, 255, 255];
        R += (t[0] - R) * brim; G += (t[1] - G) * brim; B += (t[2] - B) * brim;
      }
      // lined / silver bright core
      if (info.silver || info.lined) {
        const coreAmt = info.silver ? 0.5 : 0.28;
        const cg = (1 - rad * 1.1) * coreAmt;
        if (cg > 0) {
          const cc: [number, number, number] = info.silver
            ? [235, 238, 245]
            : [Math.min(255, br * 1.5 + 50), Math.min(255, bg * 1.5 + 50), Math.min(255, bb * 1.5 + 50)];
          R = mix(R, cc[0], clamp(cg)); G = mix(G, cc[1], clamp(cg)); B = mix(B, cc[2], clamp(cg));
        }
      }
      // cornelian white core
      if (info.cornelian) {
        const cd = S.sphere ? rad : Math.abs(v);
        const core = smooth((0.5 - cd) / 0.5);
        R = mix(R, 250, core * 0.8); G = mix(G, 248, core * 0.8); B = mix(B, 244, core * 0.8);
      }
      // iris multi-hue sheen
      if (info.iris && stops) {
        const pos = clamp(0.5 + v * 0.5 + (1 - nz) * 0.25);
        const [ir, ig, ib] = hsl2rgb(hueAt(pos), 0.85, 0.6);
        const amt = clamp((0.3 + spec * 1.3 + Math.pow(1 - nz, 3) * 0.5) * 0.9);
        R += ir * amt * 0.85; G += ig * amt * 0.85; B += ib * amt * 0.85;
      }
      // picasso earthy mottle
      if (info.picasso && sample.mottle) {
        const nval = fbm(x * 3.2 + 7, y * 3.2 + 3);
        const m = smooth((nval - 0.42) / 0.3);
        R = mix(R, sample.mottle.r * 0.85, m * 0.6 * edgeFade);
        G = mix(G, sample.mottle.g * 0.85, m * 0.6 * edgeFade);
        B = mix(B, sample.mottle.b * 0.85, m * 0.6 * edgeFade);
        const spk = fbm(x * 9 + 1, y * 9 + 5);
        if (spk > 0.7) { const d = (spk - 0.7) * 1.5; R *= 1 - d * 0.4; G *= 1 - d * 0.4; B *= 1 - d * 0.4; }
      }
      // silk vertical satin streaks
      if (info.silk) {
        const streak = (Math.sin(x * 22) * 0.5 + 0.5) * 0.18 + (vnoise(x * 10, 0) - 0.5) * 0.12;
        R *= 1 + streak; G *= 1 + streak; B *= 1 + streak;
      }
      // luster desaturated highlight
      if (P.desatTop) {
        const bf = clamp((tone - 1) / 0.8) * P.desatTop;
        const yl = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        R = mix(R, yl, bf); G = mix(G, yl, bf); B = mix(B, yl, bf);
      }
      R *= 0.88 + 0.12 * edgeFade; G *= 0.88 + 0.12 * edgeFade; B *= 0.88 + 0.12 * edgeFade;
      const gn = (hash2(px, py) - 0.5) * P.grain * edgeFade;
      R *= 1 + gn; G *= 1 + gn; B *= 1 + gn;
      buf[o] = c255(R); buf[o + 1] = c255(G); buf[o + 2] = c255(B); buf[o + 3] = Math.round(255 * cover);
    }
  }
  return buf;
}

/** Render a bead's source photo + metadata into a 16x16 JPEG on the dark background. */
export async function renderBeadThumbnail(
  sourcePath: string,
  metadata: BeadMetadata,
  outPath: string,
): Promise<void> {
  const info = classifyBead(metadata);
  const sample = await sampleBead(sourcePath, info);
  const buf = renderBead(sample, info);

  // Downscale to the final 16x16 FIRST (keeping the coverage alpha), THEN calibrate. The shader's
  // edge-darkening, vignette and rim lighting — plus the lanczos downscale itself — otherwise pull
  // the thumbnail's mean systematically dark/off. Calibrating at final resolution against the
  // coverage-weighted mean lands the bead's area-average exactly on the true sampled colour (so the
  // 16x16 is consistent with the colorMappings hex) while a uniform OKLab shift keeps the 3D look.
  // Done before flatten so the near-black background corners never enter the average.
  const small = await sharp(buf, { raw: { width: SS, height: SS, channels: 4 } })
    .resize(16, 16, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  calibrateToTarget(small, sample.base);
  await sharp(small, { raw: { width: 16, height: 16, channels: 4 } })
    .flatten({ background: RENDER_BG })
    .jpeg({ quality: 90 })
    .toFile(outPath);
}
