import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { differenceCiede2000, converter } from 'culori';

import {
  sampleBaseColor,
  estimateBodyColor,
  calibrateToTarget,
  colorHintsFromInfo,
  rgb255ToOklab,
  oklabToRgb255,
  rgbToHex,
  type Oklab,
} from '../../../../scripts/beads/common/lib/colorSampler.js';

const temporaryDirectories: string[] = [];
function tmpDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(d);
  return d;
}
afterEach(() => {
  for (const d of temporaryDirectories.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const toRgb = converter('rgb');
const ciede = differenceCiede2000();
function deHex(a: string, b: string): number {
  return ciede(toRgb(a), toRgb(b));
}
type RGB = { r: number; g: number; b: number };
function hex(c: RGB): string {
  return rgbToHex(c.r, c.g, c.b);
}

/**
 * Build a synthetic "bead pile": a grid of solid bead-colour disks on a darker gap colour, with an
 * optional white specular dot on each bead. This is the controlled stand-in for a real catalogue
 * photo — we KNOW the true bead colour, so we can assert the sampler recovers it (and is not dragged
 * toward the dark gaps or the white speculars).
 */
async function makePile(
  filePath: string,
  bead: RGB,
  gap: RGB,
  opts: { size?: number; cell?: number; radius?: number; specular?: boolean } = {},
): Promise<void> {
  const size = opts.size ?? 120;
  const cell = opts.cell ?? 20;
  const radius = opts.radius ?? 8;
  const buf = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (Math.floor(x / cell) + 0.5) * cell;
      const cy = (Math.floor(y / cell) + 0.5) * cell;
      const d = Math.hypot(x - cx, y - cy);
      let c = gap;
      if (d <= radius) {
        c = bead;
        // tiny blown-white specular highlight near the upper-left of each bead
        if (opts.specular && Math.hypot(x - (cx - 2.5), y - (cy - 2.5)) <= 1.4) c = { r: 255, g: 255, b: 255 };
      }
      const o = (y * size + x) * 3;
      buf[o] = c.r; buf[o + 1] = c.g; buf[o + 2] = c.b;
    }
  }
  await sharp(buf, { raw: { width: size, height: size, channels: 3 } }).png().toFile(filePath);
}

describe('estimateBodyColor (pure)', () => {
  it('recovers a bright colour from pixels dominated by dark gaps', () => {
    // 60% near-black gaps, 40% bright orange — a naive mean would be a dull brown.
    const orange = rgb255ToOklab(246, 95, 26);
    const gap = rgb255ToOklab(18, 18, 18);
    const pixels: Oklab[] = [];
    for (let i = 0; i < 600; i++) pixels.push(gap);
    for (let i = 0; i < 400; i++) pixels.push(orange);
    const out = estimateBodyColor(pixels);
    expect(deHex(hex(out), '#f65f1a')).toBeLessThan(3);
  });

  it('leaves a genuinely dark bead dark (no false lift)', () => {
    // A jet pile: everything is near-black, so there is no bright body to lift toward.
    const pixels: Oklab[] = [];
    for (let i = 0; i < 500; i++) pixels.push(rgb255ToOklab(16, 16, 18));
    for (let i = 0; i < 500; i++) pixels.push(rgb255ToOklab(10, 10, 12));
    const out = estimateBodyColor(pixels);
    expect(out.r).toBeLessThan(40);
    expect(out.g).toBeLessThan(40);
    expect(out.b).toBeLessThan(40);
  });

  it('keeps a low-chroma grey bead grey (does not reject it as background)', () => {
    const grey = rgb255ToOklab(150, 150, 150);
    const gap = rgb255ToOklab(20, 20, 20);
    const pixels: Oklab[] = [];
    for (let i = 0; i < 500; i++) pixels.push(gap);
    for (let i = 0; i < 500; i++) pixels.push(grey);
    const out = estimateBodyColor(pixels);
    expect(deHex(hex(out), '#969696')).toBeLessThan(4);
  });

  it('is not pulled toward blown specular highlights', () => {
    const teal = rgb255ToOklab(40, 130, 150);
    const pixels: Oklab[] = [];
    for (let i = 0; i < 800; i++) pixels.push(teal);
    for (let i = 0; i < 200; i++) pixels.push(rgb255ToOklab(255, 255, 255)); // glints
    const out = estimateBodyColor(pixels);
    expect(deHex(hex(out), '#288296')).toBeLessThan(3);
  });
});

describe('sampleBaseColor (synthetic piles)', () => {
  it('recovers a vivid orange bead from a pile with dark gaps', async () => {
    const dir = tmpDir('pile-orange-');
    const p = path.join(dir, 'orange.png');
    await makePile(p, { r: 246, g: 95, b: 26 }, { r: 18, g: 18, b: 18 }, { specular: true });
    const out = await sampleBaseColor(p);
    expect(deHex(hex(out), '#f65f1a')).toBeLessThan(3);
  });

  it('lifts a LIGHT bead off the dark gaps instead of muddying it', async () => {
    // Pale champagne gold beads on dark gaps — the exact case the old averager turned brown.
    const dir = tmpDir('pile-gold-');
    const p = path.join(dir, 'gold.png');
    await makePile(p, { r: 208, g: 168, b: 96 }, { r: 16, g: 16, b: 16 }, { specular: true });
    const out = await sampleBaseColor(p);
    expect(deHex(hex(out), '#d0a860')).toBeLessThan(4);
    // and crucially it is NOT dragged dark toward the old muddy result
    expect(out.r + out.g + out.b).toBeGreaterThan(0.7 * (208 + 168 + 96));
  });

  it('keeps a jet bead near-black', async () => {
    const dir = tmpDir('pile-jet-');
    const p = path.join(dir, 'jet.png');
    await makePile(p, { r: 18, g: 18, b: 20 }, { r: 8, g: 8, b: 10 }, { specular: true });
    const out = await sampleBaseColor(p);
    expect(out.r).toBeLessThan(45);
    expect(out.g).toBeLessThan(45);
    expect(out.b).toBeLessThan(45);
  });

  it('recovers a solid-colour image exactly (back-compat with the old contract)', async () => {
    const dir = tmpDir('solid-');
    const p = path.join(dir, 'red.png');
    await sharp({ create: { width: 48, height: 48, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toFile(p);
    const out = await sampleBaseColor(p);
    expect(deHex(hex(out), '#c82828')).toBeLessThan(2);
  });
});

describe('colorHintsFromInfo', () => {
  it('flags true metallics but not silver-lined beads', () => {
    expect(colorHintsFromInfo({ material: 'metal', silver: false }).metallic).toBe(true);
    expect(colorHintsFromInfo({ material: 'metal', silver: true }).metallic).toBe(false);
    expect(colorHintsFromInfo({ material: 'glass', silver: false }).metallic).toBe(false);
  });
});

describe('OKLab round-trip', () => {
  it('is near-identity for assorted colours', () => {
    for (const c of [[10, 10, 10], [255, 255, 255], [246, 95, 26], [38, 29, 95], [150, 150, 150], [88, 200, 120]]) {
      const back = oklabToRgb255(rgb255ToOklab(c[0], c[1], c[2]));
      expect(Math.abs(back.r - c[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - c[1])).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - c[2])).toBeLessThanOrEqual(1);
    }
  });
});

describe('calibrateToTarget', () => {
  it('lands a shaded buffer’s coverage-weighted mean on the target colour', () => {
    // A 16x16 RGBA "bead": a vertical brightness ramp (shading) over full coverage, plus a few
    // transparent corner pixels that must be ignored.
    const N = 16;
    const buf = Buffer.alloc(N * N * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const o = (y * N + x) * 4;
        const t = y / (N - 1);
        buf[o] = Math.round(40 + t * 160);
        buf[o + 1] = Math.round(30 + t * 120);
        buf[o + 2] = Math.round(20 + t * 90);
        const corner = (x < 2 && y < 2);
        buf[o + 3] = corner ? 0 : 255;
      }
    }
    const target = { r: 200, g: 90, b: 40 };
    calibrateToTarget(buf, target);

    let L = 0, a = 0, b = 0, w = 0;
    for (let o = 0; o + 3 < buf.length; o += 4) {
      if (buf[o + 3] === 0) continue;
      const c = rgb255ToOklab(buf[o], buf[o + 1], buf[o + 2]);
      const wi = buf[o + 3] / 255;
      L += c.L * wi; a += c.a * wi; b += c.b * wi; w += wi;
    }
    const meanHex = hex(oklabToRgb255({ L: L / w, a: a / w, b: b / w }));
    expect(deHex(meanHex, hex(target))).toBeLessThan(2);
  });
});
