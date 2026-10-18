import { describe, expect, it } from 'vitest';
import { colourKey, formatSummary, summarise } from '../../../../../scripts/beads/miyuki/catalogue/lib/summary.js';
import { row } from '../fixtures.js';

describe('summarise', () => {
  const rows = [
    row({ colourNo: '1', hole: 'RH' }),
    row({ colourNo: '1', hole: 'SH' }),
    row({ colourNo: '1', hole: 'RH', page: 84, sectionJa: 'プレシャスビーズ', sectionEn: 'Precious Beads' }),
    row({ colourNo: '327', size: '15/0' }),
    row({ shape: 'delica', prefix: 'DB', colourNo: '1' }),
    row({ shape: 'delica', prefix: 'DBC', colourNo: '1' }),
  ];
  const summary = summarise(
    rows,
    [{ kind: 'empty', page: 20, cell: { x: 1, y: 2, w: 3, h: 4 }, reason: 'no colour number and no swatch' }],
    7
  );

  it('counts cells and distinct numbers per shape and size, with holes and prefixes', () => {
    const [round, delica] = summary.shapes;
    expect(round.cells).toBe(4);
    expect(round.sizes.map((size) => [size.size, size.cells, size.distinct, size.roundHole, size.squareHole])).toEqual([
      ['15/0', 1, 1, 1, 0],
      ['11/0', 3, 2, 1, 1],
    ]);
    expect(delica.sizes[0].prefixes).toEqual({ DB: 1, DBC: 1 });
    expect(round.sections.map((section) => [section.en, section.cells])).toEqual([
      ['Transparent', 3],
      ['Precious Beads', 1],
    ]);
    expect(round.duplicates).toEqual([{ key: '11/0 1', pages: [14, 84] }]);
    expect(summary).toMatchObject({ empty: 1, unparsed: 0, warnings: 0, skipped: 7 });
  });

  it('keys distinct colours by prefix, number and hole', () => {
    expect(colourKey(row({ colourNo: '1', hole: 'SH' }))).toBe('1/SH');
    expect(colourKey(row({ prefix: 'DBM', colourNo: '626' }))).toBe('DBM626');
  });

  it('prints one block per shape and lists the issues', () => {
    const text = formatSummary(summary);
    expect(text).toContain('round-rocailles: 4 cells');
    expect(text).toContain('11/0      3 cells,     2 distinct (1 round hole + 1 square hole)');
    expect(text).toContain('11/0 1 on pages 14, 84');
    expect(text).toContain('delica: 2 cells');
    expect(text).toContain('DB 1, DBC 1');
    expect(text).toContain('empty cells: 1, unparsed cells: 0, warnings: 0, cells of other shapes skipped: 7');
    expect(text).toContain('empty    p20 @ 1.0,2.0: no colour number and no swatch');
  });
});
