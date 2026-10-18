import { describe, expect, it } from 'vitest';
import {
  COLUMN_LABELS,
  columnPeriod,
  detectAtomicCells,
  detectTables,
  overlapArea,
  snapSegments,
  textOfBox,
  textsInBox,
  unionBoxes,
} from '../../../../../scripts/beads/miyuki/catalogue/lib/cells.js';
import type { Box, FillRect, Segment, TextLine } from '../../../../../scripts/beads/miyuki/catalogue/lib/types.js';
import { labelsFor, lattice, line, perCellEdges } from '../fixtures.js';

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

describe('snapSegments', () => {
  it('merges collinear segments that touch and snaps near-identical lines together', () => {
    const merged = snapSegments([
      { axis: 'h', at: 100, from: 0, to: 50 },
      { axis: 'h', at: 100.4, from: 50.2, to: 100 },
      { axis: 'h', at: 100.2, from: 150, to: 200 },
      { axis: 'v', at: 20, from: 30, to: 10 },
    ]);
    expect(merged).toEqual([
      { axis: 'h', at: 100.2, from: 0, to: 100 },
      { axis: 'h', at: 100.2, from: 150, to: 200 },
      { axis: 'v', at: 20, from: 10, to: 30 },
    ]);
  });
});

describe('detectAtomicCells', () => {
  it('finds every cell of a 2 x 3 lattice in reading order', () => {
    const cells = detectAtomicCells(lattice(10, 20, [50, 50, 50], [20, 20]));
    expect(cells).toEqual([
      box(10, 20, 50, 20),
      box(60, 20, 50, 20),
      box(110, 20, 50, 20),
      box(10, 40, 50, 20),
      box(60, 40, 50, 20),
      box(110, 40, 50, 20),
    ]);
  });

  it('finds the same cells when every cell draws its own four edges, with jitter', () => {
    const jittered = perCellEdges(10, 20, [50, 50, 50], [20, 20]).map((segment, index) => ({
      ...segment,
      at: segment.at + (index % 3) * 0.2,
    }));
    const cells = detectAtomicCells(jittered);
    expect(cells).toHaveLength(6);
    expect(cells[0].x).toBeCloseTo(10, 0);
    expect(cells[5].y).toBeCloseTo(40, 0);
    expect(cells[5].w).toBeCloseTo(50, 0);
  });

  it('does not invent a cell where the bottom edge is missing', () => {
    const open = lattice(10, 20, [50], [20]).filter((segment) => !(segment.axis === 'h' && segment.at === 40));
    expect(detectAtomicCells(open)).toEqual([]);
  });

  it('uses the first horizontal line below the top that spans both verticals', () => {
    const segments: Segment[] = [
      { axis: 'h', at: 0, from: 0, to: 100 },
      { axis: 'h', at: 10, from: 0, to: 40 }, // too short to close the cell
      { axis: 'h', at: 30, from: 0, to: 100 },
      { axis: 'v', at: 0, from: 0, to: 30 },
      { axis: 'v', at: 100, from: 0, to: 30 },
    ];
    expect(detectAtomicCells(segments)).toEqual([box(0, 0, 100, 30)]);
  });
});

