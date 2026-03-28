import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

// ============================================================================
// Types
// ============================================================================

export type DerivativeResult = {
  generated16: boolean;
  generated48: boolean;
};

export type MiyukiOverlayInfo = {
  size?: string | number;
  finish?: string;
  dyed?: string | boolean;
  plating?: string | boolean;
  colorGroup?: string;
};

export type DerivativeOptions = {
  force?: boolean;
  overlay?: MiyukiOverlayInfo;
  outputDir?: string;
};

// ============================================================================
// Helpers
// ============================================================================

export function needsRegeneration(sourcePath: string, outputPath: string, force: boolean): boolean {
  if (force || !fs.existsSync(outputPath)) {
    return true;
  }
  const sourceStat = fs.statSync(sourcePath);
  const outputStat = fs.statSync(outputPath);
  return sourceStat.mtimeMs > outputStat.mtimeMs;
}

// ============================================================================
// Miyuki SVG overlay
// ============================================================================

export function buildMiyukiOverlaySvg(meta: MiyukiOverlayInfo, dirName?: string): string {
  let sizeNum = 11;
  if (meta.size) {
    const m = String(meta.size).match(/(\d+)/);
    if (m) sizeNum = parseInt(m[1], 10) || sizeNum;
  } else if (dirName?.match(/^\d+$/)) {
    sizeNum = parseInt(dirName, 10) || 11;
  }

  const curvatureFactor = Math.max(0, Math.min(1, (12 - sizeNum) / 8));
  const edgeOpacity = 0.28 + curvatureFactor * 0.5;
  const edgeR = 60 + curvatureFactor * 30;
  const verticalPeak = 0.08 + (1 - curvatureFactor) * 0.06;

  const finish = String(meta.finish || '').toLowerCase();
  const isMetallic = finish.includes('metal') || finish.includes('plating') || finish.includes('galvan');
  const specularOpacity = isMetallic ? 0.26 : 0.14;
  const highlightTop = isMetallic ? 0.56 : 0.42;

  const dyed = String(meta.dyed || '').toLowerCase().includes('dyed');
  const plated = String(meta.plating || '').toLowerCase().includes('plating');

  const tint = (meta.colorGroup || '').toLowerCase();
  const tintMap: Record<string, string> = {
    red: 'rgba(255,60,60,0.06)',
    orange: 'rgba(255,120,50,0.05)',
    yellow: 'rgba(255,200,50,0.04)',
    green: 'rgba(40,200,120,0.04)',
    blue: 'rgba(60,140,255,0.04)',
    purple: 'rgba(160,80,200,0.04)',
  };
  const tintKey = Object.keys(tintMap).find((k) => tint.includes(k));
  const tintColor = tintKey ? tintMap[tintKey] : null;

  return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'>
  <defs>
    <linearGradient id='horizontal' x1='0' y1='0' x2='0' y2='1'>
      <stop offset='0%' stop-color='rgba(255,255,255,0.00)' />
      <stop offset='40%' stop-color='rgba(255,255,255,${(verticalPeak * 0.75).toFixed(3)})' />
      <stop offset='50%' stop-color='rgba(255,255,255,${(verticalPeak * 1.8).toFixed(3)})' />
      <stop offset='60%' stop-color='rgba(255,255,255,${(verticalPeak * 0.75).toFixed(3)})' />
      <stop offset='100%' stop-color='rgba(0,0,0,0.00)' />
    </linearGradient>

    <radialGradient id='edges_tb' cx='50%' cy='50%' r='${edgeR}%'>
      <stop offset='30%' stop-color='rgba(0,0,0,0.00)' />
      <stop offset='100%' stop-color='rgba(0,0,0,${edgeOpacity.toFixed(3)})' />
    </radialGradient>

    <radialGradient id='highlight_lr' cx='28%' cy='50%' r='30%'>
      <stop offset='0%' stop-color='white' stop-opacity='${(highlightTop * 0.9).toFixed(3)}' />
      <stop offset='60%' stop-color='white' stop-opacity='${(highlightTop * 0.22).toFixed(3)}' />
      <stop offset='100%' stop-color='white' stop-opacity='0.00' />
    </radialGradient>
  </defs>

  <rect x='0' y='0' width='16' height='5' fill='url(#edges_tb)' />
  <g transform='translate(0,11) scale(1,-1)'>
    <rect x='0' y='0' width='16' height='5' fill='url(#edges_tb)' />
  </g>

  <rect x='0' y='0' width='16' height='16' fill='url(#horizontal)' opacity='0.9' />

  <path d='M2 3 C3 6 3 10 2 13 L4 13 C4.5 10.5 4.5 5.5 4 3 Z' fill='white' fill-opacity='${specularOpacity.toFixed(3)}' />

  <ellipse cx='${dyed ? 3.2 : 3.6}' cy='${plated ? 7 : 8}' rx='1.8' ry='3' fill='url(#highlight_lr)' />

  ${tintColor ? `<rect x='0' y='0' width='16' height='16' fill='${tintColor}' fill-opacity='0.06' />` : ''}
</svg>`;
}

// ============================================================================
// Derivative generation
// ============================================================================

export async function generateDerivatives(
  sourcePath: string,
  options: DerivativeOptions = {}
): Promise<DerivativeResult> {
  const { force = false, overlay, outputDir } = options;
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const outDirectory = outputDir ?? path.dirname(sourcePath);
  const crop48Path = path.join(outDirectory, `${baseName}_48x48.jpg`);
  const thumb16Path = path.join(outDirectory, `${baseName}_16x16.jpg`);

  const image = sharp(sourcePath).rotate();
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (!width || !height) {
    throw new Error(`Unable to read image dimensions for ${sourcePath}`);
  }

  let generated16 = false;
  let generated48 = false;

  // --- 48x48 centered crop (pixel-level extract, not a resize) ---
  if (needsRegeneration(sourcePath, crop48Path, force)) {
    const cropSize = 48;
    const left = Math.max(0, Math.floor((width - cropSize) / 2));
    const top = Math.max(0, Math.floor((height - cropSize) / 2));
    const extractWidth = Math.min(cropSize, width);
    const extractHeight = Math.min(cropSize, height);

    await image
      .clone()
      .extract({ left, top, width: extractWidth, height: extractHeight })
      .resize(48, 48, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 90 })
      .toFile(crop48Path);
    generated48 = true;
  }

  // --- 16x16 centered crop (with optional SVG overlay for Miyuki) ---
  if (needsRegeneration(sourcePath, thumb16Path, force)) {
    if (overlay) {
      // Miyuki path: 32x32 intermediate crop → 16x16, then SVG composite
      const minCrop = 32;
      let pipeline = sharp(sourcePath, { limitInputPixels: false });
      let w = width;
      let h = height;

      if (w < minCrop || h < minCrop) {
        const scale = Math.max(minCrop / w, minCrop / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        pipeline = pipeline.resize(w, h);
      }

      const left = Math.max(0, Math.floor((w - 32) / 2));
      const top = Math.max(0, Math.floor((h - 32) / 2));

      const buffer = await pipeline
        .extract({ left, top, width: 32, height: 32 })
        .resize(16, 16)
        .toBuffer();

      const dirName = path.basename(outputDir ?? path.dirname(sourcePath));
      const svgOverlay = buildMiyukiOverlaySvg(overlay, dirName);
      const overlayBuffer = Buffer.from(svgOverlay);

      await sharp(buffer)
        .composite([{ input: overlayBuffer, blend: 'over' }])
        .jpeg({ quality: 90 })
        .toFile(thumb16Path);
    } else {
      // TOHO path: simple centered crop → 16x16
      const cropSize = Math.min(width, height);
      const left = Math.max(0, Math.floor((width - cropSize) / 2));
      const top = Math.max(0, Math.floor((height - cropSize) / 2));

      await image
        .clone()
        .extract({ left, top, width: cropSize, height: cropSize })
        .resize(16, 16, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 90 })
        .toFile(thumb16Path);
    }
    generated16 = true;
  }

  return { generated16, generated48 };
}
