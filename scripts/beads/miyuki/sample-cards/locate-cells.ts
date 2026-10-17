/**
 * Second pass for the batch-b rows the first OCR left without a cell (issue #203 Phase 5): the
 * narrow cells the reader could not read are OCRed again (upscaled, binarised, single-word mode)
 * and matched to the approved numbers of that page within one character; a number cell whose
 * bead cell was not paired gets the rest of its table row as the bead box. Every row located here
 * is marked so, and checked by eye on the verification sheet before it is used.
 *
 * Usage: pnpm beads:miyuki:sample-cards:locate
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';
import sharp from 'sharp';
import { ASSET_REPO_ROOT, DOWNLOADED_ROOT } from '../../common/lib/paths.js';
import { formatCsv, parseCsv } from '../common/csv.js';

const CELLS = path.join(DOWNLOADED_ROOT, 'miyuki', 'sample-cards', 'cells');
const BATCH = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'batches', 'b-sample-cards.csv');
const BY_EYE = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'sample-cards', 'located-by-eye.csv');
type Rect = { x: number; y: number; w: number; h: number };
type Cell = Rect & { text: string; conf: number; kind: string; bead: Rect | null };
type Page = { card: string; page: number; dpi: number; width: number; height: number; cells: Cell[] };

const box = (r: Rect) => `${r.x},${r.y},${r.w},${r.h}`;
function parseRect(text: string): Rect | null {
  const parts = text.split(',').map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? { x: parts[0], y: parts[1], w: parts[2], h: parts[3] } : null;
}
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

async function ocrStrong(png: string, cell: Rect, inset: number): Promise<string[]> {
  // Scratch files live in a private temp directory, removed whatever happens.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'beadloo-locate-'));
  try {
    const crop = path.join(scratch, 'cell.png');
    const region = { left: cell.x + inset, top: cell.y + inset, width: Math.max(1, cell.w - 2 * inset), height: Math.max(1, cell.h - 2 * inset) };
    await sharp(png).extract(region).resize({ width: region.width * 3, kernel: 'lanczos3' }).grayscale().normalise().threshold(150).png().toFile(crop);
    const readings: string[] = [];
    for (const psm of ['7', '8', '13']) {
      const out = path.join(scratch, `psm-${psm}`);
      try {
        execFileSync('tesseract', [crop, out, '--psm', psm, '-c', 'tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#', 'txt'], { stdio: 'ignore' });
        const text = fs.readFileSync(`${out}.txt`, 'utf-8').replace(/\s/g, '').replace(/^#/, '').toUpperCase();
        if (text) readings.push(text);
      } catch { /* unreadable */ }
    }
    return readings;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** The rest of the table row to the right of a number cell, bounded by the nearest cell edge on that row. */
function derivedBeadBox(cell: Rect, cells: Rect[], pageWidth: number): Rect {
  const sameRow = cells.filter((c) => c !== cell && Math.abs(c.y - cell.y) <= 12 && c.x > cell.x + cell.w + 20).sort((a, b) => a.x - b.x);
  const right = sameRow[0]?.x ?? Math.min(pageWidth, cell.x + cell.w * 3.2);
  return { x: cell.x + cell.w, y: cell.y, w: Math.round(Math.max(40, right - (cell.x + cell.w))), h: cell.h };
}

