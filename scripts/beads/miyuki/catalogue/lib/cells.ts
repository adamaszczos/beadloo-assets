/**
 * Cell detection from the drawn table borders.
 *
 * GB-6 draws every table as a lattice of short stroked segments (one per cell
 * edge). This module turns those segments into atomic cells, finds the tables
 * by their printed column labels (カラーNo. / 色見本 / コードNo.) and groups the
 * atomic cells of each row into colour cells. Pure functions only.
 */

import type { Box, FillRect, Segment, TextLine } from './types.js';
import { normaliseWhitespace } from './numbers.js';

/** How far apart two coordinates may be and still count as the same grid line. */
export const SNAP_TOLERANCE = 0.75;
/** Heading bands are filled rectangles drawn a little wider than the lattice and up to a few points clear of the row above. */
const FILL_TOLERANCE = 4;
const MIN_HEADING_HEIGHT = 6;

export const COLUMN_LABELS = {
  number: 'カラーNo.',
  swatch: '色見本',
  code: 'コードNo.',
} as const;

export type ColumnLabel = (typeof COLUMN_LABELS)[keyof typeof COLUMN_LABELS];

export interface TableColumn {
  x: number;
  w: number;
  label: ColumnLabel;
}

export interface ColourCellBoxes {
  /** The union of the cell's atomic boxes. */
  box: Box;
  number: Box | null;
  swatch: Box;
  code: Box | null;
}

export type TableRow = { kind: 'heading'; box: Box } | { kind: 'cells'; box: Box; cells: ColourCellBoxes[] };

