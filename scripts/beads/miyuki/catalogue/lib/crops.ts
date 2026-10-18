/**
 * Swatch crops: where each catalogue row's crop lives and how it is cut from a
 * page render. The naming helpers are pure; `writeSwatchCrop` writes a PNG.
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { sizeDirectoryName } from './numbers.js';
import type { RawImage } from './pdf.js';
import type { Box, CatalogueRow } from './types.js';

export const CROP_DPI = 300;
/** Points trimmed from each side of the swatch cell so the cell border stays out of the crop. */
const CROP_INSET_POINTS = 1;

export function cropFileName(row: CatalogueRow): string {
  return `${row.prefix}${row.colourNo}${row.hole === 'SH' ? '-SH' : ''}.png`;
}

/** `<shape>/<size>/<file>`, e.g. `round-rocailles/11/1-SH.png` or `delica/11/DB1130.png`. */
export function cropRelativePath(row: CatalogueRow): string {
  return path.posix.join(row.shape, sizeDirectoryName(row.size), cropFileName(row));
}

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The swatch in render pixels, inset from the cell border and clamped to the image. */
export function swatchPixelRect(swatch: Box, dpi: number, image: { width: number; height: number }): PixelRect {
  const scale = dpi / 72;
  const left = Math.max(0, Math.round((swatch.x + CROP_INSET_POINTS) * scale));
  const top = Math.max(0, Math.round((swatch.y + CROP_INSET_POINTS) * scale));
  const right = Math.min(image.width, Math.round((swatch.x + swatch.w - CROP_INSET_POINTS) * scale));
  const bottom = Math.min(image.height, Math.round((swatch.y + swatch.h - CROP_INSET_POINTS) * scale));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export async function writeSwatchCrop(render: RawImage, swatch: Box, dpi: number, outPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const rect = swatchPixelRect(swatch, dpi, render);
  await sharp(render.data, { raw: { width: render.width, height: render.height, channels: render.channels } })
    .extract(rect)
    .png()
    .toFile(outPath);
}
