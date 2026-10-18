/**
 * Walks one catalogue page in reading order and turns its colour cells into
 * catalogue rows. Pure: the page's graphics come in, rows and issues go out,
 * and the section / size state is threaded through explicitly so it can carry
 * over to the next page (a finish family often continues across a page break).
 */

import { detectAtomicCells, detectTables, overlapArea, textOfBox, type ColourCellBoxes, type Table } from './cells.js';
import {
  DELICA_PREFIX_SIZES,
  classifyHeading,
  isStandaloneSize,
  normaliseWhitespace,
  parseColourNumber,
  parsePageHeader,
  parseSizes,
  type DelicaPrefix,
  type PageHeader,
} from './numbers.js';
import type { Box, CatalogueRow, CatalogueShape, CellIssue, FillRect, PageGraphics, SectionHeading, TextLine } from './types.js';

/** The page header band sits within this many points of the top edge. */
const HEADER_MAX_Y = 80;
/** Tables printed side by side are read left to right when their tops are this close. */
const SAME_ROW_TOLERANCE = 5;
/** A swatch must cover at least this share of its cell to count. */
const MIN_SWATCH_COVERAGE = 0.5;

export interface WalkState {
  size: string | null;
  section: SectionHeading;
  /** The page family (`丸小ビーズ / Round Rocaille Beads`); a finish section only carries over to a page of the same family. */
  family: SectionHeading;
  /** Whether the cells being read belong to the shape this run collects. */
  inScope: boolean;
}

export function initialWalkState(): WalkState {
  return { size: null, section: { ja: '', en: '' }, family: { ja: '', en: '' }, inScope: false };
}

/** The page border is stroked as one huge rectangle; it is a lattice cell to the detector but never a table cell. */
function isWithinPage(cell: Box, graphics: PageGraphics): boolean {
  return cell.w < graphics.width && cell.h < graphics.height;
}

export interface PageParseResult {
  header: PageHeader | null;
  rows: CatalogueRow[];
  issues: CellIssue[];
  /** Colour cells read but belonging to another shape (e.g. Hexagon Beads on a coating page). */
  skipped: number;
  state: WalkState;
}

type ReadingItem = { kind: 'size'; y: number; x: number; size: string } | { kind: 'table'; y: number; x: number; table: Table };

function findPageHeader(texts: TextLine[]): PageHeader | null {
  const candidates = texts.filter((line) => line.y < HEADER_MAX_Y).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const line of candidates) {
    const header = parsePageHeader(line.text);
    if (header) return header;
  }
  return null;
}

function findSizeIntros(texts: TextLine[], cells: Box[]): ReadingItem[] {
  return texts
    .filter((line) => isStandaloneSize(line.text))
    .filter((line) => !cells.some((cell) => overlapArea(cell, line) > 0))
    .map((line) => ({ kind: 'size' as const, y: line.y, x: line.x, size: parseSizes(line.text)[0] }));
}

function readingOrder(a: ReadingItem, b: ReadingItem): number {
  return Math.abs(a.y - b.y) <= SAME_ROW_TOLERANCE ? a.x - b.x : a.y - b.y;
}

function headingText(texts: TextLine[], box: Box): SectionHeading {
  const lines = texts
    .filter((line) => overlapArea(box, line) > 0 && normaliseWhitespace(line.text) !== '')
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((line) => normaliseWhitespace(line.text));
  return { ja: lines[0] ?? '', en: lines.slice(1).join(' ') };
}

function isWhite(fill: FillRect): boolean {
  return fill.rgb.every((channel) => channel > 0.97);
}

function findSwatch(cell: ColourCellBoxes, images: Box[], fills: FillRect[]): 'image' | 'fill' | null {
  const minimum = cell.swatch.w * cell.swatch.h * MIN_SWATCH_COVERAGE;
  if (images.some((image) => overlapArea(image, cell.swatch) >= minimum)) return 'image';
  if (fills.some((fill) => !isWhite(fill) && overlapArea(fill, cell.swatch) >= minimum)) return 'fill';
  return null;
}

interface CellContext {
  graphics: PageGraphics;
  shape: CatalogueShape;
  table: Table;
  state: WalkState;
}

