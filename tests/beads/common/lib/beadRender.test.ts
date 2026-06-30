import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp, { type Sharp } from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyBead,
  renderBead,
  renderBeadThumbnail,
  sampleBead,
  type BeadInfo,
  type BeadMetadata,
  type BeadSample,
} from '../../../../scripts/beads/common/lib/beadRender.js';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createSolidImage(
  filePath: string,
  color: { r: number; g: number; b: number },
  transform: (pipeline: Sharp) => Sharp = (p) => p,
): Promise<void> {
  await transform(
    sharp({ create: { width: 48, height: 48, channels: 3, background: color } }),
  )
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    .toFile(filePath);
}

/** Count opaque pixels and distinct colours in an SSxSS RGBA render buffer. */
function summariseRender(buf: Buffer): { pixels: number; opaque: number; distinct: number } {
  let opaque = 0;
  const distinct = new Set<string>();
  for (let i = 0; i < buf.length; i += 4) {
    expect(Number.isFinite(buf[i])).toBe(true);
    if (buf[i + 3] > 0) {
      opaque++;
      distinct.add(`${buf[i]},${buf[i + 1]},${buf[i + 2]}`);
    }
  }
  return { pixels: buf.length / 4, opaque, distinct: distinct.size };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('classifyBead', () => {
  describe('shape', () => {
    it('maps Delica to a tube and everything else to round', () => {
      expect(classifyBead({ shape: 'Delica' }).shape).toBe('tube');
      expect(classifyBead({ shape: 'Round' }).shape).toBe('round');
      expect(classifyBead({ shape: 'Round Rocailles' }).shape).toBe('round');
      expect(classifyBead({ shape: 'Rocailles' }).shape).toBe('round');
      expect(classifyBead({}).shape).toBe('round'); // default when shape is missing
    });
  });

  describe('material', () => {
    it('derives the material family from glassGroup + finish', () => {
      expect(classifyBead({ glassGroup: 'Transparent' }).material).toBe('glass');
      expect(classifyBead({ glassGroup: 'Opaque' }).material).toBe('opaque');
      expect(classifyBead({ glassGroup: 'Other' }).material).toBe('opaque');
      expect(classifyBead({ glassGroup: 'Alabaster' }).material).toBe('opaque');
      expect(classifyBead({ glassGroup: 'Silk' }).material).toBe('opaque');
      expect(classifyBead({ glassGroup: 'Metallic' }).material).toBe('metal');
    });

    it('treats galvanized / plated / silver-lined transparent beads as metal', () => {
      expect(classifyBead({ glassGroup: 'Transparent', galvanized: 'Galvanized' }).material).toBe('metal');
      expect(classifyBead({ glassGroup: 'Transparent', plating: 'Plated' }).material).toBe('metal');
      const silver = classifyBead({ glassGroup: 'Transparent', finish: 'Silver-Lined' });
      expect(silver.material).toBe('metal');
      expect(silver.silver).toBe(true);
    });

    it('does not treat "Non Galvanized" / "Non-Plating" as metal', () => {
      expect(classifyBead({ glassGroup: 'Transparent', galvanized: 'Non Galvanized', plating: 'Non-Plating' }).material).toBe('glass');
    });
  });

  describe('finish modifiers', () => {
    it('classifies picasso/travertine as picasso, NOT iris', () => {
      const p = classifyBead({ glassGroup: 'Transparent', finish: 'Picasso Coating' });
      expect(p.picasso).toBe(true);
      expect(p.iris).toBe(false);
      expect(classifyBead({ finish: 'Travertine' }).picasso).toBe(true);
    });

    it('classifies AB / Rainbow / Special Coating / Peacock as iris', () => {
      for (const finish of ['AB', 'Rainbow', 'Special Coating', 'Peacock', 'Iris']) {
        const info = classifyBead({ glassGroup: 'Transparent', finish });
        expect(info.iris, finish).toBe(true);
        expect(info.picasso, finish).toBe(false);
      }
    });

    it('detects cornelian, silk, matte, luster and lined', () => {
      expect(classifyBead({ finish: 'Cornelian' }).cornelian).toBe(true);
      expect(classifyBead({ glassGroup: 'Silk' }).silk).toBe(true);
      expect(classifyBead({ finish: 'Glass enamel' }).silk).toBe(true);
      expect(classifyBead({ finish: 'Frosted (Matte)' }).matte).toBe(true);
      expect(classifyBead({ finish: 'Luster' }).luster).toBe(true);
      expect(classifyBead({ finish: 'Ceylon' }).luster).toBe(true);
      expect(classifyBead({ finish: 'Inside-Color' }).lined).toBe(true);
      expect(classifyBead({ finish: 'Color-Lined' }).lined).toBe(true);
    });

    it('combines modifiers and is robust to missing/odd fields', () => {
      const info = classifyBead({ glassGroup: 'Transparent', finish: 'Color-Lined, Luster' });
      expect(info.material).toBe('glass');
      expect(info.lined).toBe(true);
      expect(info.luster).toBe(true);
      // no fields at all must not throw and must return a complete, well-typed object
      const blank: BeadInfo = classifyBead({} as BeadMetadata);
      expect(blank.material).toBe('opaque');
      expect(Object.values(blank).every((v) => v !== undefined)).toBe(true);
    });
  });
});

describe('renderBead', () => {
  it('renders a square RGBA buffer that fills the frame with a shaded gradient', () => {
    const info = classifyBead({ shape: 'Round', glassGroup: 'Opaque' });
    const buf = renderBead({ base: { r: 200, g: 60, b: 60 } }, info);

    expect(buf.length % 4).toBe(0);
    const pixels = buf.length / 4;
    const side = Math.sqrt(pixels);
    expect(Number.isInteger(side)).toBe(true); // square render buffer

    let opaque = 0;
    const distinctColors = new Set<string>();
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 3] > 0) {
        opaque++;
        distinctColors.add(`${buf[i]},${buf[i + 1]},${buf[i + 2]}`);
      }
    }
    expect(opaque).toBeGreaterThan(pixels * 0.5); // edge-to-edge bead covers most of the frame
    expect(distinctColors.size).toBeGreaterThan(10); // shaded (not a flat fill)
  });

  it('is deterministic for identical inputs', () => {
    const info = classifyBead({ shape: 'Delica', glassGroup: 'Transparent', finish: 'Luster' });
    const a = renderBead({ base: { r: 120, g: 180, b: 90 } }, info);
    const b = renderBead({ base: { r: 120, g: 180, b: 90 } }, info);
    expect(a.equals(b)).toBe(true);
  });

  // Each material/finish/shape combination drives a distinct branch of the shading loop. A render
  // that produces a finite, well-covered, multi-coloured buffer exercises that branch end to end.
  const sample: BeadSample = {
    base: { r: 150, g: 110, b: 70 },
    smoky: { r: 40, g: 30, b: 25 },
    irisStops: [0.02, 0.2, 0.55, 0.85],
    mottle: { r: 60, g: 45, b: 30 },
  };
  const cases: Array<{ name: string; meta: BeadMetadata }> = [
    { name: 'opaque round', meta: { shape: 'Round', glassGroup: 'Opaque' } },
    { name: 'glass round (translucent core)', meta: { shape: 'Round', glassGroup: 'Transparent' } },
    { name: 'metal tube (specular banding)', meta: { shape: 'Delica', glassGroup: 'Metallic' } },
    { name: 'matte', meta: { shape: 'Round', glassGroup: 'Opaque', finish: 'Frosted (Matte)' } },
    { name: 'luster (desaturated highlight)', meta: { shape: 'Round', glassGroup: 'Opaque', finish: 'Luster' } },
    { name: 'lined core', meta: { shape: 'Round', glassGroup: 'Transparent', finish: 'Color-Lined' } },
    { name: 'silver-lined core', meta: { shape: 'Round', glassGroup: 'Transparent', finish: 'Silver-Lined' } },
    { name: 'iris multi-hue sheen', meta: { shape: 'Round', glassGroup: 'Transparent', finish: 'AB' } },
    { name: 'picasso mottle', meta: { shape: 'Round', glassGroup: 'Opaque', finish: 'Picasso' } },
    { name: 'cornelian white core', meta: { shape: 'Round', glassGroup: 'Opaque', finish: 'Cornelian' } },
    { name: 'silk satin streaks', meta: { shape: 'Round', glassGroup: 'Silk' } },
  ];

  for (const { name, meta } of cases) {
    it(`renders a finite, shaded buffer for ${name}`, () => {
      const info = classifyBead(meta);
      const buf = renderBead(sample, info);
      const { pixels, opaque, distinct } = summariseRender(buf);
      expect(opaque).toBeGreaterThan(pixels * 0.5);
      expect(distinct).toBeGreaterThan(10);
    });
  }
});

