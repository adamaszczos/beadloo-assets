import { describe, expect, it } from 'vitest';
import {
  buildCatalogueSidecar,
  catalogueCropName,
  catalogueDelicaId,
  metadataDonorCandidates,
} from '../../../../scripts/beads/miyuki/catalogue/add-delica-beads.js';

describe('catalogue Delica rows', () => {
  it('turns a row into the canonical bead ID and the crop file name', () => {
    expect(catalogueDelicaId({ colour_no: '665', prefix: 'DB' })).toBe('DB0665');
    expect(catalogueDelicaId({ colour_no: '10', prefix: 'DBC' })).toBe('DBC0010');
    expect(catalogueDelicaId({ colour_no: '22L', prefix: 'DBSC' })).toBe('DBSC0022L');
    expect(catalogueDelicaId({ colour_no: 'x', prefix: 'DB' })).toBeNull();
    expect(catalogueDelicaId({ colour_no: '1', prefix: 'DBX' })).toBeNull();
    expect(catalogueCropName({ colour_no: '10', prefix: 'DBC' })).toBe('DBC10.png');
  });

  it('looks for the metadata donor at the same size first, then at 11/0', () => {
    expect(metadataDonorCandidates('DBC0010')).toEqual(['DB0010']);
    expect(metadataDonorCandidates('DBSC0024')).toEqual(['DBS0024', 'DB0024']);
    expect(metadataDonorCandidates('DBM0626')).toEqual(['DBM0626', 'DB0626']);
    expect(metadataDonorCandidates('nope')).toEqual([]);
  });

  it('builds the sidecar from the donor without its colour group, with cut, status and swatch accuracy', () => {
    const donor = { shape: 'Delica', size: '11/0', colorGroup: 'Red', glassGroup: 'Opaque', finish: 'Luster', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', formerly: 'DB0001' };
    expect(buildCatalogueSidecar('DBSC0024', '15', donor, { cut: true, discontinued: false })).toEqual({
      shape: 'Delica',
      size: '15/0',
      glassGroup: 'Opaque',
      finish: 'Luster',
      dyed: 'Non Dyed',
      galvanized: 'Non-galvanized',
      plating: 'Non-Plating',
      cut: 'Cut',
      colorAccuracy: 'swatch',
    });
    const plain = buildCatalogueSidecar('DB0665', '11', { ...donor, finish: undefined as unknown as string }, { cut: false, discontinued: true });
    expect(plain.finish).toBe('Not Specified');
    expect(plain.status).toBe('Discontinued');
    expect(plain.cut).toBeUndefined();
    expect(Object.keys(plain)).toEqual(['shape', 'size', 'glassGroup', 'finish', 'dyed', 'galvanized', 'plating', 'status', 'colorAccuracy']);
  });
});
