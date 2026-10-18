import { describe, expect, it } from 'vitest';
import { COLUMN_LABELS } from '../../../../../scripts/beads/miyuki/catalogue/lib/cells.js';
import { initialWalkState, parsePage, type WalkState } from '../../../../../scripts/beads/miyuki/catalogue/lib/page.js';
import type { Box, FillRect, PageGraphics, Segment, TextLine } from '../../../../../scripts/beads/miyuki/catalogue/lib/types.js';
import { labelsFor, lattice, line } from '../fixtures.js';

const ROUND_LABELS = [COLUMN_LABELS.number, COLUMN_LABELS.swatch, COLUMN_LABELS.code];
const WIDTHS = [50, 50, 50];

interface TableSpec {
  x: number;
  y: number;
  labels?: string[];
  widths?: number[];
  /** Rows in order: a heading `[ja, en]` or a cell `{ number, code?, swatch? }`. */
  rows: Array<[string, string] | { number: string; code?: string; swatch?: boolean }>;
}

interface PageSpec {
  page?: number;
  header?: string;
  extraTexts?: TextLine[];
  tables: TableSpec[];
}

const HEADING_HEIGHT = 20;
const ROW_HEIGHT = 20;

/** Builds the geometry GB-6 would print for the given tables; the page frame is drawn too, as in the PDF. */
function buildPage(spec: PageSpec): PageGraphics {
  const segments: Segment[] = [
    { axis: 'h', at: -5, from: -5, to: 600 },
    { axis: 'h', at: 847, from: -5, to: 600 },
    { axis: 'v', at: -5, from: -5, to: 847 },
    { axis: 'v', at: 600, from: -5, to: 847 },
  ];
  const fills: FillRect[] = [];
  const images: Box[] = [];
  const texts: TextLine[] = [...(spec.extraTexts ?? [])];
  if (spec.header) texts.push(line(spec.header, 42, 41, 170, 16, 10));

  for (const table of spec.tables) {
    const widths = table.widths ?? WIDTHS;
    const labels = table.labels ?? ROUND_LABELS;
    const right = widths.reduce((sum, width) => sum + width, 0);
    segments.push(...lattice(table.x, table.y, widths, [10]));
    texts.push(...labelsFor(table.x, table.y, widths, labels));
    let cursor = table.y + 10;
    for (const row of table.rows) {
      if (Array.isArray(row)) {
        fills.push({ x: table.x, y: cursor, w: right + 1, h: HEADING_HEIGHT, rgb: [0.9, 1, 1] });
        texts.push(line(row[0], table.x + 3, cursor + 2, 60, 7), line(row[1], table.x + 3, cursor + 11, 60, 6));
        cursor += HEADING_HEIGHT;
        continue;
      }
      segments.push(...lattice(table.x, cursor, widths, [ROW_HEIGHT]));
      if (row.number) texts.push(line(row.number, table.x + 5, cursor + 6));
      if (row.code) texts.push(line(row.code, table.x + widths[0] + widths[1] + 5, cursor + 6));
      if (row.swatch !== false) images.push({ x: table.x + widths[0] + 0.5, y: cursor + 0.5, w: widths[1] - 1, h: ROW_HEIGHT - 1 });
      cursor += ROW_HEIGHT;
    }
  }
  return { page: spec.page ?? 1, width: 595, height: 842, segments, fills, images, texts };
}

const ROUND_HEADER = '丸小ビーズ �Round Rocaille Beads 11/0';

