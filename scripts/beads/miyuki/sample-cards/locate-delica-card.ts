#!/usr/bin/env tsx
/**
 * Locates the Delica `-1` colours on Miyuki's Delica 11/0 sample card N-2 (issue #203).
 *
 * Miyuki's official Delica list (`durability.tsv`) names 51 colours `DB…-1`: a new product beside the
 * old number, which Miyuki's directory still sells under its old finish (Glazed Luster) while the list
 * gives the `-1` a Glass Enamel finish. The directory has no photograph of a `-1` bead; card N-2 prints
 * every one of them with a photographed strand. This script finds each strand's cell:
 *
 * 1. `readCardPage` (the batch-b reader) cuts pages 1–4 into cells and OCRs each label cell.
 * 2. The card is a regular grid of five label/bead column pairs, so the cells give the column edges and
 *    the row tops of the page.
 * 3. A label read exactly as `DB-<n>-1` places that colour. A label OCR misread is placed from a
 *    neighbour that did read exactly, by the row offset counted on the page (`NEIGHBOUR_HINTS`).
 * 4. Every placement goes to `sources/miyuki/sample-cards/n2-renumbered-cells.csv`; the review sheet
 *    (`--sheet <png>`) shows each label and strand for a human to confirm before the adder runs. A
 *    re-run keeps a row's human status (`confirmed by eye …`) while its cells stay where they were;
 *    a cell that moved goes back to `located` and needs looking at again.
 *
 * Usage: pnpm beads:miyuki:sample-cards:locate-delica [--sheet <png>]
 */
import * as fs from 'fs';
import * as path from 'path';
import sharp, { type OverlayOptions } from 'sharp';
import { ASSET_REPO_ROOT, getMiyukiSampleCardsDirectory } from '../../common/lib/paths.js';
import { parseCsv } from '../common/csv.js';
import { readCardPage, type Rect } from './read-cards.js';

export const CARD = 'N-2';
export const PAGES = [1, 2, 3, 4];
const DPI = 150;
const OUT_CSV = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'sample-cards', 'n2-renumbered-cells.csv');
const DURABILITY = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'official', 'durability.tsv');
const CELLS_DIR = getMiyukiSampleCardsDirectory('cells');

/**
 * Labels Tesseract misreads, placed from a label on the same page that reads exactly: the anchor's
 * column, and its row plus `rows` (counted on the card page, 2026-10-17).
 */
export const NEIGHBOUR_HINTS: Record<string, { anchor: string; rows: number }> = {
  'DB207-1': { anchor: 'DB206-1', rows: 1 },
  'DB267-1': { anchor: 'DB268-1', rows: -1 },
  'DB356-1': { anchor: 'DB354-1', rows: 2 },
  'DB357-1': { anchor: 'DB354-1', rows: 3 },
  'DB387-1': { anchor: 'DB384-1', rows: 3 },
  'DB675-1': { anchor: 'DB674', rows: 1 },
  'DB827-1': { anchor: 'DB825-1', rows: 1 },
  'DB1472-1': { anchor: 'DB1479-1', rows: -2 },
  'DB1475-1': { anchor: 'DB1479-1', rows: -1 },
  'DB1496-1': { anchor: 'DB1495-1', rows: 1 },
  'DB1497-1': { anchor: 'DB1498-1', rows: -1 },
  'DB1517-1': { anchor: 'DB1516-1', rows: 1 },
  'DB1537-1': { anchor: 'DB1536-1', rows: 1 },
};

type Cell = Rect & { text: string; conf: number };
export type Grid = { columns: number[]; rows: number[]; rowHeight: number };

/** Positions within `tolerance` of each other are one edge; returns the edges in order. */
export function clusterEdges(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last && v - last[last.length - 1] <= tolerance) last.push(v);
    else groups.push([v]);
  }
  return groups.filter((g) => g.length >= 3).map((g) => Math.round(g.reduce((s, v) => s + v, 0) / g.length));
}