describe('sampleBead', () => {
  it('samples a dominant base colour from the source photo', async () => {
    const dir = createTemporaryDirectory('beadrender-sample-');
    const src = path.join(dir, 'red.jpg');
    await createSolidImage(src, { r: 210, g: 40, b: 40 });

    const out = await sampleBead(src, classifyBead({ glassGroup: 'Opaque' }));
    expect(out.base.r).toBeGreaterThan(out.base.g);
    expect(out.base.r).toBeGreaterThan(out.base.b);
  });

  it('falls back to mid-grey for a degenerate all-black source', async () => {
    const dir = createTemporaryDirectory('beadrender-sample-');
    const src = path.join(dir, 'black.jpg');
    await createSolidImage(src, { r: 0, g: 0, b: 0 });

    const out = await sampleBead(src, classifyBead({ glassGroup: 'Opaque' }));
    expect(out.base).toEqual({ r: 128, g: 128, b: 128 });
  });

  it('produces iris hue stops + a smoky body for iridescent beads', async () => {
    const dir = createTemporaryDirectory('beadrender-sample-');
    const src = path.join(dir, 'iris.jpg');
    await createSolidImage(src, { r: 60, g: 120, b: 200 });

    const out = await sampleBead(src, classifyBead({ glassGroup: 'Transparent', finish: 'AB' }));
    expect(out.smoky).toBeDefined();
    expect(out.irisStops).toHaveLength(4);
    for (const stop of out.irisStops ?? []) {
      expect(stop).toBeGreaterThanOrEqual(0);
      expect(stop).toBeLessThan(1);
    }
  });

  it('produces a mottle colour for picasso beads, falling back when no pixel is in range', async () => {
    const dir = createTemporaryDirectory('beadrender-sample-');
    const colored = path.join(dir, 'picasso.jpg');
    await createSolidImage(colored, { r: 120, g: 90, b: 50 });
    const withPixels = await sampleBead(colored, classifyBead({ finish: 'Picasso' }));
    expect(withPixels.mottle).toBeDefined();

    const black = path.join(dir, 'picasso-black.jpg');
    await createSolidImage(black, { r: 0, g: 0, b: 0 });
    const fallback = await sampleBead(black, classifyBead({ finish: 'Picasso' }));
    // Sentinel never replaced → mottle is a darkened copy of the (mid-grey) base, not NaN.
    expect(Number.isFinite(fallback.mottle?.r)).toBe(true);
  });

  it('handles a grayscale (1-channel) source without producing NaN', async () => {
    const dir = createTemporaryDirectory('beadrender-sample-');
    const src = path.join(dir, 'gray.jpg');
    await createSolidImage(src, { r: 90, g: 150, b: 210 }, (p) => p.grayscale());

    const out = await sampleBead(src, classifyBead({ glassGroup: 'Opaque' }));
    expect(Number.isFinite(out.base.r)).toBe(true);
    expect(Number.isFinite(out.base.g)).toBe(true);
    expect(Number.isFinite(out.base.b)).toBe(true);
  });
});

describe('renderBeadThumbnail', () => {
  it('writes a 16x16 JPEG from a source photo + metadata', async () => {
    const dir = createTemporaryDirectory('beadrender-thumb-');
    const src = path.join(dir, 'src.jpg');
    const out = path.join(dir, 'out_16x16.jpg');
    await createSolidImage(src, { r: 80, g: 160, b: 120 });

    await renderBeadThumbnail(src, { shape: 'Round', glassGroup: 'Transparent', finish: 'AB' }, out);

    expect(fs.existsSync(out)).toBe(true);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(16);
    expect(meta.height).toBe(16);
    expect(meta.format).toBe('jpeg');
  });
});
