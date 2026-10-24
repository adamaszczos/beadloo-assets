import { describe, expect, it } from 'vitest';
import {
  buildRoundRocailleSidecar,
  catalogueCropName,
  catalogueRoundRocailleId,
  chooseImageDonor,
  chooseMetadataDonor,
  isColourRow,
  resolveCatalogueBead,
} from '../../../../scripts/beads/miyuki/catalogue/add-round-rocaille-beads.js';
import type { Sidecar } from '../../../../scripts/beads/miyuki/common/bead-files.js';

const donor: Sidecar = { shape: 'Round Rocailles', size: '11/0', colorGroup: 'Red', glassGroup: 'Transparent', finish: 'Silverline', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', formerly: 'x', colorAccuracy: 'photo' };

describe('catalogue round-rocaille rows', () => {
  it('names the bead as printed, with SH for square hole (a -1 colour is never the plain number)', () => {
    expect(catalogueRoundRocailleId({ colour_no: '138f', hole: 'RH' })).toBe('138F');
    expect(catalogueRoundRocailleId({ colour_no: '1', hole: 'SH' })).toBe('1SH');
    expect(catalogueRoundRocailleId({ colour_no: '2023', hole: 'RH' })).toBe('2023');
    expect(catalogueCropName({ colour_no: '1', hole: 'SH' })).toBe('1-SH.png');
    expect(catalogueCropName({ colour_no: 'HB167', hole: 'RH' })).toBe('HB167.png');
  });

  it('leaves the Mix page out: a mix is not a colour', () => {
    expect(isColourRow({ section_en: 'Mix Beads' })).toBe(false);
    expect(isColourRow({ section_en: 'Silverlined' })).toBe(true);
  });

  it('takes the photo of the same colour at the nearest preferred size, never from its own size', () => {
    const photoSizes = (beadId: string) => (beadId === '404' ? ['6', '8', '1'] : []);
    expect(chooseImageDonor('404', '1', { photoSizes })).toBe('8');
    expect(chooseImageDonor('404', '8', { photoSizes })).toBe('6');
    expect(chooseImageDonor('1SH', '11', { photoSizes })).toBeNull();
  });

  it('takes the metadata from the same colour at another size, else for square hole from the round-hole bead', () => {
    const sidecars: Record<string, Sidecar> = { '11:1': donor, '6:1SH': { ...donor, size: '6/0' } };
    const lookup = { sidecar: (id: string, size: string) => sidecars[`${size}:${id}`] ?? null };
    expect(chooseMetadataDonor('1SH', '11', null, lookup)?.source).toBe('official attributes of 1SH at 6/0 (directory)');
    expect(chooseMetadataDonor('1SH', '8', null, { sidecar: (id: string, size: string) => (id === '1' && size === '11' ? donor : null) })?.source).toBe('official attributes of 1 at 11/0 (directory)');
    expect(chooseMetadataDonor('404', '1', '8', { sidecar: (id: string, size: string) => (id === '404' && size === '8' ? donor : null) })?.source).toBe('official attributes of 404 at 8/0 (directory)');
    expect(chooseMetadataDonor('9999', '11', null, lookup)).toBeNull();
  });

  it('lets the caller keep only some donors and name their source, for the square-hole fallback too', () => {
    const sidecars: Record<string, Sidecar> = { '6:1SH': { ...donor, size: '6/0' }, '11:1': donor };
    const lookup = { sidecar: (id: string, size: string) => sidecars[`${size}:${id}`] ?? null };
    const directoryOnly = { accept: (id: string, size: string) => `${size}:${id}` === '11:1', sourceLabel: (id: string, size: string) => `listed ${id}@${size}` };
    expect(chooseMetadataDonor('1SH', '2', null, lookup, directoryOnly)).toEqual({ sidecar: donor, source: 'listed 1@11' });
    expect(chooseMetadataDonor('1SH', '2', null, lookup, { accept: () => false })).toBeNull();
  });

  it('builds the sidecar: colour group only from a directory donor, the hole when it applies', () => {
    expect(buildRoundRocailleSidecar('11', donor, { squareHole: true, colorAccuracy: 'photo', keepColorGroup: true })).toEqual({
      shape: 'Round Rocailles',
      size: '11/0',
      colorGroup: 'Red',
      glassGroup: 'Transparent',
      finish: 'Silverline',
      dyed: 'Non Dyed',
      galvanized: 'Non-galvanized',
      plating: 'Non-Plating',
      hole: 'Square Hole',
      colorAccuracy: 'photo',
    });
    const fromHeading = buildRoundRocailleSidecar('5', { ...donor, finish: '' }, { squareHole: false, colorAccuracy: 'swatch', keepColorGroup: false });
    expect(fromHeading.colorGroup).toBeUndefined();
    expect(fromHeading.finish).toBe('Not Specified');
    expect(Object.keys(fromHeading)).toEqual(['shape', 'size', 'glassGroup', 'finish', 'dyed', 'galvanized', 'plating', 'colorAccuracy']);
  });

  it('resolves a row end to end: on disk, photo from another size, swatch with heading metadata, or skipped', () => {
    const sections = new Map([['Silverlined', { glassGroup: 'Transparent', finish: 'Silverline', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', evidence: '50 of 53' }]]);
    const lookup = {
      photoSizes: (beadId: string) => (beadId === '2023' ? ['11'] : []),
      sidecar: (id: string, size: string) => (id === '2023' && size === '11' ? donor : id === '1' && size === '11' ? donor : null),
    };
    const base = { hole: 'RH', section_en: 'Silverlined', page: '26', cell_x: '1.00', cell_y: '2.00' };
    const context = { sections, lookup, hasCrop: (crop: string) => crop.endsWith('/5/250.png') };

    expect(resolveCatalogueBead({ ...base, colour_no: '1', size: '11/0' }, context)).toEqual({ beadId: '1', skip: 'already on disk' });

    const photo = resolveCatalogueBead({ ...base, colour_no: '2023', size: '6/0' }, context);
    expect(photo).toMatchObject({ beadId: '2023', size: '6', image: { kind: 'photo', donorSize: '11' }, sidecar: { colorAccuracy: 'photo', colorGroup: 'Red' } });
    expect((photo as { sidecar: Sidecar }).sidecar.formerly).toBeUndefined();

    const swatch = resolveCatalogueBead({ ...base, colour_no: '250', size: '5/0' }, context);
    expect(swatch).toMatchObject({ beadId: '250', size: '5', image: { kind: 'swatch' }, sidecar: { colorAccuracy: 'swatch', finish: 'Silverline' } });
    expect((swatch as { sidecar: Sidecar }).sidecar.colorGroup).toBeUndefined();

    expect(resolveCatalogueBead({ ...base, colour_no: '251', size: '5/0' }, context)).toMatchObject({ beadId: '251', skip: expect.stringContaining('no photo at another size and no swatch crop') });
    expect(resolveCatalogueBead({ ...base, colour_no: '250', size: '5/0', section_en: 'Unknown Heading' }, context)).toMatchObject({ skip: expect.stringContaining('unmapped') });
  });
});