/** The page grid from its cells: column left edges (label and bead columns alternate) and row tops. */
export function gridFromCells(cells: Rect[]): Grid {
  const tableCells = cells.filter((c) => c.w >= 250 && c.w <= 420 && c.h >= 60 && c.h <= 140);
  const columns = clusterEdges(tableCells.map((c) => c.x), 14);
  const rows = clusterEdges(tableCells.map((c) => c.y), 10);
  const steps = rows.slice(1).map((r, i) => r - rows[i]).sort((a, b) => a - b);
  return { columns, rows, rowHeight: steps[Math.floor(steps.length / 2)] ?? 0 };
}

const nearestIndex = (edges: number[], value: number): number =>
  edges.reduce((best, edge, i) => (Math.abs(edge - value) < Math.abs(edges[best] - value) ? i : best), 0);

/** The label cell and the strand cell at a grid position (`column` is a label column's index). */
export function rectsAt(grid: Grid, column: number, row: number): { label: Rect; bead: Rect } {
  const x0 = grid.columns[column], x1 = grid.columns[column + 1], x2 = grid.columns[column + 2] ?? x1 + (x1 - x0) * 1.25;
  const y = grid.rows[row], h = (grid.rows[row + 1] ?? y + grid.rowHeight) - y;
  return { label: { x: x0, y, w: x1 - x0, h }, bead: { x: x1, y, w: Math.round(x2 - x1), h } };
}

/** `DB-106-1`, `D8-106-l`, `DB-1O6-1` → `DB106-1`; anything else is returned compacted. */
export function normaliseLabel(text: string): string {
  const compact = text.toUpperCase().replace(/\s/g, '').replace(/^D8/, 'DB').replace(/^0B/, 'DB');
  const body = compact.replace(/^DB-?/, '');
  if (body === compact) return compact;
  return `DB${body.replace(/[LI|]/g, '1').replace(/O/g, '0')}`;
}

export function officialRenumberedDelica(tsv: string): string[] {
  return tsv.split('\n').map((l) => l.split('\t')[0]?.trim() ?? '').filter((id) => /^DB\d+-1$/.test(id));
}

/** Beadloo's id for a list number: four digits after the prefix (`DB106-1` → `DB0106-1`). */
export function beadloo(id: string): string {
  const m = /^DB(\d+)(-1)?$/.exec(id);
  return m ? `DB${m[1].padStart(4, '0')}${m[2] ?? ''}` : id;
}

export type Placement = { id: string; page: number; column: number; row: number; method: string; ocr: string; conf: number; label: Rect; bead: Rect };

export function placeTargets(pages: Array<{ page: number; cells: Cell[] }>, targets: string[], hints = NEIGHBOUR_HINTS): { placed: Placement[]; missing: string[] } {
  const exact = new Map<string, { page: number; column: number; row: number; ocr: string; conf: number }>();
  const grids = new Map<number, Grid>();
  for (const { page, cells } of pages) {
    const grid = gridFromCells(cells);
    grids.set(page, grid);
    for (const c of cells) {
      const id = normaliseLabel(c.text);
      if (!/^DB\d+(-1)?$/.test(id)) continue;
      const column = nearestIndex(grid.columns, c.x);
      if (column % 2 !== 0) continue;
      const row = nearestIndex(grid.rows, c.y);
      if (!exact.has(id)) exact.set(id, { page, column, row, ocr: c.text, conf: c.conf });
    }
  }
  const placed: Placement[] = [];
  const missing: string[] = [];
  for (const id of targets) {
    const direct = exact.get(id);
    const hint = hints[id];
    const anchor = !direct && hint ? exact.get(hint.anchor) : undefined;
    const at = direct ?? (anchor ? { ...anchor, row: anchor.row + hint!.rows, ocr: '', conf: 0 } : undefined);
    if (!at) { missing.push(id); continue; }
    const grid = grids.get(at.page)!;
    const method = direct ? 'ocr-exact' : `neighbour: ${hint!.rows > 0 ? `${hint!.rows} below` : `${-hint!.rows} above`} ${hint!.anchor}`;
    placed.push({ id, page: at.page, column: at.column, row: at.row, method, ocr: at.ocr, conf: at.conf, ...rectsAt(grid, at.column, at.row) });
  }
  return { placed, missing };
}

