import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { DOWNLOADED_ROOT } from '../../../../scripts/beads/common/lib/paths.js';
import { CSV_HEADER } from '../../../../scripts/beads/miyuki/catalogue/lib/csv.js';
import { colourKey } from '../../../../scripts/beads/miyuki/catalogue/lib/summary.js';
import type { CatalogueRow } from '../../../../scripts/beads/miyuki/catalogue/lib/types.js';
import { DEFAULT_CROPS_DIR, DEFAULT_OUTPUT_DIR, GB6_PAGE_RANGES, parseArgs, parseCatalogue, uniqueCropPath } from '../../../../scripts/beads/miyuki/catalogue/parse-gb6.js';
import { row } from './fixtures.js';

/** The catalogue is 57.6 MB and never committed; point `GB6_PDF` at a copy to run the integration test. */
// The catalogue PDF is 57.6 MB and not committed: keep it at downloaded/miyuki/catalogue/GB-6.pdf, or point GB6_PDF at it.
const PDF_PATH = process.env.GB6_PDF ?? path.join(DOWNLOADED_ROOT, 'miyuki', 'catalogue', 'GB-6.pdf');
const PDF_AVAILABLE = fs.existsSync(PDF_PATH);
const INTEGRATION_TIMEOUT_MS = 120_000;

describe('parseArgs', () => {
  it('requires the PDF and defaults the output and crop directories', () => {
    expect(parseArgs(['--pdf', 'x/GB-6.pdf'])).toEqual({ pdfPath: path.resolve('x/GB-6.pdf'), outDir: DEFAULT_OUTPUT_DIR, cropsDir: null });
    expect(parseArgs(['--pdf', 'x.pdf', '--crops']).cropsDir).toBe(DEFAULT_CROPS_DIR);
    expect(parseArgs(['--crops', 'c', '--pdf', 'x.pdf', '--out', 'o'])).toEqual({ pdfPath: path.resolve('x.pdf'), outDir: path.resolve('o'), cropsDir: path.resolve('c') });
    expect(() => parseArgs([])).toThrow('--pdf');
    expect(() => parseArgs(['--pdf'])).toThrow('--pdf');
    expect(() => parseArgs(['--pdf', 'x.pdf', '--bogus'])).toThrow('--bogus');
  });
});

describe('uniqueCropPath', () => {
  it('appends the page to a colour listed twice at one size', () => {
    const used = new Set<string>();
    expect(uniqueCropPath('round-rocailles/11/4201.png', row({ page: 17 }), used)).toBe('round-rocailles/11/4201.png');
    expect(uniqueCropPath('round-rocailles/11/4201.png', row({ page: 86 }), used)).toBe('round-rocailles/11/4201-p86.png');
    expect([...used]).toEqual(['round-rocailles/11/4201.png', 'round-rocailles/11/4201-p86.png']);
  });
});

describe('GB6_PAGE_RANGES', () => {
  it('covers the round-rocaille, coating and Delica pages', () => {
    expect(GB6_PAGE_RANGES['round-rocailles']).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 84, 85, 86, 87, 88, 89, 90, 91]);
    expect(GB6_PAGE_RANGES.delica).toEqual([66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83]);
  });
});

