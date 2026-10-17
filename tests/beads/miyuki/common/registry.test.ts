import { describe, expect, it } from 'vitest';
import {
  compareBeadIds,
  formatRegistryCsv,
  parseRegistryCsv,
  upsertRegistryRows,
  type RegistryRow,
} from '../../../../scripts/beads/miyuki/common/registry.js';

const row = (beadId: string, size: string, extra: Partial<RegistryRow> = {}): RegistryRow => ({
  beadId,
  size,
  listingSource: 'directory',
  imageSource: 'directory',
  sizeSource: 'directory',
  colorAccuracy: 'photo',
  sourceRef: `product:${beadId}`,
  addedOn: '2026-10-16',
  ...extra,
});

describe('registry CSV', () => {
  it('round-trips rows, quoting only when needed, sorted by size then numeric ID', () => {
    const rows = [row('DB0010', '11', { sourceRef: 'page 70, cell "A, B"' }), row('DB0002', '11'), row('DBL0001', '8')];
    const csv = formatRegistryCsv(rows);
    expect(csv.split('\n')[0]).toBe('beadId,size,listingSource,imageSource,sizeSource,colorAccuracy,sourceRef,addedOn');
    expect(csv).toContain('"page 70, cell ""A, B"""');
    expect(parseRegistryCsv(csv).map((r) => `${r.size}:${r.beadId}`)).toEqual(['8:DBL0001', '11:DB0002', '11:DB0010']);
    expect(parseRegistryCsv(csv)[2].sourceRef).toBe('page 70, cell "A, B"');
  });

  it('orders bead IDs numerically within a prefix', () => {
    expect(['10', '3', '1001', '3SH', 'HB167', '1'].sort(compareBeadIds)).toEqual(['1', '3', '3SH', '10', '1001', 'HB167']);
  });

  it('never overwrites an existing row', () => {
    const existing = [row('1', '11', { colorAccuracy: 'photo' })];
    const { rows, added } = upsertRegistryRows(existing, [row('1', '11', { colorAccuracy: 'swatch' }), row('2', '11')]);
    expect(added).toBe(1);
    expect(rows.find((r) => r.beadId === '1')?.colorAccuracy).toBe('photo');
  });

  it('rejects a file with another header', () => {
    expect(() => parseRegistryCsv('a,b\n1,2\n')).toThrow(/Unexpected registry header/);
  });
});