describe('text helpers', () => {
  const texts = [line('131', 45, 24), line('H 4', 145, 24), line('outside', 300, 24)];

  it('selects the lines whose centre falls inside the box, in reading order', () => {
    expect(textsInBox(texts, box(40, 20, 50, 20)).map((text) => text.text)).toEqual(['131']);
    expect(textOfBox(texts, box(140, 20, 50, 20))).toBe('H 4');
    expect(textOfBox(texts, box(0, 0, 10, 10))).toBe('');
  });

  it('computes unions and overlaps', () => {
    expect(unionBoxes([box(0, 0, 10, 10), box(5, 5, 10, 10)])).toEqual(box(0, 0, 15, 15));
    expect(overlapArea(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(25);
    expect(overlapArea(box(0, 0, 10, 10), box(20, 20, 10, 10))).toBe(0);
  });
});

describe('columnPeriod', () => {
  it('is the distance between repeats of the first label', () => {
    const { number, swatch, code } = COLUMN_LABELS;
    expect(columnPeriod([number, swatch, code, number, swatch, code])).toBe(3);
    expect(columnPeriod([code, swatch, code, swatch])).toBe(2);
    expect(columnPeriod([number, swatch, code])).toBe(3);
  });
});

describe('detectTables', () => {
  const widths = [50, 50, 50];
  const labels = [COLUMN_LABELS.number, COLUMN_LABELS.swatch, COLUMN_LABELS.code];
  const heading: FillRect = { x: 40, y: 100, w: 151, h: 20, rgb: [0.9, 1, 1] };

  function roundRocailleTable(): { cells: Box[]; texts: TextLine[]; fills: FillRect[] } {
    const segments = [...lattice(40, 90, widths, [10]), ...lattice(40, 121.5, widths, [20, 20])];
    const texts = [...labelsFor(40, 90, widths, labels), line('スキ', 43, 102), line('Transparent', 43, 111), line('131', 45, 126), line('132', 45, 146)];
    return { cells: detectAtomicCells(segments), texts, fills: [heading] };
  }

  it('reads the columns from the header row and follows the rows through a heading band', () => {
    const { cells, texts, fills } = roundRocailleTable();
    const tables = detectTables(cells, texts, fills);
    expect(tables).toHaveLength(1);
    const [table] = tables;
    expect(table.columns.map((column) => column.label)).toEqual(labels);
    expect(table.numberIsCode).toBe(false);
    expect(table.rows.map((row) => row.kind)).toEqual(['heading', 'cells', 'cells']);
    const firstRow = table.rows[1];
    if (firstRow.kind !== 'cells') throw new Error('expected a cell row');
    expect(firstRow.cells).toHaveLength(1);
    expect(firstRow.cells[0]).toEqual({
      box: box(40, 121.5, 150, 20),
      number: box(40, 121.5, 50, 20),
      swatch: box(90, 121.5, 50, 20),
      code: box(140, 121.5, 50, 20),
    });
    expect(table.box).toEqual(box(40, 90, 151, 71.5));
  });

  it('ignores a white band and stops at a gap', () => {
    const { cells, texts } = roundRocailleTable();
    const whiteBand: FillRect = { ...heading, rgb: [1, 1, 1] };
    const [table] = detectTables(cells, texts, [whiteBand]);
    expect(table.rows).toEqual([]);
  });

  it('ignores a table whose header has no swatch column, and lattices with no header at all', () => {
    const info = lattice(220, 90, [100, 60], [12, 12]);
    const texts = [line('商品形態', 224, 92), line('入数', 324, 92)];
    expect(detectTables(detectAtomicCells(info), texts, [])).toEqual([]);
  });

  it('groups Delica tables by two columns and marks the number as the printed code', () => {
    const delicaWidths = [50, 50, 50, 50];
    const delicaLabels = [COLUMN_LABELS.code, COLUMN_LABELS.swatch, COLUMN_LABELS.code, COLUMN_LABELS.swatch];
    const segments = [...lattice(40, 90, delicaWidths, [10]), ...lattice(40, 100, delicaWidths, [20])];
    const texts = [...labelsFor(40, 90, delicaWidths, delicaLabels), line('DB 1', 45, 105), line('DB 46', 145, 105)];
    const [table] = detectTables(detectAtomicCells(segments), texts, []);
    expect(table.numberIsCode).toBe(true);
    const row = table.rows[0];
    if (row.kind !== 'cells') throw new Error('expected a cell row');
    expect(row.cells.map((cell) => [cell.number, cell.swatch, cell.code])).toEqual([
      [box(40, 100, 50, 20), box(90, 100, 50, 20), null],
      [box(140, 100, 50, 20), box(190, 100, 50, 20), null],
    ]);
  });

  it('orders side-by-side tables left to right and stacked tables top to bottom', () => {
    const texts = [...labelsFor(300, 90, widths, labels), ...labelsFor(40, 90, widths, labels), ...labelsFor(40, 400, widths, labels)];
    const segments = [...lattice(300, 90, widths, [10]), ...lattice(40, 90, widths, [10]), ...lattice(40, 400, widths, [10])];
    const tables = detectTables(detectAtomicCells(segments), texts, []);
    expect(tables.map((table) => [table.box.x, table.box.y])).toEqual([
      [40, 90],
      [300, 90],
      [40, 400],
    ]);
  });
});
