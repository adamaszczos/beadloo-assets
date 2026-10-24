import { describe, expect, it } from 'vitest';
import { csvEscape, formatCsv, parseCsv, splitCsvLine } from '../../../../scripts/beads/miyuki/common/csv.js';
import { parseCatalogueCsv } from '../../../../scripts/beads/miyuki/audit.js';

describe('Miyuki CSV', () => {
  it('splits a line with quoted commas and doubled quotes', () => {
    expect(splitCsvLine('598,"sample card 853/R, p.1","say ""hi""",')).toEqual(['598', 'sample card 853/R, p.1', 'say "hi"', '']);
  });

  it('reads LF and CRLF files alike, keyed by the header, skipping blank lines', () => {
    const lf = 'colour_no,note\n2479-1,"no size, held"\n\n37,\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const expected = [{ colour_no: '2479-1', note: 'no size, held' }, { colour_no: '37', note: '' }];
    expect(parseCsv(lf)).toEqual(expected);
    expect(parseCsv(crlf)).toEqual(expected);
    expect(parseCsv('')).toEqual([]);
  });

  it('drops a leading byte-order mark, so the first column keeps its name', () => {
    expect(parseCsv('\uFEFFcolour_no,note\n37,x\n')).toEqual([{ colour_no: '37', note: 'x' }]);
  });

  it('writes what it reads back', () => {
    const rows = [{ beadId: 'DB0106-1', ref: 'cell (1859,1561,355,105) "x"' }];
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(parseCsv(formatCsv(rows, ['beadId', 'ref']))).toEqual(rows);
  });

  it('lets the audit read a catalogue row whose fields hold a comma', () => {
    const text = 'colour_no,size,hole,prefix,section_ja,section_en,page\n417,5/0,RH,,ギョク,"Opaque, matte",27\n';
    expect(parseCatalogueCsv(text)).toEqual([{ colour_no: '417', size: '5/0', hole: 'RH', prefix: '', page: '27', section_en: 'Opaque, matte' }]);
  });
});