async function main(): Promise<void> {
  const rows = parseCsv(fs.readFileSync(BATCH, 'utf-8'));
  const header = Object.keys(rows[0]);
  const pages = new Map<string, Page>();
  for (const f of fs.readdirSync(CELLS).filter((f) => f.endsWith('.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(CELLS, f), 'utf-8')) as Page;
    pages.set(`${p.card}-p${p.page}`, p);
  }
  const approved = rows.filter((r) => r.status.startsWith('confirmed by eye'));
  let derived = 0, located = 0, unlocated: string[] = [];
  // 1. number cell known, bead cell missing → derive
  for (const r of approved) {
    if (!r.number_cell_px150 || r.bead_cell_px150) continue;
    const p = pages.get(`${r.pdf.replace(/\.pdf$/, '')}-p${r.page}`);
    if (!p) continue;
    const [x, y, w, h] = r.number_cell_px150.split(',').map(Number);
    r.bead_cell_px150 = box(derivedBeadBox({ x, y, w, h }, p.cells, p.width));
    r.note = (r.note ? r.note + '; ' : '') + 'bead box derived from the table row';
    derived++;
  }
  // 2. no number cell → second OCR pass over the page's unread/misread narrow cells
  const byEyeKeys = new Set(fs.existsSync(BY_EYE) ? parseCsv(fs.readFileSync(BY_EYE, 'utf-8')).map((pt) => `${pt.card}|${pt.colour_no.toUpperCase()}`) : []);
  const byPage = new Map<string, Array<Record<string, string>>>();
  for (const r of approved) {
    if (r.number_cell_px150 || byEyeKeys.has(`${r.card}|${r.colour_no.toUpperCase()}`)) continue;
    const key = `${r.pdf.replace(/\.pdf$/, '')}-p${r.page}`;
    if (!r.page) { unlocated.push(`${r.colour_no} (${r.card}: no page)`); continue; }
    (byPage.get(key) ?? byPage.set(key, []).get(key)!).push(r);
  }
  for (const [key, wanted] of byPage) {
    const p = pages.get(key);
    if (!p) { for (const r of wanted) unlocated.push(`${r.colour_no} (${key}: no cells json)`); continue; }
    const png = path.join(CELLS, `${p.card}-p${p.page}-${p.dpi}.png`);
    const taken = new Set(rows.filter((r) => r.number_cell_px150).map((r) => r.number_cell_px150));
    // A number cell is as wide as the page's read number cells (the bead cells beside them are wider).
    const widths = p.cells.filter((c) => c.kind === 'number').map((c) => c.w).sort((a, b) => a - b);
    const median = widths[Math.floor(widths.length / 2)] ?? 150;
    const candidates = p.cells.filter((c) => c.w >= median * 0.5 && c.w <= median * 1.5 && c.h > 14 && !taken.has(box(c)));
    const inset = Math.max(3, Math.round(p.dpi / 40));
    const wantedIds = wanted.map((r) => r.colour_no.toUpperCase());
    // A square-hole id is printed as its bare number; on card 76/4R the Round Beads table sits below the
    // Triangle Beads tables, so of two prints the lower one is the round bead.
    const printed = (id: string) => id.replace(/SH$/, '');
    const found = new Map<string, { cell: Cell; reading: string; score: number }>();
    for (const cell of candidates) {
      const readings = [...(cell.text ? [cell.text.toUpperCase()] : []), ...(await ocrStrong(png, cell, inset))];
      for (const reading of readings) {
        for (const id of wantedIds) {
          const target = printed(id);
          // Exact readings only: a one-character tolerance put 30 of 91 rows on the wrong cell (checked by eye).
          if (reading !== target) continue;
          const score = 2 + (id.endsWith('SH') ? cell.y / p.height : 0);
          const prev = found.get(id);
          if (!prev || score > prev.score) found.set(id, { cell, reading, score });
        }
      }
    }
    for (const r of wanted) {
      const hit = found.get(r.colour_no.toUpperCase());
      if (!hit) { unlocated.push(`${r.colour_no} (${key})`); continue; }
      r.number_cell_px150 = box(hit.cell);
      r.bead_cell_px150 = box(hit.cell.bead ?? derivedBeadBox(hit.cell, p.cells, p.width));
      r.ocr_text = hit.reading;
      r.note = (r.note ? r.note + '; ' : '') + `located by the second OCR pass (read "${hit.reading}"${hit.reading === printed(r.colour_no.toUpperCase()) ? '' : ', one character off'})${hit.cell.bead ? '' : '; bead box derived from the table row'}`;
      located++;
    }
  }
  // 3. points read off the page by eye (sources/miyuki/sample-cards/located-by-eye.csv): the cell under the point
  let byEye = 0;
  if (fs.existsSync(BY_EYE)) {
    for (const pt of parseCsv(fs.readFileSync(BY_EYE, 'utf-8'))) {
      const row = approved.find((r) => r.card === pt.card && r.colour_no.toUpperCase() === pt.colour_no.toUpperCase());
      const p = pages.get(`${pt.pdf.replace(/\.pdf$/, '')}-p${pt.page}`);
      if (!row || !p) { unlocated.push(`${pt.colour_no} (${pt.card}: by-eye point without a row or page)`); continue; }
      const scale = p.width / (Number(pt.display_width) || p.width);
      const x = Number(pt.display_x) * scale, y = Number(pt.display_y) * scale;
      const widths = p.cells.filter((c) => c.kind === 'number').map((c) => c.w).sort((a, b) => a - b);
      const median = widths[Math.floor(widths.length / 2)] ?? 150;
      const cell = p.cells.find((c) => c.w >= median * 0.5 && c.w <= median * 1.5 && x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
      if (!cell && !pt.cell_box) { unlocated.push(`${pt.colour_no} (${pt.card}: no cell under the point)`); continue; }
      row.page = pt.page;
      // An explicit box in the file stands for a cell the detector never found (set from the column's neighbours).
      row.number_cell_px150 = pt.cell_box || box(cell!);
      row.bead_cell_px150 = pt.bead_box || box(cell!.bead ?? derivedBeadBox(cell!, p.cells, p.width));
      row.ocr_text = cell?.text ?? '';
      row.note = (row.note ? row.note + '; ' : '') + (pt.cell_box ? `box set by eye (${pt.note})` : `cell under the point read off the page (${pt.note})`);
      byEye++;
      unlocated = unlocated.filter((u) => !u.startsWith(`${pt.colour_no} (`));
    }
  }
  // 4. Sanity: a bead cell adjoins its number cell. On the pale-bordered cover pages the first pass
  // sometimes paired a number with the next column's number cell instead (the bead cell between
  // them had not been detected); the region between the two is the bead cell.
  let adjoined = 0;
  for (const r of approved) {
    const cell = r.number_cell_px150 && parseRect(r.number_cell_px150);
    const bead = r.bead_cell_px150 && parseRect(r.bead_cell_px150);
    if (!cell || !bead) continue;
    const gap = bead.x - (cell.x + cell.w);
    if (gap <= 15) continue;
    r.bead_cell_px150 = box({ x: cell.x + cell.w, y: cell.y, w: gap, h: cell.h });
    r.note = (r.note ? r.note + '; ' : '') + 'bead box set to the region between the number cell and the cell first paired with it';
    adjoined++;
  }
  fs.writeFileSync(BATCH, formatCsv(rows, header));
  console.log(`bead boxes derived: ${derived}; cells located by the second pass: ${located}; by a point read off the page: ${byEye}; bead boxes re-adjoined: ${adjoined}; still unlocated: ${unlocated.length}`);
  for (const u of unlocated) console.log(`  ${u}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('locate-cells failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
