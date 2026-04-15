import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { extractColors } from '../../../scripts/beads/common/extract-colors.js';

const temporaryDirectories: string[] = [];

function trackTemporaryDirectory(directory: string): string {
  temporaryDirectories.push(directory);
  return directory;
}

function createTemporaryDirectory(prefix: string): string {
  return trackTemporaryDirectory(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function colorDistance(left: string, right: string): number {
  const a = hexToRgb(left);
  const b = hexToRgb(right);

  return Math.sqrt(
    (a.r - b.r) ** 2 +
    (a.g - b.g) ** 2 +
    (a.b - b.b) ** 2
  );
}

async function createSolidImage(filePath: string, color: string): Promise<void> {
  const sharp = (await import('sharp')).default;
  const { r, g, b } = hexToRgb(color);

  await sharp({
    create: {
      width: 48,
      height: 48,
      channels: 3,
      background: { r, g, b },
    },
  })
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    .toFile(filePath);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('extractColors', () => {
  it('uses the 48x48 thumbnail when no original image exists', async () => {
    const inputDir = createTemporaryDirectory('beadloo-extract-input-');
    const outputDir = createTemporaryDirectory('beadloo-extract-output-');

    fs.writeFileSync(
      path.join(inputDir, 'DB0001.metadata.json'),
      JSON.stringify({ shape: 'Delica', size: '11/0' })
    );

    await createSolidImage(path.join(inputDir, 'DB0001_48x48.jpg'), '#ff0000');
    await createSolidImage(path.join(inputDir, 'DB0001_16x16.jpg'), '#0000ff');

    const result = await extractColors({
      beadType: 'vitest-thumbnail-only',
      size: '11',
      inputDir,
      outputDir,
    });

    expect(result.success).toBe(true);

    const colorData = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'vitest-thumbnail-only-11-colors.json'), 'utf-8')
    );

    const rgb = hexToRgb(colorData.colorMappings.DB0001);
    expect(rgb.r).toBeGreaterThan(200);
    expect(rgb.g).toBeLessThan(20);
    expect(rgb.b).toBeLessThan(20);
  });

  it('prefers original images over lighter thumbnails when an original directory is provided', async () => {
    const inputDir = createTemporaryDirectory('beadloo-extract-input-');
    const originalDir = createTemporaryDirectory('beadloo-extract-originals-');
    const outputDir = createTemporaryDirectory('beadloo-extract-output-');

    fs.writeFileSync(
      path.join(inputDir, 'DB0002.metadata.json'),
      JSON.stringify({ shape: 'Delica', size: '11/0' })
    );

    await createSolidImage(path.join(inputDir, 'DB0002_48x48.jpg'), '#607184');
    await createSolidImage(path.join(inputDir, 'DB0002_16x16.jpg'), '#8090a4');
    await createSolidImage(path.join(originalDir, 'DB0002.jpg'), '#1a212b');

    const result = await extractColors({
      beadType: 'vitest-original-preferred',
      size: '11',
      inputDir,
      originalDir,
      outputDir,
    });

    expect(result.success).toBe(true);

    const colorData = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'vitest-original-preferred-11-colors.json'), 'utf-8')
    );

    const extracted = colorData.colorMappings.DB0002;
    expect(colorDistance(extracted, '#1a212b')).toBeLessThan(8);
    expect(colorDistance(extracted, '#1a212b')).toBeLessThan(colorDistance(extracted, '#607184'));
  });

  it('generates a fallback color when metadata exists without any image asset', async () => {
    const inputDir = createTemporaryDirectory('beadloo-extract-input-');
    const outputDir = createTemporaryDirectory('beadloo-extract-output-');

    fs.writeFileSync(
      path.join(inputDir, 'DB0002.metadata.json'),
      JSON.stringify({ shape: 'Delica', size: '11/0' })
    );

    const result = await extractColors({
      beadType: 'vitest-fallback-only',
      size: '11',
      inputDir,
      outputDir,
    });

    expect(result.success).toBe(true);

    const colorData = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'vitest-fallback-only-11-colors.json'), 'utf-8')
    );

    const fallbackColor = colorData.colorMappings.DB0002;
    expect(fallbackColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colorData.beadIds[fallbackColor]).toContain('DB0002');
  });
});