describe('parseCatalogue on the real GB-6', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb6-'));
  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  const distinct = (rows: CatalogueRow[]): Set<string> => new Set(rows.map(colourKey));
  const mainPages = (rows: CatalogueRow[]): CatalogueRow[] => rows.filter((item) => item.page <= 27);
  const find = (rows: CatalogueRow[], colourNo: string, size: string, prefix = ''): CatalogueRow[] =>
    rows.filter((item) => item.colourNo === colourNo && item.size === size && item.prefix === prefix);

  it.skipIf(!PDF_AVAILABLE)(
    'extracts every round-rocaille and Delica cell',
    async () => {
      const result = await parseCatalogue({ pdfPath: PDF_PATH, outDir, cropsDir: null });
      const round = result.rows.filter((item) => item.shape === 'round-rocailles');
      const delica = result.rows.filter((item) => item.shape === 'delica');

      expect(result.summary.empty).toBe(0);
      expect(result.summary.unparsed).toBe(0);
      expect(result.summary.warnings).toBe(0);

      // Delica: 1,776 cells on pages 66-83, every one with its prefix.
      expect(delica).toHaveLength(1776);
      const byPrefix = Object.fromEntries(
        ['DB', 'DBM', 'DBL', 'DBS', 'DBC', 'DBSC', 'DBMC', 'DBLC'].map((prefix) => [prefix, delica.filter((item) => item.prefix === prefix).length])
      );
      expect(byPrefix).toEqual({ DB: 1091, DBM: 250, DBL: 72, DBS: 207, DBC: 56, DBSC: 26, DBMC: 42, DBLC: 32 });
      for (const [prefix, colourNo, size] of [
        ['DB', '665', '11/0'],
        ['DB', '1130', '11/0'],
        ['DB', '1140', '11/0'],
        ['DBS', '134', '15/0'],
        ['DBM', '626', '10/0'],
      ] as const) {
        expect(find(delica, colourNo, size, prefix), `${prefix}${colourNo}`).toHaveLength(1);
      }

      // The 5/0 Opaque column runs on from p.26 into p.27, whose header adds 1/0: 414, 416, 417 stay Opaque.
      for (const colourNo of ['414', '416', '417']) {
        expect(find(round, colourNo, '5/0').map((item) => item.sectionEn), colourNo).toEqual(['Opaque']);
      }

      // Round rocailles: the size sections on pages 14-27 ...
      const main = mainPages(round);
      const bySize = (size: string): CatalogueRow[] => main.filter((item) => item.size === size);
      expect(distinct(bySize('11/0')).size).toBe(355);
      expect(bySize('11/0').filter((item) => item.hole === 'SH')).toHaveLength(12);
      expect(bySize('11/0').filter((item) => item.colourNo.startsWith('HB')).map((item) => item.colourNo).sort()).toEqual(
        ['HB1122', 'HB1125', 'HB167', 'HB2060', 'HB264', 'HB279', 'HB376', 'HB973']
      );
      expect(distinct(bySize('15/0')).size).toBe(204);
      expect(distinct(bySize('8/0')).size).toBe(218);
      expect(bySize('8/0').filter((item) => item.hole === 'SH')).toHaveLength(2);
      expect(distinct(bySize('6/0')).size).toBe(90);
      // Page 26 and the top of page 27 are 5/0; the EE beads 1/0 section at the foot of page 27 prints eight cells.
      expect(distinct(bySize('5/0')).size).toBe(128);
      expect(distinct(bySize('1/0')).size).toBe(8);
      expect(main).toHaveLength(1003);

      // ... plus the round-rocaille sections of the coating pages 84-91 (Precious, Duracoat, Picasso, Special, Baroque, Mix).
      expect(round).toHaveLength(1168);
      expect(round.filter((item) => item.sectionEn === 'Mix Beads')).toHaveLength(21);

      // Spot checks of section assignment.
      expect(find(round, '327', '15/0')[0]).toMatchObject({ sectionEn: 'Transparent Luster' });
      expect(find(round, '420', '11/0')[0]).toMatchObject({ sectionEn: 'Opaque Luster' });
      expect(find(round, '420', '15/0')[0]).toMatchObject({ sectionEn: 'Opaque Luster' });
      expect(find(round, '437', '15/0')[0]).toMatchObject({ sectionEn: 'Opaque Luster' });
      for (const size of ['11/0', '15/0', '8/0']) {
        expect(find(round, '1340', size)[0], `1340 ${size}`).toMatchObject({ sectionEn: 'Silverlined Dyed Color' });
        expect(find(round, '22', size).length, `22 ${size}`).toBeGreaterThanOrEqual(1);
      }
      expect(find(round, '1', '11/0').map((item) => item.hole).sort()).toEqual(['RH', 'SH']);

      // The CSVs are written sorted with the agreed header.
      const csv = fs.readFileSync(result.csvPaths['round-rocailles'], 'utf8');
      expect(csv.split('\n')[0]).toBe(CSV_HEADER.join(','));
      expect(csv.trim().split('\n')).toHaveLength(1169);
      expect(fs.readFileSync(result.csvPaths.delica, 'utf8').trim().split('\n')).toHaveLength(1777);
    },
    INTEGRATION_TIMEOUT_MS
  );
});