describe('parsePage', () => {
  it('reads round-rocaille cells with their section, size, hole and code', () => {
    const page = buildPage({
      page: 14,
      header: ROUND_HEADER,
      tables: [{ x: 40, y: 90, rows: [['スキ', 'Transparent'], { number: '131', code: 'H 4' }, { number: '1/SH' }, ['銀引', 'Silverlined'], { number: 'HB167', code: 'H 7133' }] }],
    });
    const result = parsePage(page, 'round-rocailles', initialWalkState());
    expect(result.issues).toEqual([]);
    expect(result.header?.en).toBe('Round Rocaille Beads');
    expect(result.rows.map((row) => [row.colourNo, row.hole, row.size, row.sectionEn, row.codeNo, row.page])).toEqual([
      ['131', 'RH', '11/0', 'Transparent', 'H 4', 14],
      ['1', 'SH', '11/0', 'Transparent', '', 14],
      ['HB167', 'RH', '11/0', 'Silverlined', 'H 7133', 14],
    ]);
    expect(result.rows[0].cell).toEqual({ x: 40, y: 120, w: 150, h: 20 });
    expect(result.rows[0].swatch).toEqual({ x: 90, y: 120, w: 50, h: 20 });
    expect(result.state.section).toEqual({ ja: '銀引', en: 'Silverlined' });
  });

  it('reads side-by-side tables left to right so a section flows from one block into the next', () => {
    const page = buildPage({
      header: ROUND_HEADER,
      tables: [
        { x: 300, y: 90, rows: [{ number: '219' }, ['中染めレインボー', 'Color Lined Rainbow'], { number: '263' }] },
        { x: 40, y: 90, rows: [['中染め', 'Color Lined'], { number: '201' }] },
      ],
    });
    const result = parsePage(page, 'round-rocailles', initialWalkState());
    expect(result.rows.map((row) => `${row.colourNo}:${row.sectionEn}`)).toEqual(['201:Color Lined', '219:Color Lined', '263:Color Lined Rainbow']);
  });

  it('carries the section over to the next page of the same family and resets it when the family changes', () => {
    const first = parsePage(buildPage({ header: ROUND_HEADER, tables: [{ x: 40, y: 90, rows: [['セイロン', 'Ceylon'], { number: '511' }] }] }), 'round-rocailles', initialWalkState());
    const samePage = buildPage({ page: 2, header: ROUND_HEADER, tables: [{ x: 40, y: 90, rows: [{ number: '512' }] }] });
    const second = parsePage(samePage, 'round-rocailles', first.state);
    expect(second.rows[0].sectionEn).toBe('Ceylon');

    const otherSize = buildPage({ page: 3, header: '丸特小ビーズ �Round Rocaille Beads 15/0', tables: [{ x: 40, y: 90, rows: [{ number: '1' }] }] });
    const third = parsePage(otherSize, 'round-rocailles', second.state);
    expect(third.rows[0]).toMatchObject({ size: '15/0', sectionJa: '丸特小ビーズ', sectionEn: 'Round Rocaille Beads' });
  });

  it('switches size at a standalone size line between two sets of tables', () => {
    const page = buildPage({
      header: 'Eビーズ・EE ビーズ �Round Rocaille Beads 5/0 ・1/0',
      extraTexts: [line('1/0', 49, 300, 19, 19, 12)],
      tables: [
        { x: 40, y: 90, rows: [['ギョク', 'Opaque'], { number: '414', code: 'H 80' }] },
        { x: 40, y: 400, rows: [['ギョク', 'Opaque'], { number: '414', code: 'H 2561' }] },
      ],
    });
    const result = parsePage(page, 'round-rocailles', initialWalkState());
    expect(result.rows.map((row) => `${row.colourNo}@${row.size}`)).toEqual(['414@5/0', '414@1/0']);
  });

  it('on a coating page takes only the cells under round-rocaille shape headings, sized by the heading', () => {
    const page = buildPage({
      page: 86,
      header: 'デュラコートビーズ �Duracoat® Beads',
      tables: [
        { x: 40, y: 90, rows: [['丸小ビーズ 11/0', 'Round Rocaille Beads'], { number: '4201', code: 'H 6421' }, ['丸特小ビーズ 15/0', 'Round Rocaille Beads'], { number: '4201', code: 'H 6448' }] },
        { x: 300, y: 90, rows: [['ロングドロップビーズ 3 × 5.5 ｍｍ', 'Long Drop Beads'], { number: '4201' }, { number: '4201F' }] },
      ],
    });
    const result = parsePage(page, 'round-rocailles', initialWalkState());
    expect(result.rows.map((row) => [row.colourNo, row.size, row.sectionJa, row.sectionEn, row.codeNo])).toEqual([
      ['4201', '11/0', 'デュラコートビーズ', 'Duracoat® Beads', 'H 6421'],
      ['4201', '15/0', 'デュラコートビーズ', 'Duracoat® Beads', 'H 6448'],
    ]);
    expect(result.skipped).toBe(2);
    expect(result.issues).toEqual([]);
  });

  it('reads Delica tables: the printed code is the colour number with its prefix split off', () => {
    const page = buildPage({
      page: 66,
      header: 'デリカビーズ �Delica Beads® 11/0',
      tables: [{ x: 40, y: 90, labels: [COLUMN_LABELS.code, COLUMN_LABELS.swatch], widths: [50, 50], rows: [{ number: 'DB 22L' }, { number: 'DB 1130' }, { number: 'DBM 1' }] }],
    });
    const result = parsePage(page, 'delica', initialWalkState());
    expect(result.rows.map((row) => [row.prefix, row.colourNo, row.size, row.codeNo, row.sectionEn])).toEqual([
      ['DB', '22L', '11/0', 'DB 22L', 'Delica Beads®'],
      ['DB', '1130', '11/0', 'DB 1130', 'Delica Beads®'],
      ['DBM', '1', '11/0', 'DBM 1', 'Delica Beads®'],
    ]);
    expect(result.issues).toEqual([{ kind: 'warning', page: 66, cell: { x: 40, y: 140, w: 100, h: 20 }, reason: 'DBM1 is sold in 10/0 but printed on a 11/0 page' }]);
  });

  it('reports empty and unparsed cells instead of guessing', () => {
    const page = buildPage({
      page: 20,
      header: ROUND_HEADER,
      tables: [
        {
          x: 40,
          y: 90,
          rows: [{ number: '', swatch: false }, { number: 'H 5030' }, { number: '420', swatch: false }, { number: 'DB 1' }, { number: '421' }],
        },
      ],
    });
    const result = parsePage(page, 'round-rocailles', initialWalkState());
    expect(result.rows.map((row) => row.colourNo)).toEqual(['421']);
    expect(result.issues.map((issue) => [issue.kind, issue.cell.y, issue.reason])).toEqual([
      ['empty', 100, 'no colour number and no swatch'],
      ['unparsed', 120, 'colour number "H 5030" not understood'],
      ['unparsed', 140, 'colour 420 has no swatch'],
      ['unparsed', 160, '"DB 1" is a Delica number'],
    ]);
  });

  it('refuses cells of a page whose header belongs to another shape, and cells without a known size', () => {
    const delicaOnRoundRun = buildPage({ header: 'デリカビーズ �Delica Beads® 11/0', tables: [{ x: 40, y: 90, rows: [{ number: '131' }] }] });
    expect(parsePage(delicaOnRoundRun, 'round-rocailles', initialWalkState()).skipped).toBe(1);

    const noHeader = buildPage({ tables: [{ x: 40, y: 90, rows: [{ number: '131' }] }] });
    const state: WalkState = { ...initialWalkState(), inScope: true };
    const result = parsePage({ ...noHeader }, 'round-rocailles', state);
    expect(result.header).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.skipped).toBe(1);
  });
});
