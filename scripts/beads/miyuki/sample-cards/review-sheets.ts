/** Review sheets: every number cell with its bead cell and the OCR reading, one PNG per card page. */
import * as fs from 'fs';
import * as path from 'path';
import sharp, { type OverlayOptions } from 'sharp';
import { ASSET_REPO_ROOT, DOWNLOADED_ROOT } from '../../common/lib/paths.js';
const CARDS = path.join(DOWNLOADED_ROOT, 'miyuki', 'sample-cards');
const CELLS = path.join(CARDS, 'cells');
const OUT = process.env.CARD_REVIEW_DIR ?? path.join(ASSET_REPO_ROOT, '.scratch', 'card-review');
type Rect = { x: number; y: number; w: number; h: number };
type Cell = Rect & { text: string; conf: number; kind: string; bead: Rect | null };
const NUM_W = 150, BEAD_W = 260, ROW_H = 48, COLS = 4, GAP = 6;
async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  for (const file of fs.readdirSync(CELLS).filter((f) => f.endsWith('.json')).sort()) {
    const page = JSON.parse(fs.readFileSync(path.join(CELLS, file), 'utf-8')) as { card: string; page: number; dpi: number; cells: Cell[] };
    const png = path.join(CELLS, `${page.card}-p${page.page}-${page.dpi}.png`);
    const numbers = page.cells.filter((c) => c.kind === 'number' || (c.w < 700 && c.h < 200 && c.text === ''));
    const rows = Math.ceil(numbers.length / COLS);
    const W = COLS * (NUM_W + BEAD_W + 3 * GAP) + GAP, H = rows * (ROW_H + GAP) + 40;
    const composites: OverlayOptions[] = [];
    const labels: string[] = [`<text x="6" y="24" font-size="16" font-family="Helvetica" fill="#000">${page.card} page ${page.page}: ${numbers.length} number cells (label = OCR reading @ confidence; red = below 70)</text>`];
    const src = sharp(png);
    const meta = await src.metadata();
    for (let i = 0; i < numbers.length; i++) {
      const c = numbers[i];
      const col = i % COLS, row = Math.floor(i / COLS);
      const x0 = GAP + col * (NUM_W + BEAD_W + 3 * GAP), y0 = 40 + row * (ROW_H + GAP);
      const crop = async (r: Rect, w: number) => sharp(png).extract({ left: Math.max(0, r.x), top: Math.max(0, r.y), width: Math.min(r.w, (meta.width ?? 0) - r.x), height: Math.min(r.h, (meta.height ?? 0) - r.y) }).resize({ width: w, height: ROW_H, fit: 'contain', background: '#fff' }).toBuffer();
      composites.push({ input: await crop(c, NUM_W), left: x0, top: y0 });
      if (c.bead) composites.push({ input: await crop(c.bead, BEAD_W), left: x0 + NUM_W + GAP, top: y0 });
      labels.push(`<text x="${x0 + NUM_W + BEAD_W + 2 * GAP - 6}" y="${y0 + ROW_H - 4}" font-size="11" font-family="Helvetica" text-anchor="end" fill="${c.conf < 70 ? '#c00' : '#060'}">${c.text || '?'}@${Math.round(c.conf)}</text>`);
      labels.push(`<text x="${x0 + 2}" y="${y0 + ROW_H - 2}" font-size="9" font-family="Helvetica" fill="#888">${i}</text>`);
    }
    const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${labels.join('')}</svg>`);
    const out = path.join(OUT, `${page.card}-p${page.page}.png`);
    await sharp({ create: { width: W, height: H, channels: 3, background: '#fff' } }).composite([...composites, { input: svg, left: 0, top: 0 }]).png().toFile(out);
    console.log(`${out}: ${numbers.length} cells`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('review-sheets failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
