/**
 * Images taken from Miyuki's sample cards: a page rendered from the card's PDF (every page is a scan
 * with no text layer), and a strand's original cut from a located cell of that render. Shared by the
 * card reader and the card adders.
 */
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { CataloguePdf } from '../catalogue/lib/pdf.js';
import type { Rect } from './read-cards.js';

/** Share of a cell's width (or height) a run of dark pixels must cover to count as a grid line. */
const LINE_SPAN = 0.95;

/**
 * The strand inside a bead cell: the bounding box of the pixels darker than the card (the beads and
 * their wire), with a margin. The thumbnail generator crops the centre square of the original, so a
 * short strand sitting at the left of a wide cell would otherwise give an empty thumbnail.
 */
export function strandBox(pixels: Uint8Array, width: number, height: number, margin = 6): Rect {
  const dark = (x: number, y: number) => {
    const i = (y * width + x) * 3;
    return Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 190;
  };
  // A cell border or the card's frame is a dark line spanning the cell: leave those columns and rows out.
  // Only a near-full span is a line: a long dark strand fills ~90% of its cell's width, and at 80% its
  // middle rows were taken for lines, cropping the beads in half.
  const columnCount = new Array<number>(width).fill(0);
  const rowCount = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (dark(x, y)) { columnCount[x]++; rowCount[y]++; }
  const lineColumn = columnCount.map((n) => n >= height * LINE_SPAN);
  const lineRow = rowCount.map((n) => n >= width * LINE_SPAN);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    if (lineRow[y]) continue;
    for (let x = 0; x < width; x++) {
      if (lineColumn[x] || !dark(x, y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 - x0 < 20 || y1 - y0 < 3) return { x: 0, y: 0, w: width, h: height };
  return { x: Math.max(0, x0 - margin), y: Math.max(0, y0 - margin), w: Math.min(width, x1 + margin + 1) - Math.max(0, x0 - margin), h: Math.min(height, y1 + margin + 1) - Math.max(0, y0 - margin) };
}

/**
 * Renders one page of a card PDF to `target` as PNG and returns its size. A render already there is
 * reused, unless `overwrite`.
 */
export async function renderCardPage(pdfFile: string, page: number, dpi: number, target: string, options: { overwrite?: boolean } = {}): Promise<{ width: number; height: number }> {
  if (!options.overwrite && fs.existsSync(target)) {
    const meta = await sharp(target).metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0 };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const pdf = await CataloguePdf.open(pdfFile);
  try {
    const img = pdf.renderPage(page, dpi);
    await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } }).png().toFile(target);
    return { width: img.width, height: img.height };
  } finally {
    pdf.destroy();
  }
}

/**
 * A strand's original: the located cell of a page render, `inset` pixels in from each side (past the
 * cell's border), cropped to the strand (`strandBox`) and written to `target` as JPEG.
 */
export async function writeStrandOriginal(render: string, cell: Rect, target: string, inset: number): Promise<void> {
  const meta = await sharp(render).metadata();
  const region = {
    left: Math.max(0, cell.x + inset),
    top: Math.max(0, cell.y + inset),
    width: Math.max(1, Math.min(cell.w - 2 * inset, (meta.width ?? 0) - cell.x - inset)),
    height: Math.max(1, Math.min(cell.h - 2 * inset, (meta.height ?? 0) - cell.y - inset)),
  };
  const crop = sharp(render).extract(region);
  const { data, info } = await crop.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const strand = strandBox(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await crop.extract({ left: strand.x, top: strand.y, width: strand.w, height: strand.h }).jpeg({ quality: 92 }).toFile(target);
}