function readColourCell(cell: ColourCellBoxes, context: CellContext): { row?: CatalogueRow; issue?: CellIssue } {
  const { graphics, shape, table, state } = context;
  const issue = (kind: CellIssue['kind'], reason: string): CellIssue => ({ kind, page: graphics.page, cell: cell.box, reason });
  const numberText = cell.number ? textOfBox(graphics.texts, cell.number) : '';
  const swatch = findSwatch(cell, graphics.images, graphics.fills);
  if (numberText === '' && swatch === null) return { issue: issue('empty', 'no colour number and no swatch') };
  const parsed = parseColourNumber(numberText);
  if (!parsed) return { issue: issue('unparsed', `colour number "${numberText}" not understood`) };
  if (swatch === null) return { issue: issue('unparsed', `colour ${parsed.prefix}${parsed.colourNo} has no swatch`) };
  if (shape === 'delica' && parsed.prefix === '') return { issue: issue('unparsed', `"${numberText}" lacks a Delica prefix`) };
  if (shape === 'round-rocailles' && parsed.prefix !== '') return { issue: issue('unparsed', `"${numberText}" is a Delica number`) };
  if (state.size === null) return { issue: issue('unparsed', `no size known for "${numberText}"`) };
  const codeNo = cell.code ? textOfBox(graphics.texts, cell.code) : table.numberIsCode ? numberText : '';
  const row: CatalogueRow = {
    shape,
    colourNo: parsed.colourNo,
    size: state.size,
    hole: parsed.hole,
    prefix: parsed.prefix,
    sectionJa: state.section.ja,
    sectionEn: state.section.en,
    page: graphics.page,
    cell: cell.box,
    swatch: cell.swatch,
    codeNo,
  };
  const expectedSize = parsed.prefix === '' ? null : DELICA_PREFIX_SIZES[parsed.prefix as DelicaPrefix];
  if (expectedSize && expectedSize !== state.size) {
    return { row, issue: issue('warning', `${parsed.prefix}${parsed.colourNo} is sold in ${expectedSize} but printed on a ${state.size} page`) };
  }
  return { row };
}

/**
 * Whether a page header starts a new run of tables or continues the previous page's. A page whose
 * Japanese family name only grows because a further size starts on it (`Eビーズ` → `Eビーズ・EE ビーズ`,
 * 5/0 joined by 1/0) still continues the previous page's table: GB-6's Opaque 5/0 column runs from
 * p.26 (401–413) into p.27 (414, 416, 417) with no heading of its own.
 */
export function startsNewRun(previous: Pick<WalkState, 'family' | 'size'>, family: SectionHeading, firstSize: string): boolean {
  if (family.en !== previous.family.en) return true;
  return family.ja !== previous.family.ja && firstSize !== previous.size;
}

function applyPageHeader(header: PageHeader | null, shape: CatalogueShape, state: WalkState): void {
  const family = header ? { ja: header.ja, en: header.en } : { ja: '', en: '' };
  if (header && header.sizes.length > 0) {
    const newRun = startsNewRun(state, family, header.sizes[0]);
    state.family = family;
    state.size = header.sizes[0];
    state.inScope = header.shape === shape;
    if (newRun) state.section = family;
    return;
  }
  state.family = family;
  // A coating page: its family is the section, and only the shape headings inside the tables say what the cells are.
  state.inScope = false;
  state.section = family;
}

function applyHeading(heading: SectionHeading, shape: CatalogueShape, state: WalkState): void {
  const meaning = classifyHeading(heading);
  if (meaning.kind === 'section') {
    state.section = meaning.section;
    return;
  }
  state.inScope = meaning.shape === shape;
  if (meaning.size) state.size = meaning.size;
  state.section = state.family;
}

/**
 * Reads the page: header first, then the size intros and tables in reading
 * order (top to bottom, side-by-side tables left to right), and inside each
 * table its heading bands and colour cells top to bottom.
 */
export function parsePage(graphics: PageGraphics, shape: CatalogueShape, previous: WalkState): PageParseResult {
  const state: WalkState = { ...previous, section: { ...previous.section }, family: { ...previous.family } };
  const header = findPageHeader(graphics.texts);
  applyPageHeader(header, shape, state);

  const cells = detectAtomicCells(graphics.segments).filter((cell) => isWithinPage(cell, graphics));
  const tables = detectTables(cells, graphics.texts, graphics.fills);
  const items: ReadingItem[] = [
    ...findSizeIntros(graphics.texts, cells),
    ...tables.map((table) => ({ kind: 'table' as const, y: table.box.y, x: table.box.x, table })),
  ].sort(readingOrder);

  const rows: CatalogueRow[] = [];
  const issues: CellIssue[] = [];
  let skipped = 0;
  for (const item of items) {
    if (item.kind === 'size') {
      state.size = item.size;
      continue;
    }
    for (const tableRow of item.table.rows) {
      if (tableRow.kind === 'heading') {
        applyHeading(headingText(graphics.texts, tableRow.box), shape, state);
        continue;
      }
      for (const cell of tableRow.cells) {
        if (!state.inScope) {
          skipped++;
          continue;
        }
        const result = readColourCell(cell, { graphics, shape, table: item.table, state });
        if (result.row) rows.push(result.row);
        if (result.issue) issues.push(result.issue);
      }
    }
  }
  return { header, rows, issues, skipped, state };
}
