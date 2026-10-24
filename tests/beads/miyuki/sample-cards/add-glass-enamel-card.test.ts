import { describe, expect, it } from 'vitest';
import { archivedCard, glassEnamelRegistryRow, parseGlassEnamelOverrides, planGlassEnamelBeads } from '../../../../scripts/beads/miyuki/sample-cards/add-glass-enamel-card.js';

const cell = (colour_no: string, status = 'confirmed by eye 2026-10-23') => ({ colour_no, strand_cell_px300: '10,20,500,150', status });
const overrideRow = { colour_no: '429-1', glassGroup: 'Opaque', finish: 'Glass enamel', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', evidence: 'card strand opaque; notice' };
const twin2479 = { dbNumber: 'DB268-1', phrase: 'Opaque - Glass Enamel - Luster' };

describe("card TE-64's lead-free Glass Enamel colours", () => {
  it("plans every confirmed colour at the card's four sizes, from the Delica twin or the reviewed row", () => {
    const phraseOf = (seed: string) => (seed === '2479-1' ? twin2479 : null);
    const overrides = parseGlassEnamelOverrides([overrideRow]);
    const inLibrary = (beadId: string, size: string) => beadId === '2479-1' && size === '15';
    const { planned, skipped, ignoredOverrides } = planGlassEnamelBeads([cell('2479-1'), cell('429-1'), cell('366-1', 'ocr only'), cell('598-1')], phraseOf, overrides, inLibrary);
    expect(planned.filter((p) => p.beadId === '2479-1').map((p) => p.size)).toEqual(['11', '8', '6']);
    expect(planned.find((p) => p.beadId === '2479-1')?.sidecar).toEqual({ shape: 'Round Rocailles', size: '11/0', glassGroup: 'Opaque', finish: 'Glass enamel, Luster', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', colorAccuracy: 'photo' });
    expect(planned.filter((p) => p.beadId === '429-1').map((p) => p.size)).toEqual(['15', '11', '8', '6']);
    expect(planned.find((p) => p.beadId === '429-1')?.sidecar).toEqual({ shape: 'Round Rocailles', size: '15/0', glassGroup: 'Opaque', finish: 'Glass enamel', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', colorAccuracy: 'photo' });
    expect(planned.find((p) => p.beadId === '429-1')?.metadataSource).toBe('card strand opaque; notice');
    expect(skipped).toEqual(['366-1 (no confirmed cell)', '598-1 (no metadata source)']);
    expect(ignoredOverrides).toEqual([]);
  });

  it("reports a reviewed row for a colour the Delica list names, and takes the list's phrase", () => {
    const overrides = parseGlassEnamelOverrides([{ ...overrideRow, colour_no: '2479-1', finish: 'Glass enamel' }]);
    const { planned, ignoredOverrides } = planGlassEnamelBeads([cell('2479-1')], () => twin2479, overrides, () => false);
    expect(planned[0].sidecar.finish).toBe('Glass enamel, Luster');
    expect(ignoredOverrides).toEqual(['2479-1 (Miyuki\'s Delica list names it: DB268-1 "Opaque - Glass Enamel - Luster")']);
  });

  it('refuses a reviewed row with a blank attribute or no evidence', () => {
    expect(parseGlassEnamelOverrides([overrideRow]).get('429-1')).toEqual({ glassGroup: 'Opaque', finish: 'Glass enamel', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', evidence: 'card strand opaque; notice' });
    expect(() => parseGlassEnamelOverrides([{ ...overrideRow, finish: ' ' }])).toThrow(/429-1 has no finish/);
    expect(() => parseGlassEnamelOverrides([{ ...overrideRow, evidence: '' }])).toThrow(/429-1 has no evidence/);
  });

  it('needs the archived URL and the SHA-256 of the card it crops', () => {
    const sha256 = '8754a23fe714e9b8c4561291f46f4ad0d3b1aeb6ce67a14b402af7cb764f58fc';
    expect(archivedCard([{ card: 'TE-64', archived_url: 'https://web.archive.org/x', sha256 }], 'TE-64')).toEqual({ url: 'https://web.archive.org/x', sha256 });
    expect(() => archivedCard([{ card: 'TE-64', archived_url: '', sha256 }], 'TE-64')).toThrow(/TE-64 needs its archived_url and sha256/);
    expect(() => archivedCard([{ card: 'TE-64', archived_url: 'https://web.archive.org/x', sha256: 'abc' }], 'TE-64')).toThrow(/needs its archived_url and sha256/);
    expect(() => archivedCard([], 'TE-64')).toThrow(/needs its archived_url/);
  });

  it('skips a cell row whose status or cell is missing instead of failing', () => {
    const { planned, skipped } = planGlassEnamelBeads([{ colour_no: '2479-1' }], () => twin2479, new Map(), () => false);
    expect(planned).toEqual([]);
    expect(skipped).toEqual(['2479-1 (no confirmed cell)']);
  });

  it('records the archived card, the cell and the sizes in the registry row', () => {
    const { planned } = planGlassEnamelBeads([cell('2479-1')], () => twin2479, new Map(), () => false);
    const row = glassEnamelRegistryRow(planned[0], 'https://web.archive.org/web/2024/te-64.pdf', '2026-10-23');
    expect(row).toMatchObject({ beadId: '2479-1', size: '15', listingSource: 'sample-card', imageSource: 'sample-card', colorAccuracy: 'photo', addedOn: '2026-10-23' });
    expect(row.sourceRef).toContain('sample card TE-64 (archived: https://web.archive.org/web/2024/te-64.pdf) strand cell (10,20,500,150) at 300 dpi');
    expect(row.sourceRef).toContain('seed twin of DB268-1');
  });
});
