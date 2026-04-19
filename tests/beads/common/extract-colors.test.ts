import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { extractColors } from '../../../scripts/beads/common/extract-colors.js';
import { getGeneratedColorDataPath } from '../../../scripts/beads/common/lib/paths.js';

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

async function createSolidWebpImage(filePath: string, color: string): Promise<void> {
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
    .webp({ quality: 100 })
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
      fs.readFileSync(getGeneratedColorDataPath('vitest-thumbnail-only', '11', outputDir), 'utf-8')
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
      fs.readFileSync(getGeneratedColorDataPath('vitest-original-preferred', '11', outputDir), 'utf-8')
    );

    const extracted = colorData.colorMappings.DB0002;
    expect(colorDistance(extracted, '#1a212b')).toBeLessThan(8);
    expect(colorDistance(extracted, '#1a212b')).toBeLessThan(colorDistance(extracted, '#607184'));
  });

  it('prefers webp originals over lighter jpg thumbnails when an original directory is provided', async () => {
    const inputDir = createTemporaryDirectory('beadloo-extract-input-webp-');
    const originalDir = createTemporaryDirectory('beadloo-extract-originals-webp-');
    const outputDir = createTemporaryDirectory('beadloo-extract-output-webp-');

    fs.writeFileSync(
      path.join(inputDir, '311-19001-10_0-00050.metadata.json'),
      JSON.stringify({ shape: 'Rocailles', size: '10/0' })
    );

    await createSolidImage(path.join(inputDir, '311-19001-10_0-00050_48x48.jpg'), '#708090');
    await createSolidImage(path.join(inputDir, '311-19001-10_0-00050_16x16.jpg'), '#90a0b0');
    await createSolidWebpImage(path.join(originalDir, '311-19001-10_0-00050.webp'), '#203040');

    const result = await extractColors({
      beadType: 'vitest-webp-original-preferred',
      size: '10',
      inputDir,
      originalDir,
      outputDir,
    });

    expect(result.success).toBe(true);

    const colorData = JSON.parse(
      fs.readFileSync(getGeneratedColorDataPath('vitest-webp-original-preferred', '10', outputDir), 'utf-8')
    );

    const extracted = colorData.colorMappings['311-19001-10_0-00050'];
    expect(colorDistance(extracted, '#203040')).toBeLessThan(8);
    expect(colorDistance(extracted, '#203040')).toBeLessThan(colorDistance(extracted, '#708090'));
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
      fs.readFileSync(getGeneratedColorDataPath('vitest-fallback-only', '11', outputDir), 'utf-8')
    );

    const fallbackColor = colorData.colorMappings.DB0002;
    expect(fallbackColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colorData.beadIds[fallbackColor]).toContain('DB0002');
  });

  it('maps nested asset paths to canonical bead IDs from metadata', async () => {
    const inputDir = createTemporaryDirectory('beadloo-extract-input-nested-');
    const originalDir = createTemporaryDirectory('beadloo-extract-originals-nested-');
    const outputDir = createTemporaryDirectory('beadloo-extract-output-nested-');

    fs.mkdirSync(path.join(inputDir, '331-19001'), { recursive: true });
    fs.mkdirSync(path.join(originalDir, '331-19001'), { recursive: true });

    fs.writeFileSync(
      path.join(inputDir, '331-19001', '20420.metadata.json'),
      JSON.stringify({ beadId: '311-19001-1_0-20420', shape: 'Rocailles', size: '1/0' })
    );

    await createSolidImage(path.join(inputDir, '331-19001', '20420_48x48.jpg'), '#8090a0');
    await createSolidWebpImage(path.join(originalDir, '331-19001', '20420.webp'), '#203040');

    const result = await extractColors({
      beadType: 'vitest-nested-canonical-id',
      size: '1',
      inputDir,
      originalDir,
      outputDir,
    });

    expect(result.success).toBe(true);

    const colorData = JSON.parse(
      fs.readFileSync(getGeneratedColorDataPath('vitest-nested-canonical-id', '1', outputDir), 'utf-8')
    );

    expect(colorData.colorMappings['311-19001-1_0-20420']).toBeDefined();
    expect(colorData.colorMappings['331-19001/20420']).toBeUndefined();
    expect(colorDistance(colorData.colorMappings['311-19001-1_0-20420'], '#203040')).toBeLessThan(8);
  });
});