export interface Table {
  box: Box;
  columns: TableColumn[];
  /** Delica tables label the colour number itself コードNo.; the number is then also the printed code. */
  numberIsCode: boolean;
  rows: TableRow[];
}

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function unionBoxes(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

export function boxContainsPoint(box: Box, px: number, py: number): boolean {
  return px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h;
}

export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Text lines whose centre lies inside the box, in reading order. */
export function textsInBox(texts: TextLine[], box: Box): TextLine[] {
  return texts
    .filter((line) => boxContainsPoint(box, line.x + line.w / 2, line.y + line.h / 2))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function textOfBox(texts: TextLine[], box: Box): string {
  return normaliseWhitespace(
    textsInBox(texts, box)
      .map((line) => line.text)
      .join(' ')
  );
}

/** Clusters sorted values that sit within `tol` of their neighbour and maps each to the cluster mean. */
function snapValues(values: number[], tol: number): Map<number, number> {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const mapping = new Map<number, number>();
  let cluster: number[] = [];
  const flush = (): void => {
    if (cluster.length === 0) return;
    const mean = round2(cluster.reduce((sum, value) => sum + value, 0) / cluster.length);
    for (const value of cluster) mapping.set(value, mean);
    cluster = [];
  };
  for (const value of sorted) {
    if (cluster.length > 0 && value - cluster[cluster.length - 1] > tol) flush();
    cluster.push(value);
  }
  flush();
  return mapping;
}

/** Snaps segments onto shared grid lines and merges collinear segments that touch or overlap. */
export function snapSegments(segments: Segment[], tol: number = SNAP_TOLERANCE): Segment[] {
  const result: Segment[] = [];
  for (const axis of ['h', 'v'] as const) {
    const ofAxis = segments
      .filter((segment) => segment.axis === axis)
      .map((segment) => ({ ...segment, from: Math.min(segment.from, segment.to), to: Math.max(segment.from, segment.to) }));
    const snapped = snapValues(
      ofAxis.map((segment) => segment.at),
      tol
    );
    const byLine = new Map<number, Segment[]>();
    for (const segment of ofAxis) {
      const at = snapped.get(segment.at) ?? segment.at;
      const list = byLine.get(at) ?? [];
      list.push({ ...segment, at });
      byLine.set(at, list);
    }
    for (const [at, list] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
      list.sort((a, b) => a.from - b.from);
      let current: Segment | null = null;
      for (const segment of list) {
        if (current && segment.from <= current.to + tol) {
          current.to = Math.max(current.to, segment.to);
        } else {
          current = { axis, at, from: segment.from, to: segment.to };
          result.push(current);
        }
      }
    }
  }
  return result;
}

/**
 * Every rectangle bounded by a horizontal line on top, two vertical lines that
 * cross it, and the first horizontal line below that spans both verticals.
 */
export function detectAtomicCells(segments: Segment[], tol: number = SNAP_TOLERANCE): Box[] {
  const snapped = snapSegments(segments, tol);
  const horizontals = snapped.filter((segment) => segment.axis === 'h').sort((a, b) => a.at - b.at || a.from - b.from);
  const verticals = snapped.filter((segment) => segment.axis === 'v').sort((a, b) => a.at - b.at);
  const cells: Box[] = [];
  const seen = new Set<string>();

  for (const top of horizontals) {
    const crossing = verticals.filter(
      (vertical) =>
        vertical.from <= top.at + tol &&
        vertical.to >= top.at - tol &&
        vertical.at >= top.from - tol &&
        vertical.at <= top.to + tol
    );
    for (let i = 0; i + 1 < crossing.length; i++) {
      const left = crossing[i];
      const right = crossing[i + 1];
      if (right.at - left.at <= tol) continue;
      const deepest = Math.min(left.to, right.to) + tol;
      const bottom = horizontals.find(
        (candidate) =>
          candidate.at > top.at + tol &&
          candidate.at <= deepest &&
          candidate.from <= left.at + tol &&
          candidate.to >= right.at - tol
      );
      if (!bottom) continue;
      const cell: Box = { x: left.at, y: top.at, w: round2(right.at - left.at), h: round2(bottom.at - top.at) };
      const key = `${cell.x},${cell.y},${cell.w},${cell.h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push(cell);
    }
  }
  return cells.sort((a, b) => a.y - b.y || a.x - b.x);
}

function isColumnLabel(text: string): text is ColumnLabel {
  return (Object.values(COLUMN_LABELS) as string[]).includes(text);
}

interface HeaderRow {
  cells: Array<{ box: Box; label: ColumnLabel }>;
}

/** Groups labelled cells that sit side by side on one line into header rows. */
function findHeaderRows(cells: Box[], texts: TextLine[], tol: number): HeaderRow[] {
  const labelled = cells
    .map((box) => ({ box, label: textOfBox(texts, box) }))
    .filter((cell): cell is { box: Box; label: ColumnLabel } => isColumnLabel(cell.label))
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const rows: HeaderRow[] = [];
  for (const cell of labelled) {
    const row = rows.find((candidate) => {
      const last = candidate.cells[candidate.cells.length - 1].box;
      return near(last.y, cell.box.y, tol) && near(last.h, cell.box.h, tol) && near(last.x + last.w, cell.box.x, tol);
    });
    if (row) row.cells.push(cell);
    else rows.push({ cells: [cell] });
  }
  return rows.filter((row) => row.cells.some((cell) => cell.label === COLUMN_LABELS.swatch));
}

/** The number of columns after which the header labels repeat (3 for colour/swatch/code, 2 for code/swatch). */
export function columnPeriod(labels: ColumnLabel[]): number {
  const repeat = labels.indexOf(labels[0], 1);
  return repeat === -1 ? labels.length : repeat;
}

function groupRowCells(columns: TableColumn[], present: Array<Box | null>, numberIsCode: boolean): ColourCellBoxes[] {
  const period = columnPeriod(columns.map((column) => column.label));
  const groups: ColourCellBoxes[] = [];
  for (let start = 0; start < columns.length; start += period) {
    const slice = columns.slice(start, start + period).map((column, offset) => ({ column, box: present[start + offset] }));
    const swatch = slice.find((entry) => entry.column.label === COLUMN_LABELS.swatch)?.box ?? null;
    if (!swatch) continue;
    const numberLabel = numberIsCode ? COLUMN_LABELS.code : COLUMN_LABELS.number;
    const number = slice.find((entry) => entry.column.label === numberLabel)?.box ?? null;
    const code = numberIsCode ? null : (slice.find((entry) => entry.column.label === COLUMN_LABELS.code)?.box ?? null);
    const boxes = [number, swatch, code].filter((box): box is Box => box !== null);
    groups.push({ box: unionBoxes(boxes), number, swatch, code });
  }
  return groups;
}

function isHeadingFill(fill: FillRect, table: Box, cursorY: number): boolean {
  const [r, g, b] = fill.rgb;
  const isWhite = r > 0.97 && g > 0.97 && b > 0.97;
  return (
    !isWhite &&
    fill.h >= MIN_HEADING_HEIGHT &&
    near(fill.x, table.x, FILL_TOLERANCE) &&
    near(fill.w, table.w, FILL_TOLERANCE) &&
    near(fill.y, cursorY, FILL_TOLERANCE)
  );
}

/**
 * Finds every table under a header row of column labels and walks its rows
 * downwards while they stay contiguous: a row of atomic cells aligned with the
 * header's columns, or a tinted heading band spanning the table's width.
 */
export function detectTables(cells: Box[], texts: TextLine[], fills: FillRect[], tol: number = SNAP_TOLERANCE): Table[] {
  const tables: Table[] = [];
  for (const header of findHeaderRows(cells, texts, tol)) {
    const columns: TableColumn[] = header.cells.map((cell) => ({ x: cell.box.x, w: cell.box.w, label: cell.label }));
    const numberIsCode = !columns.some((column) => column.label === COLUMN_LABELS.number);
    const box = unionBoxes(header.cells.map((cell) => cell.box));
    const headerBottom = box.y + box.h;
    const columnOf = (cell: Box): number => columns.findIndex((column) => near(column.x, cell.x, tol) && near(column.w, cell.w, tol));
    const bands = groupIntoBands(
      cells.filter((cell) => cell.y >= headerBottom - tol && columnOf(cell) !== -1),
      tol
    );
    const rows: TableRow[] = [];
    let cursorY = headerBottom;
    for (;;) {
      // Rows share their border lines, but a heading band is drawn a point or two shorter than the gap it fills.
      const band = bands.find((candidate) => candidate.y >= cursorY - tol && candidate.y <= cursorY + FILL_TOLERANCE);
      if (band && !band.cells.some((cell) => isColumnLabel(textOfBox(texts, cell)))) {
        const present = columns.map((_, index) => band.cells.find((cell) => columnOf(cell) === index) ?? null);
        rows.push({ kind: 'cells', box: unionBoxes(band.cells), cells: groupRowCells(columns, present, numberIsCode) });
        cursorY = band.y + band.h;
        continue;
      }
      const heading = fills.find((fill) => isHeadingFill(fill, box, cursorY));
      if (!heading) break;
      rows.push({ kind: 'heading', box: { x: heading.x, y: heading.y, w: heading.w, h: heading.h } });
      cursorY = heading.y + heading.h;
    }
    const extent = unionBoxes([box, ...rows.map((row) => row.box)]);
    tables.push({ box: extent, columns, numberIsCode, rows });
  }
  return tables.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

interface Band {
  y: number;
  h: number;
  cells: Box[];
}

function groupIntoBands(cells: Box[], tol: number): Band[] {
  const bands: Band[] = [];
  for (const cell of [...cells].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const band = bands.find((candidate) => near(candidate.y, cell.y, tol) && near(candidate.h, cell.h, tol));
    if (band) band.cells.push(cell);
    else bands.push({ y: cell.y, h: cell.h, cells: [cell] });
  }
  return bands;
}
