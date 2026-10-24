import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import {
  canonicalDelicaId,
  parseColorChangeTsv,
  parseDurabilityTsv,
  readColorChangeTsv,
  readDurabilityTsv,
  renumbering,
  COLOR_CHANGE_TSV_PATH,
  DURABILITY_TSV_PATH,
} from '../../../../scripts/beads/miyuki/common/official-lists.js';

describe('canonicalDelicaId', () => {
  it('zero-pads and keeps suffixes and the -1 marker', () => {
    expect(canonicalDelicaId('DB1')).toBe('DB0001');
    expect(canonicalDelicaId('DB106-1')).toBe('DB0106-1');
    expect(canonicalDelicaId('DB31L')).toBe('DB0031L');
    expect(canonicalDelicaId('db1538-1')).toBe('DB1538-1');
    expect(canonicalDelicaId('DBL1')).toBeNull(); // the list holds 11/0 DB numbers only
    expect(canonicalDelicaId('1')).toBeNull();
  });
});

describe('parseDurabilityTsv', () => {
  const sample = [
    'DB#\tSeed#\told#\t廃番\tDiscontinued\tガラス種類／加工名\tGlass Type / Finish\tA：変色\tB：色剥げ\tC：色落ち',
    'DB1\t451\t\t\t\tメタリック\tMetallic\t2\t2\t2',
    'DB32\t\t\t廃番\tDiscontinued\tメタリック\tMetallic\t2\t2\t2',
    'DB106-1\t2562-1\t\t\t\tギョク\tOpaque - Glass Enamel\t1\t1\t1',
    'DB41\t1\t401R\t\t\tギンビキ\tSilver Lined\t2\t3\t3',
  ].join('\n');

  it('reads every column into typed rows', () => {
    const rows = parseDurabilityTsv(sample);
    expect(rows.map((r) => r.beadId)).toEqual(['DB0001', 'DB0032', 'DB0106-1', 'DB0041']);
    expect(rows[1].discontinued).toBe(true);
    expect(rows[0].discontinued).toBe(false);
    expect(rows[2]).toMatchObject({ renumbered: true, seedNumber: '2562-1', glassTypeFinish: 'Opaque - Glass Enamel' });
    expect(rows[3]).toMatchObject({ seedNumber: '1', oldNumber: '401R', durability: { colorChange: '2', peeling: '3', fading: '3' } });
  });

  it('rejects a row whose DB number is not a DB number', () => {
    expect(() => parseDurabilityTsv(`${sample}\nXYZ\t\t\t\t\t\t\t\t\t`)).toThrow(/unexpected DB number/);
  });
});

describe('parseColorChangeTsv', () => {
  const sample = [
    'Old(Tentative)\t[0]order\tnew_flag\tUnified\t[3]order\tnew_flag2\tNP_flag\tRemark\twork2\twork3\twork4',
    '1R\t1\t\t1001\t393\t\t\t\t\t\t',
    '31\t38\t\t3\t17\tBugle 1.5mm\t\t\t\t\t',
    '33\t42\t\t3 S.H.\t18\t\t\t\t\t\t',
    '701\t60\t\t1\t3\tRound 8/0\t\t\t\t\t',
    '133S\t61\t\t2422(3 in RR 5/0)\t400\t\t\t\t\t\t',
  ].join('\n');

  it('forward-fills the section and separates the unified number from its decorations', () => {
    const rows = parseColorChangeTsv(sample);
    expect(rows.map((r) => r.section)).toEqual(['', 'Bugle 1.5mm', 'Bugle 1.5mm', 'Round 8/0', 'Round 8/0']);
    expect(rows[2]).toMatchObject({ oldNumber: '33', unified: '3', squareHole: true, shape: 'Bugle', size: '' });
    expect(rows[3]).toMatchObject({ oldNumber: '701', unified: '1', squareHole: false, shape: 'Round', size: '8' });
    expect(rows[4]).toMatchObject({ oldNumber: '133S', unified: '2422', unifiedRaw: '2422(3 in RR 5/0)', squareHole: false });
  });

  it('names the number a colour was renumbered to, and nothing for one that keeps its number', () => {
    const renumberedTo = renumbering(parseColorChangeTsv(sample));
    expect(renumberedTo('1R')).toBe('1001');
    expect(renumberedTo('133s')).toBe('2422');
    expect(renumberedTo('1001')).toBeNull();
    expect(renumbering([{ oldNumber: '3', unified: '3' }])('3')).toBeNull();
  });
});

describe('the committed snapshots', () => {
  it.skipIf(!fs.existsSync(DURABILITY_TSV_PATH))('durability.tsv holds the 1,295 official Delica colours with 81 discontinued and 51 renumbered', () => {
    const rows = readDurabilityTsv();
    expect(rows).toHaveLength(1295);
    expect(rows.filter((r) => r.discontinued)).toHaveLength(81);
    expect(rows.filter((r) => r.renumbered)).toHaveLength(51);
    expect(new Set(rows.map((r) => r.beadId)).size).toBe(1295);
  });

  it.skipIf(!fs.existsSync(COLOR_CHANGE_TSV_PATH))('color_change.tsv holds 493 rows with 87 in the Round 8/0 section', () => {
    const rows = readColorChangeTsv();
    expect(rows).toHaveLength(493);
    expect(rows.filter((r) => r.section === 'Round 8/0')).toHaveLength(87);
    expect(rows.every((r) => r.unified !== '')).toBe(true);
  });
});
