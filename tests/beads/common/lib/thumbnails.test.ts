import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildMiyukiOverlaySvg,
  generateDerivatives,
  needs16x16Regeneration,
  needsRegeneration,
} from '../../../../scripts/beads/common/lib/thumbnails.js';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createSourceImage(filePath: string, size = 64): Promise<void> {
  await sharp({ create: { width: size, height: size, channels: 3, background: { r: 120, g: 80, b: 160 } } })
    .jpeg({ quality: 100 })
    .toFile(filePath);
}

/** Force a file's mtime to an absolute epoch-seconds value so staleness comparisons are deterministic. */
function setMtime(filePath: string, seconds: number): void {
  fs.utimesSync(filePath, seconds, seconds);
}

async function dimensions(filePath: string): Promise<{ width?: number; height?: number }> {
  const meta = await sharp(filePath).metadata();
  return { width: meta.width, height: meta.height };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('needsRegeneration', () => {
  it('regenerates when forced or when the output is missing', () => {
    const dir = createTemporaryDirectory('thumb-needs-');
    const src = path.join(dir, 'src.txt');
    const out = path.join(dir, 'out.txt');
    fs.writeFileSync(src, 'x');

    expect(needsRegeneration(src, out, false)).toBe(true); // output missing
    fs.writeFileSync(out, 'y');
    expect(needsRegeneration(src, out, true)).toBe(true); // forced
  });

  it('compares source vs output mtimes when both exist', () => {
    const dir = createTemporaryDirectory('thumb-needs-');
    const src = path.join(dir, 'src.txt');
    const out = path.join(dir, 'out.txt');
    fs.writeFileSync(src, 'x');
    fs.writeFileSync(out, 'y');

    setMtime(src, 1_000);
    setMtime(out, 2_000);
    expect(needsRegeneration(src, out, false)).toBe(false); // output newer

    setMtime(src, 3_000);
    expect(needsRegeneration(src, out, false)).toBe(true); // source newer
  });
});

describe('needs16x16Regeneration', () => {
  function fixture(): { src: string; thumb: string; meta: string } {
    const dir = createTemporaryDirectory('thumb-16-');
    const src = path.join(dir, 'src.jpg');
    const thumb = path.join(dir, 'src_16x16.jpg');
    const meta = path.join(dir, 'src.metadata.json');
    fs.writeFileSync(src, 'x');
    fs.writeFileSync(thumb, 'y');
    fs.writeFileSync(meta, '{}');
    return { src, thumb, meta };
  }

  it('regenerates when the plain source/output check already says so', () => {
    const dir = createTemporaryDirectory('thumb-16-');
    const src = path.join(dir, 'src.jpg');
    fs.writeFileSync(src, 'x');
    // thumb missing → stale regardless of metadata
    expect(needs16x16Regeneration(src, path.join(dir, 'missing_16x16.jpg'), path.join(dir, 'm.json'), false)).toBe(true);
  });

  it('regenerates when the metadata sidecar is newer than the thumbnail', () => {
    const { src, thumb, meta } = fixture();
    setMtime(src, 1_000);
    setMtime(thumb, 2_000);
    setMtime(meta, 3_000); // metadata edited after the thumbnail was built
    expect(needs16x16Regeneration(src, thumb, meta, false)).toBe(true);
  });

  it('does NOT regenerate when both the source and sidecar are older than the thumbnail', () => {
    const { src, thumb, meta } = fixture();
    setMtime(src, 1_000);
    setMtime(meta, 1_500);
    setMtime(thumb, 2_000); // thumbnail is the newest artefact
    expect(needs16x16Regeneration(src, thumb, meta, false)).toBe(false);
  });

  it('does NOT regenerate when the sidecar is absent and the source is older', () => {
    const { src, thumb } = fixture();
    setMtime(src, 1_000);
    setMtime(thumb, 2_000);
    expect(needs16x16Regeneration(src, thumb, path.join(path.dirname(src), 'absent.json'), false)).toBe(false);
  });
});

describe('buildMiyukiOverlaySvg', () => {
  it('returns a 16x16 SVG document', () => {
    const svg = buildMiyukiOverlaySvg({});
    expect(svg).toContain('<svg');
    expect(svg).toContain("width='16'");
    expect(svg).toContain("height='16'");
  });

  it('reads the bead size from meta.size, then falls back to the directory name', () => {
    expect(buildMiyukiOverlaySvg({ size: '11/0' })).toContain('<svg'); // parses the leading number
    expect(buildMiyukiOverlaySvg({}, '15')).toContain('<svg'); // numeric dir-name fallback
  });

  it('uses a stronger specular highlight for metallic finishes', () => {
    const plain = buildMiyukiOverlaySvg({ finish: 'matte' });
    const metallic = buildMiyukiOverlaySvg({ finish: 'galvanized metallic' });
    expect(plain).not.toBe(metallic);
  });

  it('adds a colour tint rect only for a recognised colorGroup', () => {
    const tinted = buildMiyukiOverlaySvg({ colorGroup: 'blue' });
    const untinted = buildMiyukiOverlaySvg({ colorGroup: 'chartreuse' });
    expect(tinted).toContain('rgba(60,140,255');
    expect(untinted).not.toContain('rgba(60,140,255');
  });
});

describe('generateDerivatives', () => {
  it('renders the metadata-driven 16x16 and a 48x48 crop, then caches both', async () => {
    const dir = createTemporaryDirectory('thumb-derive-');
    const src = path.join(dir, 'bead.jpg');
    await createSourceImage(src);
    fs.writeFileSync(
      path.join(dir, 'bead.metadata.json'),
      JSON.stringify({ shape: 'Round', glassGroup: 'Transparent', finish: 'AB' }),
    );

    const first = await generateDerivatives(src, { outputDir: dir });
    expect(first).toEqual({ generated16: true, generated48: true });
    expect(await dimensions(path.join(dir, 'bead_16x16.jpg'))).toEqual({ width: 16, height: 16 });
    expect(await dimensions(path.join(dir, 'bead_48x48.jpg'))).toEqual({ width: 48, height: 48 });

    // Nothing changed → no work on the second pass.
    const second = await generateDerivatives(src, { outputDir: dir });
    expect(second).toEqual({ generated16: false, generated48: false });
  });

  it('re-renders the 16x16 when the metadata sidecar becomes newer than the thumbnail', async () => {
    const dir = createTemporaryDirectory('thumb-derive-');
    const src = path.join(dir, 'bead.jpg');
    const metaPath = path.join(dir, 'bead.metadata.json');
    await createSourceImage(src);
    fs.writeFileSync(metaPath, JSON.stringify({ shape: 'Round', glassGroup: 'Opaque' }));

    await generateDerivatives(src, { outputDir: dir });
    const thumb = path.join(dir, 'bead_16x16.jpg');
    setMtime(src, 1_000);
    setMtime(thumb, 2_000);
    setMtime(metaPath, 3_000); // a finish fix landed in the sidecar after the thumbnail was built

    const result = await generateDerivatives(src, { outputDir: dir });
    expect(result.generated16).toBe(true);
  });

  it('falls back to the Miyuki overlay crop when no sidecar exists but an overlay is supplied', async () => {
    const dir = createTemporaryDirectory('thumb-derive-');
    const src = path.join(dir, 'bead.jpg');
    await createSourceImage(src);

    const result = await generateDerivatives(src, { outputDir: dir, overlay: { size: '11/0', finish: 'metallic' } });
    expect(result.generated16).toBe(true);
    expect(await dimensions(path.join(dir, 'bead_16x16.jpg'))).toEqual({ width: 16, height: 16 });
  });

  it('falls back to a plain centre crop when there is neither a sidecar nor an overlay', async () => {
    const dir = createTemporaryDirectory('thumb-derive-');
    const src = path.join(dir, 'bead.jpg');
    await createSourceImage(src);

    const result = await generateDerivatives(src, { outputDir: dir });
    expect(result.generated16).toBe(true);
    expect(await dimensions(path.join(dir, 'bead_16x16.jpg'))).toEqual({ width: 16, height: 16 });
  });

  it('throws when the source image has no readable dimensions', async () => {
    const dir = createTemporaryDirectory('thumb-derive-');
    const src = path.join(dir, 'not-an-image.jpg');
    fs.writeFileSync(src, 'this is not an image');

    await expect(generateDerivatives(src, { outputDir: dir })).rejects.toThrow();
  });
});