const box = (r: Rect) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;

/** The status a re-run writes: the existing one while the label and strand cells are unchanged, else `located`. */
export function statusAfterRelocating(previous: Record<string, string> | undefined, labelBox: string, beadBox: string): string {
  if (previous?.status && previous.label_cell_px150 === labelBox && previous.bead_cell_px150 === beadBox) return previous.status;
  return 'located';
}

async function reviewSheet(placed: Placement[], file: string): Promise<void> {
  const tileW = 700, tileH = 120, cols = 3;
  const rows = Math.ceil(placed.length / cols);
  const composites: OverlayOptions[] = [];
  const texts: string[] = [];
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    const png = path.join(CELLS_DIR, `${CARD}-p${p.page}-${DPI}.png`);
    const region = { left: Math.round(p.label.x), top: Math.round(p.label.y), width: Math.round(p.label.w + p.bead.w), height: Math.round(p.label.h) };
    const x = (i % cols) * (tileW + 10) + 10, y = Math.floor(i / cols) * (tileH + 34) + 10;
    composites.push({ input: await sharp(png).extract(region).resize(tileW, tileH, { fit: 'fill' }).toBuffer(), left: x, top: y + 24 });
    texts.push(`<text x="${x}" y="${y + 18}" font-size="18" font-family="Helvetica" fill="${p.method === 'ocr-exact' ? '#000' : '#b00'}">${beadloo(p.id)}  (p${p.page}, ${p.method})</text>`);
  }
  const W = cols * (tileW + 10) + 10, H = rows * (tileH + 34) + 20;
  const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${texts.join('')}</svg>`);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#fff' } }).composite([...composites, { input: svg, left: 0, top: 0 }]).png().toFile(file);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sheetIndex = argv.indexOf('--sheet');
  const targets = officialRenumberedDelica(fs.readFileSync(DURABILITY, 'utf-8'));
  const pages: Array<{ page: number; cells: Cell[] }> = [];
  for (const page of PAGES) {
    const r = await readCardPage(CARD, page, DPI);
    pages.push({ page, cells: r.cells });
  }
  const { placed, missing } = placeTargets(pages, targets);
  console.log(`Card ${CARD}: ${placed.length} of ${targets.length} -1 colours placed (${placed.filter((p) => p.method === 'ocr-exact').length} read exactly, ${placed.filter((p) => p.method !== 'ocr-exact').length} from a neighbour)`);
  if (missing.length) console.log(`  not placed: ${missing.join(' ')}`);
  const previous = new Map(fs.existsSync(OUT_CSV) ? parseCsv(fs.readFileSync(OUT_CSV, 'utf-8')).map((row) => [row.beadId, row]) : []);
  const header = 'beadId,list_number,card,pdf,page,label_cell_px150,bead_cell_px150,method,ocr_text,ocr_conf,status';
  const lines = placed.map((p) => {
    const status = statusAfterRelocating(previous.get(beadloo(p.id)), box(p.label), box(p.bead));
    return [beadloo(p.id), p.id, CARD, `${CARD}.pdf`, p.page, `"${box(p.label)}"`, `"${box(p.bead)}"`, `"${p.method}"`, `"${p.ocr.replace(/"/g, '""')}"`, Math.round(p.conf), status].join(',');
  });
  const kept = lines.filter((line) => !line.endsWith(',located')).length;
  if (kept) console.log(`  kept the human status of ${kept} rows whose cells did not move`);
  fs.writeFileSync(OUT_CSV, `${header}\n${lines.join('\n')}\n`, 'utf-8');
  console.log(`  wrote ${path.relative(ASSET_REPO_ROOT, OUT_CSV)}`);
  if (sheetIndex >= 0 && argv[sheetIndex + 1]) {
    await reviewSheet(placed, argv[sheetIndex + 1]);
    console.log(`  review sheet: ${argv[sheetIndex + 1]}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nlocate-delica-card failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
