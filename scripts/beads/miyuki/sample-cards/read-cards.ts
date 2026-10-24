/**
 * Sample-card cell reader: finds the table borders in a scanned card page (dark pixel runs),
 * cuts the page into cells, OCRs each cell on its own (Tesseract, one line), and reports the
 * number cells with the bead-photo cell beside them. Usage: pnpm beads:miyuki:sample-cards:read <card> [page] [dpi]
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';
import sharp from 'sharp';
import { getMiyukiSampleCardsDirectory } from '../../common/lib/paths.js';
import { CataloguePdf } from '../catalogue/lib/pdf.js';
import { renderCardPage } from './card-images.js';

const CARDS = getMiyukiSampleCardsDirectory();
const OUT = getMiyukiSampleCardsDirectory('cells');
const DARK_LEVELS = [110, 205];

export type Line = { pos: number; start: number; end: number };
export type Rect = { x: number; y: number; w: number; h: number };

export function mergeRuns(runs: Line[], gap = 6): Line[] {
  // runs sorted by pos; merge consecutive positions with overlapping ranges
  const merged: Line[] = [];
  for (const run of runs.sort((a, b) => a.pos - b.pos || a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && run.pos - last.pos <= gap && run.start <= last.end + 5 && run.end >= last.start - 5) {
      last.start = Math.min(last.start, run.start);
      last.end = Math.max(last.end, run.end);
      last.pos = run.pos; // keep the last row; thickness is a few px
    } else merged.push({ ...run });
  }
  return merged;
}

function runsAlong(get: (i: number, j: number) => number, outer: number, inner: number, minRun: number, dark: number): Line[] {
  const lines: Line[] = [];
  for (let i = 0; i < outer; i++) {
    let start = -1;
    for (let j = 0; j <= inner; j++) {
      const isDark = j < inner && get(i, j) < dark;
      if (isDark && start < 0) start = j;
      if (!isDark && start >= 0) {
        if (j - start >= minRun) lines.push({ pos: i, start, end: j - 1 });
        start = -1;
      }
    }
  }
  return lines;
}

export function cellsFromLines(horizontals: Line[], verticals: Line[]): Rect[] {
  const cells: Rect[] = [];
  const hs = horizontals.sort((a, b) => a.pos - b.pos);
  for (let i = 0; i < hs.length; i++) {
    for (let k = i + 1; k < hs.length; k++) {
      const top = hs[i], bottom = hs[k];
      const x0 = Math.max(top.start, bottom.start), x1 = Math.min(top.end, bottom.end);
      if (x1 - x0 < 40 || bottom.pos - top.pos < 15) continue;
      // verticals that cross both lines within the shared x-range
      const vs = verticals.filter((v) => v.pos >= x0 - 4 && v.pos <= x1 + 4 && v.start <= top.pos + 4 && v.end >= bottom.pos - 4).sort((a, b) => a.pos - b.pos);
      if (vs.length < 2) continue;
      // only the nearest bottom line for this top (no intermediate horizontal spanning the cell)
      const intermediate = hs.slice(i + 1, k).some((h) => h.start <= x0 + 4 && h.end >= x1 - 4);
      if (intermediate) continue;
      for (let a = 0; a + 1 < vs.length; a++) {
        cells.push({ x: vs[a].pos, y: top.pos, w: vs[a + 1].pos - vs[a].pos, h: bottom.pos - top.pos });
      }
    }
  }
  // dedupe: two detections within a few pixels are one cell
  const unique: Rect[] = [];
  for (const c of cells.sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (!unique.some((u) => Math.abs(u.x - c.x) <= 8 && Math.abs(u.y - c.y) <= 8 && Math.abs(u.w - c.w) <= 12 && Math.abs(u.h - c.h) <= 12)) unique.push(c);
  }
  return unique;
}

/** The bead-photo cell of a number cell: the next cell to its right on the same row. */
export function beadCellFor(cell: Rect, cells: Rect[]): Rect | null {
  const right = cells.filter((c) => c !== cell && Math.abs(c.y - cell.y) <= 10 && Math.abs(c.h - cell.h) <= 14 && c.x > cell.x + cell.w - 10).sort((a, b) => a.x - b.x);
  return right[0] ?? null;
}

