import { describe, expect, it } from 'vitest';
import {
  aliasCandidatesFromColorChange,
  aliasCandidatesFromDirectory,
  assertCanonicalDelicaAliases,
  buildAliasFiles,
} from '../../../../scripts/beads/miyuki/common/aliases.js';
import { parseColorChangeTsv } from '../../../../scripts/beads/miyuki/common/official-lists.js';

const colorChange = parseColorChangeTsv(
  [
    'Old(Tentative)\t[0]order\tnew_flag\tUnified\t[3]order\tnew_flag2\tNP_flag\tRemark\twork2\twork3\twork4',
    '701\t60\t\t1\t3\tRound 8/0\t\t\t\t\t',
    '713\t61\t\t10 S.H.\t4\t\t\t\t\t\t',
    '1\t62\t\t1\t5\t\t\t\t\t\t',
    '31\t70\t\t3\t17\tBugle 1.5mm\t\t\t\t\t',
    '131S\t117\t\t1\t8\tSquare Hole Round 11/0\t\t\t\t\t',
    '131S-F\t118\t\t1F\t12\t\t\t\t\t\t',
  ].join('\n')
);

describe('alias candidates', () => {
  it('reads only the Round sections of the old/new table, with square hole and without self-aliases', () => {
    expect(aliasCandidatesFromColorChange(colorChange)).toEqual([
      { beadType: 'miyuki-round_rocailles', size: '8', oldId: '701', officialId: '1', source: 'color_change.tsv Round 8/0' },
      { beadType: 'miyuki-round_rocailles', size: '8', oldId: '713', officialId: '10SH', source: 'color_change.tsv Round 8/0' },
      { beadType: 'miyuki-round_rocailles', size: '11', oldId: '131S', officialId: '1SH', source: 'color_change.tsv Square Hole Round 11/0' },
      { beadType: 'miyuki-round_rocailles', size: '11', oldId: '131S-F', officialId: '1FSH', source: 'color_change.tsv Square Hole Round 11/0' },
    ]);
  });
});

describe('alias candidates from the square-hole sections and the directory', () => {
  it('reads a Square Hole Round section as that size with SH on the official id', () => {
    const squareHole = aliasCandidatesFromColorChange(colorChange).filter((c) => c.oldId.startsWith('131S'));
    expect(squareHole).toEqual([
      { beadType: 'miyuki-round_rocailles', size: '11', oldId: '131S', officialId: '1SH', source: 'color_change.tsv Square Hole Round 11/0' },
      { beadType: 'miyuki-round_rocailles', size: '11', oldId: '131S-F', officialId: '1FSH', source: 'color_change.tsv Square Hole Round 11/0' },
    ]);
  });

  it('reads the old number a directory product name carries in brackets, at that size', () => {
    const listings = [
      { beadType: 'miyuki-round_rocailles' as const, beadId: '1', size: '6', oldNumber: '131S', name: '#1(131S) Round Rocailles 6/0' },
      { beadType: 'miyuki-round_rocailles' as const, beadId: '2', size: '6', name: '#2 Round Rocailles 6/0' },
      { beadType: 'miyuki-round_rocailles' as const, beadId: '260', size: '6', oldNumber: '260', name: '#260(260) Round Rocailles 6/0' },
    ];
    expect(aliasCandidatesFromDirectory(listings)).toEqual([
      { beadType: 'miyuki-round_rocailles', size: '6', oldId: '131S', officialId: '1', source: 'directory name "#1(131S) Round Rocailles 6/0"' },
    ]);
  });
});

describe('buildAliasFiles', () => {
  const candidates = aliasCandidatesFromColorChange(colorChange);
  const disk: Record<string, Set<string>> = {
    'miyuki-delica/11': new Set(['DB0001', 'DB0106', 'DB0106-1']),
    'miyuki-round_rocailles/8': new Set(['1', '10SH']),
    'miyuki-round_rocailles/11': new Set(['1SH', '131S']),
  };
  const lookup = (beadType: string, size: string) => disk[`${beadType}/${size}`] ?? new Set<string>();

  it('emits an alias only where the official bead is on disk and keeps the rest pending', () => {
    const result = buildAliasFiles(candidates, lookup as never);
    expect(result.files['miyuki-round_rocailles/8']).toEqual({ '701': '1', '713': '10SH' });
    expect(result.files['miyuki-round_rocailles/15']).toEqual({});
    expect(result.pending.map((c) => c.oldId)).toEqual(['131S', '131S-F']);
    expect(() => assertCanonicalDelicaAliases(result.files)).not.toThrow();
  });

  it('never aliases away an old number that is itself a bead at that size', () => {
    const result = buildAliasFiles(candidates, lookup as never);
    // 131S → 1SH at 11/0 is withheld because 131S is on disk there in this fixture.
    expect(result.files['miyuki-round_rocailles/11']).toEqual({});
    const delica = buildAliasFiles([{ beadType: 'miyuki-delica', size: '11', oldId: 'DB0106', officialId: 'DB0106-1', source: 'test' }], lookup as never);
    expect(delica.files['miyuki-delica/11']).toEqual({});
  });

  it('refuses a Delica alias that is not a Delica ID', () => {
    expect(() => assertCanonicalDelicaAliases({ 'miyuki-delica/11': { '1': 'DB0001' } })).toThrow(/not a Delica ID/);
  });
});
