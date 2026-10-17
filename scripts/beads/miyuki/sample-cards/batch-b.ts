/**
 * Batch (b): the sample-card numbers of issue comment 6219566196 matched to the cells the reader found.
 * It writes the first, unreviewed version of `sources/miyuki/batches/b-sample-cards.csv`; once a human
 * has confirmed rows in that file, a re-run would throw their confirmations away, so it refuses to
 * overwrite it unless `--force` is passed. Usage: pnpm beads:miyuki:sample-cards:batch-b [--force]
 */
import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT, DOWNLOADED_ROOT } from '../../common/lib/paths.js';
import { csvEscape } from '../common/csv.js';

const CELLS = path.join(DOWNLOADED_ROOT, 'miyuki', 'sample-cards', 'cells');
const COMMENT = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'sample-cards', 'issue-203-comment-6219566196.md');
const BATCH = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'batches', 'b-sample-cards.csv');

type Rect = { x: number; y: number; w: number; h: number };
type Cell = Rect & { text: string; conf: number; kind: string; bead: Rect | null };
type Page = { card: string; page: number; dpi: number; cells: Cell[] };

const CARDS: Record<string, { file: string; size: string }> = {
  '13/3R': { file: '13-3R', size: '5/0' }, '43/2R': { file: '43-2R', size: '11/0' }, '44/2R': { file: '44-2R', size: '11/0' },
  '76/4R': { file: '76-4R', size: '2/0, 5/0, 6/0 (per section)' }, '853/R': { file: '853-R', size: '11/0' }, '866R': { file: '866R', size: '6/0' },
  '867/R': { file: '867-R', size: '6/0, 8/0, 11/0, 15/0 (per section)' }, 'black cover': { file: 'black-cover', size: '11/0 (card list description)' }, 'mud cover': { file: 'mud-cover', size: '15/0 (card list description)' },
};
const ALSO_OFFICIAL = '1335 1601 1633 1636 1637 1638 1644 1645 1648 1674 2352 2592 3272'.split(' ');
const box = (r: Rect | null) => (r ? `${r.x},${r.y},${r.w},${r.h}` : '');

function main(): void {
  if (fs.existsSync(BATCH) && !process.argv.includes('--force')) {
    console.error(`${path.relative(ASSET_REPO_ROOT, BATCH)} exists and holds reviewed rows; pass --force to rebuild it from OCR alone (the confirmations are lost).`);
    process.exit(1);
  }
  const pages: Page[] = fs.readdirSync(CELLS).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(CELLS, f), 'utf-8')));
  const block = fs.readFileSync(COMMENT, 'utf-8').split('```')[1];
  const wanted: Array<{ number: string; key: string }> = [];
  for (const line of block.trim().split('\n')) {
    const [label, nums] = line.split(/:(.+)/);
    const key = Object.keys(CARDS).find((k) => label.startsWith(k))!;
    for (const n of nums.trim().split(/\s+/)) wanted.push({ number: n.toUpperCase().replace(/^E/, ''), key });
  }
  const rows = [['colour_no', 'card', 'pdf', 'page', 'card_size', 'number_cell_px150', 'bead_cell_px150', 'ocr_text', 'ocr_conf', 'status', 'note']];
  const findCells = (file: string, number: string) =>
    pages.filter((p) => p.card === file).flatMap((p) => p.cells.filter((c) => c.kind === 'number' && c.text.toUpperCase() === number).map((c) => ({ page: p.page, cell: c })));
  let hit = 0;
  for (const { number, key } of wanted) {
    const { file, size } = CARDS[key];
    const found = findCells(file, number).sort((a, b) => b.cell.conf - a.cell.conf);
    if (found.length) {
      hit++;
      const { page, cell } = found[0];
      rows.push([number, key, `${file}.pdf`, String(page), size, box(cell), box(cell.bead), cell.text, String(Math.round(cell.conf)), cell.conf >= 70 ? 'ocr-read; to confirm by eye' : 'ocr-read, low confidence; to confirm by eye', '']);
    } else rows.push([number, key, `${file}.pdf`, '', size, '', '', '', '', 'not read by OCR; to locate by eye', '']);
  }
  for (const n of ALSO_OFFICIAL) {
    const found = pages.flatMap((p) => p.cells.filter((c) => c.kind === 'number' && c.text.toUpperCase() === n).map((c) => ({ card: p.card, page: p.page, cell: c }))).sort((a, b) => b.cell.conf - a.cell.conf);
    if (found.length) rows.push([n, '(official elsewhere)', `${found[0].card}.pdf`, String(found[0].page), '', box(found[0].cell), box(found[0].cell.bead), found[0].cell.text, String(Math.round(found[0].cell.conf)), 'ocr-read; official elsewhere, missing in Beadloo; to confirm by eye', '']);
    else rows.push([n, '(official elsewhere)', '', '', '', '', '', '', '', 'not read by OCR; official elsewhere, missing in Beadloo', '']);
  }
  fs.writeFileSync(BATCH, rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n');
  console.log(`batch b: ${wanted.length} card-only numbers, ${hit} read by OCR; + ${ALSO_OFFICIAL.length} official elsewhere`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
