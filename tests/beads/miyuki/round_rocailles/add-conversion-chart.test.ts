import { describe, expect, it } from 'vitest';
import { chartRegistryRow, chartRoundId, parseConversionChartHtml, planConversionChartBeads } from '../../../../scripts/beads/miyuki/round_rocailles/add-conversion-chart.js';
import { registryKey, type RegistryRow } from '../../../../scripts/beads/miyuki/common/registry.js';

const cell = (text: string) => `<TD align="center" bgcolor="#FFFFFF">${text}</TD>`;
const row = (a: string, b: string) => `<TR bgcolor="#FFFFFF">\n${cell(a)}\n${cell(b)}\n</TR>`;

describe("Miyuki's 2007 Delica-Round conversion chart", () => {
  it('reads a printed round number as the library id, zeros dropped, and leaves every slash form out', () => {
    expect(chartRoundId('2039')).toBe('2039');
    expect(chartRoundId('0011D')).toBe('11D');
    expect(chartRoundId('0140FR')).toBe('140FR');
    // `/L` is Miyuki's RL finish (color_change.tsv: "155/L(155RL)", "417L/L(417L-RL)"), not the L shade
    expect(chartRoundId('3300/L')).toBeNull();
    expect(chartRoundId('0141D/FR')).toBeNull();
  });

  it('throws on text that is not a round-rocaille number rather than make up an id', () => {
    expect(() => chartRoundId('0140X')).toThrow(/"0140X" is not a round-rocaille number/);
    expect(() => chartRoundId('Color No')).toThrow(/not a round-rocaille number/);
  });

  it('pairs the two cells of each row in the order the page prints them, skipping the header and the layout rows', () => {
    const header = `<TR><TD align="center" bgcolor="#D6D6EB">11/0 RR </TD><TD align="center" bgcolor="#D6D6EB">Delica No. </TD></TR>`;
    const layout = `<TR><TD>&nbsp;</TD><TD></TD><TD></TD></TR>`;
    const roundToDelica = `${layout}${header}${row('2039', '0377')}${row('3300/L', '1530')}${row('0141D/FR', '0867')}`;
    expect(parseConversionChartHtml(roundToDelica, true)).toEqual({
      pairs: [{ printed: '2039', roundId: '2039', delica: '0377' }],
      leftOut: ['3300/L', '0141D/FR'],
    });
    expect(parseConversionChartHtml(row('0377', '2039'), false).pairs).toEqual([{ printed: '2039', roundId: '2039', delica: '0377' }]);
  });
});

describe('planning the chart colours', () => {
  const registryRow = (beadId: string, size: string, overrides: Partial<RegistryRow> = {}): RegistryRow => ({ beadId, size, listingSource: 'directory', imageSource: 'directory', sizeSource: 'directory', colorAccuracy: 'photo', sourceRef: '', addedOn: '2026-10-16', ...overrides });
  const rows = [registryRow('2039', '15'), registryRow('1684', '15'), registryRow('2045', '15', { listingSource: 'retailer', imageSource: 'rendered', colorAccuracy: 'approximate' }), registryRow('22', '11')];
  const registry = new Map(rows.map((r) => [registryKey(r.beadId, r.size), r]));
  const pairs = (...ids: string[]) => ids.map((id) => ({ printed: id, roundId: id, delica: '0001' }));
  const library = {
    registry,
    inLibrary: (beadId: string) => beadId === '22',
    renumberedTo: (beadId: string) => (beadId === '181' ? '1051' : null),
    originalExists: (_size: string, beadId: string) => beadId !== '1684',
    sidecar: () => ({ glassGroup: 'Opaque', finish: 'Outside-Dyed', dyed: 'Outside Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating' }),
  };

  it("adds a colour only with Miyuki's photo of it at another size, never a shop's or a rendered one", () => {
    const plan = planConversionChartBeads([{ url: 'u1', pairs: pairs('2039', '22', '181', '1684', '2045') }, { url: 'u2', pairs: pairs('2039') }], library);
    expect(plan.planned.map((p) => [p.beadId, p.donorSize, p.donorSource, p.url])).toEqual([['2039', '15', 'directory', 'u1']]);
    expect(plan.colours).toBe(5);
    expect(plan.oldNumbers).toEqual(['181 → 1051']);
    expect(plan.noPhoto).toEqual(['1684 (DB0001)', '2045 (DB0001)']);
    expect(chartRegistryRow(plan.planned[0], '2026-10-24')).toMatchObject({ beadId: '2039', size: '11', listingSource: 'conversion-chart-2007', imageSource: 'same-colour-other-size', colorAccuracy: 'photo' });
  });
});
