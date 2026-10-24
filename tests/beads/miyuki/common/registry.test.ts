import { describe, expect, it } from 'vitest';
import {
  compareBeadIds,
  formatRegistryCsv,
  isMiyukiPhotoRow,
  parseRegistryCsv,
  registryRowProblem,
  upsertRegistryRows,
  writeBeadsAndRegistry,
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

describe('registry values', () => {
  it('names a source or colour accuracy the registry does not know', () => {
    expect(registryRowProblem(row('1', '11'))).toBeNull();
    expect(registryRowProblem(row('1', '11', { imageSource: 'shop-photo' as RegistryRow['imageSource'] }))).toBe('unknown imageSource "shop-photo"');
    expect(registryRowProblem(row('1', '11', { sizeSource: '' as RegistryRow['sizeSource'] }))).toBe('unknown sizeSource ""');
    expect(registryRowProblem(row('1', '11', { colorAccuracy: 'exact' as RegistryRow['colorAccuracy'] }))).toBe('unknown colorAccuracy "exact"');
  });

  it("tells Miyuki's own photo from a shop's listing, a rendered bead and a lesser colour", () => {
    expect(isMiyukiPhotoRow(row('1', '15'))).toBe(true);
    expect(isMiyukiPhotoRow(row('1', '15', { listingSource: 'sample-card', imageSource: 'sample-card' }))).toBe(true);
    expect(isMiyukiPhotoRow(row('2046', '11', { listingSource: 'retailer', imageSource: 'rendered', colorAccuracy: 'photo' }))).toBe(false);
    expect(isMiyukiPhotoRow(row('1', '15', { colorAccuracy: 'swatch' }))).toBe(false);
    expect(isMiyukiPhotoRow(undefined)).toBe(false);
  });
});

describe('writing beads with their registry rows', () => {
  it('saves the rows of the beads written before one fails, so none is left without its row', async () => {
    let saved: RegistryRow[] = [];
    const store = { read: () => [row('9', '11')], write: (rows: RegistryRow[]) => { saved = rows; } };
    const write = (beadId: string) => {
      if (beadId === '3') throw new Error('crop failed');
      return row(beadId, '11');
    };
    await expect(writeBeadsAndRegistry('miyuki-round_rocailles', ['1', '2', '3', '4'], write, store)).rejects.toThrow('crop failed');
    expect(saved.map((r) => r.beadId).sort()).toEqual(['1', '2', '9']);
  });

  it('adds every row when all beads are written, and touches nothing when there are none', async () => {
    let writes = 0;
    const store = { read: () => [row('1', '11')], write: () => { writes += 1; } };
    expect(await writeBeadsAndRegistry('miyuki-round_rocailles', ['1', '2'], (beadId) => row(beadId, '11'), store)).toBe(1);
    expect(await writeBeadsAndRegistry('miyuki-round_rocailles', [], (beadId: string) => row(beadId, '11'), store)).toBe(0);
    expect(writes).toBe(1);
  });
});
