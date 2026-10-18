import { describe, expect, it } from 'vitest';
import { CSV_HEADER, csvEscape, formatCsv, formatCsvRow, sortRows } from '../../../../../scripts/beads/miyuki/catalogue/lib/csv.js';
import { row } from '../fixtures.js';

describe('csvEscape', () => {
  it('quotes only what needs quoting', () => {
    expect(csvEscape('H 4')).toBe('H 4');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape(' padded')).toBe('" padded"');
    expect(csvEscape('')).toBe('');
  });
});

describe('formatCsvRow', () => {
  it('writes the columns in order with the cell box to two decimals', () => {
    expect(formatCsvRow(row())).toBe('131,11/0,RH,,スキ,Transparent,14,42.95,187.23,152.78,21.54,H 4');
    expect(formatCsvRow(row({ colourNo: '1', hole: 'SH', codeNo: '' }))).toBe('1,11/0,SH,,スキ,Transparent,14,42.95,187.23,152.78,21.54,');
    expect(formatCsvRow(row({ shape: 'delica', colourNo: '22L', prefix: 'DB', sectionJa: 'デリカビーズ', sectionEn: 'Delica Beads®', page: 66, codeNo: 'DB 22L' }))).toBe(
      '22L,11/0,RH,DB,デリカビーズ,Delica Beads®,66,42.95,187.23,152.78,21.54,DB 22L'
    );
  });
});

describe('formatCsv', () => {
  it('starts with the header and sorts by page, then top to bottom, then left to right', () => {
    const rows = [
      row({ colourNo: 'd', page: 15, cell: { x: 10, y: 10, w: 1, h: 1 } }),
      row({ colourNo: 'c', page: 14, cell: { x: 300, y: 50, w: 1, h: 1 } }),
      row({ colourNo: 'b', page: 14, cell: { x: 40, y: 50, w: 1, h: 1 } }),
      row({ colourNo: 'a', page: 14, cell: { x: 400, y: 20, w: 1, h: 1 } }),
    ];
    expect(sortRows(rows).map((item) => item.colourNo)).toEqual(['a', 'b', 'c', 'd']);
    const csv = formatCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(lines.slice(1, 5).map((text) => text.split(',')[0])).toEqual(['a', 'b', 'c', 'd']);
    expect(csv.endsWith('\n')).toBe(true);
    expect(formatCsv([])).toBe(`${CSV_HEADER.join(',')}\n`);
  });
});