async function ocrCell(png: string, cell: Rect, inset: number): Promise<{ text: string; conf: number }> {
  // Scratch files live in a private temp directory, removed whatever happens.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'beadloo-cell-'));
  try {
    const crop = path.join(scratch, 'cell.png');
    const region = { left: cell.x + inset, top: cell.y + inset, width: Math.max(1, cell.w - 2 * inset), height: Math.max(1, cell.h - 2 * inset) };
    await sharp(png).extract(region).resize({ width: region.width * 2, kernel: 'lanczos3' }).grayscale().normalise().png().toFile(crop);
    const out = path.join(scratch, 'cell');
    try {
      execFileSync('tesseract', [crop, out, '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#/-', 'tsv'], { stdio: 'ignore' });
    } catch { return { text: '', conf: 0 }; }
    const rows = fs.readFileSync(`${out}.tsv`, 'utf-8').split('\n').slice(1).map((l) => l.split('\t')).filter((c) => c[11]?.trim());
    return { text: rows.map((c) => c[11].trim()).join(' '), conf: rows.length ? Math.min(...rows.map((c) => Number(c[10]))) : 0 };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export async function readCardPage(card: string, page: number, dpi: number) {
  const png = path.join(OUT, `${card}-p${page}-${dpi}.png`);
  const { width: W, height: H } = await renderCardPage(path.join(CARDS, `${card}.pdf`), page, dpi, png, { overwrite: true });
  const gray = await sharp(png).grayscale().raw().toBuffer();
  const px = (y: number, x: number) => gray[y * W + x];
  const minRun = Math.round(W * 0.04);
  // Dark borders first; the cover cards draw pale tan borders, so fall back to a lighter threshold.
  let horizontals: Line[] = [], verticals: Line[] = [], cells: Rect[] = [], darkUsed = 0;
  for (const dark of DARK_LEVELS) {
    horizontals = mergeRuns(runsAlong((y, x) => px(y, x), H, W, minRun, dark));
    verticals = mergeRuns(runsAlong((x, y) => px(y, x), W, H, Math.round(H * 0.02), dark));
    cells = cellsFromLines(horizontals, verticals).filter((c) => c.w > 20 && c.h > 12 && c.w < W * 0.6 && c.h < H * 0.1);
    darkUsed = dark;
    if (cells.length >= 20) break;
  }
  const results: Array<Rect & { text: string; conf: number; kind: 'number' | 'other'; bead: Rect | null }> = [];
  const inset = Math.max(3, Math.round(dpi / 40));
  for (const cell of cells.sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (cell.w > W * 0.25) { results.push({ ...cell, text: '', conf: 0, kind: 'other', bead: null }); continue; }
    const { text, conf } = await ocrCell(png, cell, inset);
    const compact = text.replace(/\s/g, '').replace(/^#/, '');
    const kind = /^#?[A-Z]?\d{1,4}[A-Z]{0,3}(-1)?$/i.test(compact) ? 'number' : 'other';
    results.push({ ...cell, text: compact, conf, kind, bead: kind === 'number' ? beadCellFor(cell, cells) : null });
  }
  const out = { card, page, dpi, width: W, height: H, dark: darkUsed, horizontals: horizontals.length, verticals: verticals.length, cells: results };
  fs.writeFileSync(path.join(OUT, `${card}-p${page}.json`), JSON.stringify(out, null, 1));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const args = process.argv.slice(2);
    const dpi = 150;
    const cards = args.length ? args : fs.readdirSync(CARDS).filter((f) => f.endsWith('.pdf')).map((f) => f.replace(/\.pdf$/, ''));
    for (const card of cards) {
      const pdf = await CataloguePdf.open(path.join(CARDS, `${card}.pdf`));
      const pages = pdf.pageCount();
      pdf.destroy();
      for (let page = 1; page <= pages; page++) {
        const r = await readCardPage(card, page, dpi);
        const numbers = r.cells.filter((c) => c.kind === 'number');
        const low = numbers.filter((c) => c.conf < 70).length;
        console.log(`${card} p${page}: dark<${r.dark}, lines h${r.horizontals} v${r.verticals}, cells ${r.cells.length}, numbers ${numbers.length} (low confidence ${low}, without bead cell ${numbers.filter((c) => !c.bead).length})`);
      }
    }
  })();
}
