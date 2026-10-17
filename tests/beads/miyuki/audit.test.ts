import { describe, expect, it } from 'vitest';
import { baseColourNumber, catalogueRowToBeadId, seedColourNumber, countColourAccuracy, countSquareHole, isCatalogueColourRow, lookupColour, parseCatalogueCsv, sortSizes } from '../../../scripts/beads/miyuki/audit.js';
import { diffSidecarFields } from '../../../scripts/beads/miyuki/common/sidecar-diff.js';

describe('audit helpers', () => {
  it('strips the -1 marker and the square-hole suffix from a colour number', () => {
    expect(baseColourNumber('2479-1')).toBe('2479');
    expect(baseColourNumber('3271sh')).toBe('3271');
    expect(baseColourNumber('1F')).toBe('1F');
  });

  it("turns a catalogue row into Beadloo's bead ID", () => {
    expect(catalogueRowToBeadId({ colour_no: '22L', hole: 'RH', prefix: 'DB' }, 'miyuki-delica')).toBe('DB0022L');
    expect(catalogueRowToBeadId({ colour_no: '1', hole: 'RH', prefix: 'DBLC' }, 'miyuki-delica')).toBe('DBLC0001');
    expect(catalogueRowToBeadId({ colour_no: '1130', hole: 'RH', prefix: 'DB' }, 'miyuki-delica')).toBe('DB1130');
    expect(catalogueRowToBeadId({ colour_no: '1', hole: 'SH', prefix: '' }, 'miyuki-round_rocailles')).toBe('1SH');
    expect(catalogueRowToBeadId({ colour_no: 'HB167', hole: 'RH', prefix: '' }, 'miyuki-round_rocailles')).toBe('HB167');
  });

  it('keeps a -1 seed number apart from the plain number, dropping only the square-hole suffix', () => {
    expect(seedColourNumber('2479-1')).toBe('2479-1');
    expect(seedColourNumber('3271sh')).toBe('3271');
    expect(seedColourNumber('366')).toBe('366');
  });

  it('counts registry rows per colour accuracy', () => {
    expect(countColourAccuracy([{ colorAccuracy: 'photo' }, { colorAccuracy: 'swatch' }, { colorAccuracy: 'photo' }])).toEqual({ photo: 2, swatch: 1 });
    expect(countColourAccuracy([])).toEqual({});
  });

  it('leaves the Mix page out and counts square-hole ids per size', () => {
    expect(isCatalogueColourRow({ section_en: 'Mix Beads' })).toBe(false);
    expect(isCatalogueColourRow({ section_en: 'Silverlined' })).toBe(true);
    expect(countSquareHole(new Map([['6', new Set(['1', '1SH', '3SH'])], ['11', new Set(['1'])]]))).toEqual([['6', 2]]);
  });

  it('sorts sizes numerically', () => {
    expect(sortSizes(['15', '2', '11', '6'])).toEqual(['2', '6', '11', '15']);
  });

  it('reads the catalogue CSV columns it needs', () => {
    const rows = parseCatalogueCsv('colour_no,size,hole,prefix,section_ja,section_en,page,cell_x,cell_y,cell_w,cell_h,code_no\n1,11/0,SH,,スキ,Transparent,14,1,2,3,4,H 4\nDB665,11/0,RH,DB,,Opaque,70,1,2,3,4,x\n');
    expect(rows).toEqual([
      { colour_no: '1', size: '11/0', hole: 'SH', prefix: '', page: '14', section_en: 'Transparent' },
      { colour_no: 'DB665', size: '11/0', hole: 'RH', prefix: 'DB', page: '70', section_en: 'Opaque' },
    ]);
    expect(parseCatalogueCsv('')).toEqual([]);
  });
});

describe('diffSidecarFields', () => {
  it('reports value differences and a changed key order', () => {
    expect(diffSidecarFields({ shape: 'Delica', finish: 'Luster' }, { shape: 'Delica', finish: 'Luster' })).toEqual([]);
    expect(diffSidecarFields({ shape: 'Delica', finish: 'Luster' }, { shape: 'Delica', finish: 'Matte' })).toEqual(['finish: "Luster" → "Matte"']);
    expect(diffSidecarFields({ a: '1', b: '2' }, { b: '2', a: '1' })).toEqual(['key order: a,b → b,a']);
    expect(diffSidecarFields({ a: '1' }, { a: '1', colorGroup: 'Blue' })).toEqual(['colorGroup: undefined → "Blue"']);
  });
});

describe('lookupColour', () => {
  it('reports every source a colour number appears in, ignoring leading zeros and suffixes', () => {
    const inventory = new Map([['11', new Set(['22', '22F'])], ['8', new Set(['1'])]]);
    const listings = [
      { beadType: 'miyuki-round_rocailles', beadId: '22', size: '11', hole: 'RH', name: '', sku: '', productId: 1, permalink: '', attributes: [], conflicts: [] },
    ] as never;
    const catalogue = [
      { colour_no: '22', size: '15/0', hole: 'RH', prefix: '', page: '19' },
      { colour_no: '22', size: '8/0', hole: 'SH', prefix: '', page: '21' },
      { colour_no: '327', size: '15/0', hole: 'RH', prefix: '', page: '18' },
    ];
    const delicaRows = [
      { dbNumber: 'DB1340', beadId: 'DB1340', renumbered: false, seedNumber: '1340', oldNumber: '', discontinued: false, glassTypeFinishJa: '', glassTypeFinish: 'Silver Lined', durability: { colorChange: '', peeling: '', fading: '' } },
      { dbNumber: 'DB268-1', beadId: 'DB0268-1', renumbered: true, seedNumber: '2479-1', oldNumber: '', discontinued: false, glassTypeFinishJa: '', glassTypeFinish: 'Opaque - Glass Enamel - Luster', durability: { colorChange: '', peeling: '', fading: '' } },
    ];
    expect(lookupColour('0022', inventory, listings, catalogue, delicaRows)).toEqual({
      colourNo: '0022',
      onDisk: ['11/0 (22)'], // 22F is another colour (a finish suffix), never merged with 22
      directory: ['11/0 (22)'],
      catalogue: ['15/0 p.19', '8/0 SH p.21'],
      delicaEquivalents: [],
    });
    expect(lookupColour('2479', inventory, listings, catalogue, delicaRows).delicaEquivalents).toEqual(['DB0268-1 (Opaque - Glass Enamel - Luster)']);
    expect(lookupColour('2046', inventory, listings, catalogue, delicaRows)).toEqual({ colourNo: '2046', onDisk: [], directory: [], catalogue: [], delicaEquivalents: [] });
  });
});
