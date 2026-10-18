import { describe, expect, it } from 'vitest';
import {
  classifyDirectoryProduct,
  classifyDirectoryProducts,
  decodeHtmlEntities,
  delicaBeadId,
  fullSizeImageUrl,
  joinAttributeTerms,
  parseDelicaName,
  parseRoundRocaillesName,
  parseRoundRocaillesSku,
  reduceStoreProduct,
  sidecarFromAttributes,
  type DirectoryProduct,
} from '../../../../scripts/beads/miyuki/common/directory-products.js';

function product(overrides: Partial<DirectoryProduct>): DirectoryProduct {
  return {
    id: 1,
    sku: '',
    name: '',
    slug: '',
    permalink: 'https://directory.miyuki-beads.co.jp/x/',
    categories: [],
    images: [],
    attributes: [],
    ...overrides,
  };
}

/**
 * The 53 round-rocaille products the old shop scraper dropped, exactly as the directory names them
 * (issue adamaszczos/beadloo#203, comment 6215610001): 35 with Miyuki's old number in brackets and
 * 18 square-hole products. Every one must parse.
 */
const DROPPED_BY_OLD_SCRAPER: Array<[name: string, sku: string, beadId: string, size: string, oldNumber?: string]> = [
  ['#1(131S) Round Rocailles 6/0', 'N-RR6-0001', '1', '6', '131S'],
  ['#6(136S) Round Rocailles 6/0', 'N-RR6-0006', '6', '6', '136S'],
  ['#8(138S) Round Rocailles 6/0', 'N-RR6-0008', '8', '6', '138S'],
  ['#10(140S) Round Rocailles 6/0', 'N-RR6-0010', '10', '6', '140S'],
  ['#11(141S) Round Rocailles 6/0', 'N-RR6-0011', '11', '6', '141S'],
  ['#12(142S) Round Rocailles 6/0', 'N-RR6-0012', '12', '6', '142S'],
  ['#14(143S) Round Rocailles 6/0', 'N-RR6-0014', '14', '6', '143S'],
  ['#16(146S) Round Rocailles 6/0', 'N-RR6-0016', '16', '6', '146S'],
  ['#18(148S) Round Rocailles 6/0', 'N-RR6-0018', '18', '6', '148S'],
  ['#19(150S) Round Rocailles 6/0', 'N-RR6-0019', '19', '6', '150S'],
  ['#20(151S) Round Rocailles 6/0', 'N-RR6-0020', '20', '6', '151S'],
  ['#25(149S) Round Rocailles 6/0', 'N-RR6-0025', '25', '6', '149S'],
  ['#29(135S) Round Rocailles 6/0', 'N-RR6-0029', '29', '6', '135S'],
  ['#471(402R) Round Rocailles 6/0', 'N-RR6-0471', '471', '6', '402R'],
  ['#472(404R) Round Rocailles 6/0', 'N-RR6-0472', '472', '6', '404R'],
  ['#474(406R) Round Rocailles 6/0', 'N-RR6-0474', '474', '6', '406R'],
  ['#475(407R) Round Rocailles 6/0', 'N-RR6-0475', '475', '6', '407R'],
  ['#476(408R) Round Rocailles 6/0', 'N-RR6-0476', '476', '6', '408R'],
  ['#477(409R) Round Rocailles 6/0', 'N-RR6-0477', '477', '6', '409R'],
  ['#478(410R) Round Rocailles 6/0', 'N-RR6-0478', '478', '6', '410R'],
  ['#479(416R) Round Rocailles 6/0', 'N-RR6-0479', '479', '6', '416R'],
  ['#480(411R) Round Rocailles 6/0', 'N-RR6-0480', '480', '6', '411R'],
  ['#481(412R) Round Rocailles 6/0', 'N-RR6-0481', '481', '6', '412R'],
  ['#482(413R) Round Rocailles 6/0', 'N-RR6-0482', '482', '6', '413R'],
  ['#484(414R) Round Rocailles 6/0', 'N-RR6-0484', '484', '6', '414R'],
  ['#2006(1255) Round Rocailles 6/0', 'N-RR6-2006', '2006', '6', '1255'],
  ['#2008(1256) Round Rocailles 6/0', 'N-RR6-2008', '2008', '6', '1256'],
  ['#2422(133S) Round Rocailles 6/0', 'N-RR6-2422', '2422', '6', '133S'],
  ['#29(135S) Round Rocailles 8/0', 'N-RR8-0029', '29', '8', '135S'],
  ['#1011(11R) Round Rocailles 8/0', 'N-RR8-1011', '1011', '8', '11R'],
  ['#2400(134D) Round Rocailles 11/0', 'N-RR11-2400', '2400', '11', '134D'],
  ['#357(2213) Round Rocailles 15/0', 'N-RR15-0357', '357', '15', '2213'],
  ['#468(1961) Round Rocailles 15/0', 'N-RR15-0468', '468', '15', '1961'],
  ['#1051(181) Round Rocailles 15/0', 'N-RR15-1051', '1051', '15', '181'],
  ...Array.from({ length: 18 }, (_, i) => {
    const n = String(3271 + i);
    return [`${n} Round Rocailles (SH) 6/0`, `N-RR6S-${n}`, `${n}SH`, '6'] as [string, string, string, string];
  }),
];

describe('parseRoundRocaillesName', () => {
  it('parses the plain forms the old scraper already accepted', () => {
    expect(parseRoundRocaillesName('#1 Round Rocailles 15/0')).toEqual({ colourNo: '1', size: '15', hole: 'RH' });
    expect(parseRoundRocaillesName('#1F Round Rocailles 15/0')).toEqual({ colourNo: '1F', size: '15', hole: 'RH' });
    expect(parseRoundRocaillesName('#5D Round Rocailles 15/0')).toEqual({ colourNo: '5D', size: '15', hole: 'RH' });
    expect(parseRoundRocaillesName('#3201 Round Rocailles 2/0')).toEqual({ colourNo: '3201', size: '2', hole: 'RH' });
    expect(parseRoundRocaillesName('#131SFR Round Rocailles 11/0')).toEqual({ colourNo: '131SFR', size: '11', hole: 'RH' });
    expect(parseRoundRocaillesName('#1f round rocailles 15/0')).toEqual({ colourNo: '1F', size: '15', hole: 'RH' });
  });

  it('parses an old number in brackets without making it part of the ID', () => {
    expect(parseRoundRocaillesName('#1(131S) Round Rocailles 6/0')).toEqual({ colourNo: '1', size: '6', hole: 'RH', oldNumber: '131S' });
    expect(parseRoundRocaillesName('#260(148R) Round Rocailles 6/0')).toEqual({ colourNo: '260', size: '6', hole: 'RH', oldNumber: '148R' });
  });

  it('parses the square-hole form', () => {
    expect(parseRoundRocaillesName('3271 Round Rocailles (SH) 6/0')).toEqual({ colourNo: '3271', size: '6', hole: 'SH' });
  });

  it('rejects everything else', () => {
    expect(parseRoundRocaillesName('')).toBeNull();
    expect(parseRoundRocaillesName('DB0001 Delica Beads 11/0')).toBeNull();
    expect(parseRoundRocaillesName('TL-420 TILA Beads')).toBeNull();
    expect(parseRoundRocaillesName('#1 Round Rocailles')).toBeNull();
  });
});

describe('parseRoundRocaillesSku', () => {
  it('reads size, square-hole marker and code', () => {
    expect(parseRoundRocaillesSku('N-RR6S-3271')).toEqual({ size: '6', squareHole: true, code: '3271' });
    expect(parseRoundRocaillesSku('N-RR15-0001')).toEqual({ size: '15', squareHole: false, code: '0001' });
    expect(parseRoundRocaillesSku('N-RR6-0148R')).toEqual({ size: '6', squareHole: false, code: '0148R' });
    expect(parseRoundRocaillesSku('DB0001')).toBeNull();
  });
});

describe('parseDelicaName', () => {
  it('parses every prefix and keeps the letter suffix the old scraper dropped', () => {
    expect(parseDelicaName('DB0001 Delica Beads 11/0')).toEqual({ prefix: 'DB', number: '0001', suffix: '', size: '11' });
    expect(parseDelicaName('DB31L Delica Beads 11/0')).toEqual({ prefix: 'DB', number: '31', suffix: 'L', size: '11' });
    expect(parseDelicaName('DB322L Delica Beads 11/0')).toEqual({ prefix: 'DB', number: '322', suffix: 'L', size: '11' });
    expect(parseDelicaName('DBL1234 Delica Beads 8/0')).toEqual({ prefix: 'DBL', number: '1234', suffix: '', size: '8' });
    expect(parseDelicaName('DBM1 Delica Beads 10/0')).toEqual({ prefix: 'DBM', number: '1', suffix: '', size: '10' });
    expect(parseDelicaName('dbs5 delica beads 15/0')).toEqual({ prefix: 'DBS', number: '5', suffix: '', size: '15' });
    expect(parseDelicaName('Random string')).toBeNull();
  });

  it('builds the canonical zero-padded ID', () => {
    expect(delicaBeadId({ prefix: 'DB', number: '31', suffix: 'L' })).toBe('DB0031L');
    expect(delicaBeadId({ prefix: 'DBS', number: '5', suffix: '' })).toBe('DBS0005');
    expect(delicaBeadId({ prefix: 'DB', number: '2271', suffix: '' })).toBe('DB2271');
  });
});

describe('classifyDirectoryProduct', () => {
  it.each(DROPPED_BY_OLD_SCRAPER)('recovers "%s"', (name, sku, beadId, size, oldNumber) => {
    const classified = classifyDirectoryProduct(product({ name, sku }));
    expect(classified.kind).toBe('listing');
    if (classified.kind !== 'listing') return;
    expect(classified.listing.beadId).toBe(beadId);
    expect(classified.listing.size).toBe(size);
    expect(classified.listing.hole).toBe(beadId.endsWith('SH') ? 'SH' : 'RH');
    expect(classified.listing.oldNumber).toBe(oldNumber);
    expect(classified.listing.conflicts).toEqual([]);
  });

  it('flags the one product whose name and SKU disagree instead of guessing', () => {
    const classified = classifyDirectoryProduct(product({ name: '#260(148R) Round Rocailles 6/0', sku: 'N-RR6-0148R' }));
    expect(classified.kind).toBe('listing');
    if (classified.kind !== 'listing') return;
    expect(classified.listing.beadId).toBe('260');
    expect(classified.listing.conflicts).toEqual(['SKU code 0148R ≠ name number 260']);
  });

  it('classifies Delica with the zero-padded ID and the size from the name', () => {
    const classified = classifyDirectoryProduct(product({ name: 'DB31L Delica Beads 11/0', sku: 'N-DB-0031L' }));
    expect(classified).toMatchObject({ kind: 'listing', listing: { beadType: 'miyuki-delica', beadId: 'DB0031L', size: '11', hole: 'RH', conflicts: [] } });
  });

  it('treats a product that resembles a bead but does not parse as unparsed, never as other', () => {
    expect(classifyDirectoryProduct(product({ name: 'Round Rocailles Mix 11/0' })).kind).toBe('unparsed');
    expect(classifyDirectoryProduct(product({ name: 'DB-XYZ Delica Beads 11/0' })).kind).toBe('unparsed');
    expect(classifyDirectoryProduct(product({ name: 'TL-420 TILA Beads' })).kind).toBe('other');
  });

  it('splits a product list into listings, others and unparsed', () => {
    const result = classifyDirectoryProducts([
      product({ id: 1, name: '#1 Round Rocailles 15/0', sku: 'N-RR15-0001' }),
      product({ id: 2, name: 'TL-420 TILA Beads' }),
      product({ id: 3, name: 'Delica Beads assortment' }),
    ]);
    expect(result.listings.map((l) => l.beadId)).toEqual(['1']);
    expect(result.others.map((p) => p.id)).toEqual([2]);
    expect(result.unparsed.map((u) => u.product.id)).toEqual([3]);
  });
});

describe('fullSizeImageUrl', () => {
  it('strips a WordPress -WxH suffix and keeps clean URLs', () => {
    expect(fullSizeImageUrl('https://x/uploads/2024/06/15-1-324x324.jpg')).toBe('https://x/uploads/2024/06/15-1.jpg');
    expect(fullSizeImageUrl('https://x/uploads/2026/05/DB0750_400.jpg')).toBe('https://x/uploads/2026/05/DB0750_400.jpg');
    expect(fullSizeImageUrl('https://x/page.html')).toBeUndefined();
    expect(fullSizeImageUrl(undefined)).toBeUndefined();
  });
});

describe('sidecarFromAttributes', () => {
  const attributes = [
    { name: 'Shape', terms: ['Round Rocailles'] },
    { name: 'Size', terms: ['11/0'] },
    { name: 'Color Group', terms: ['Silver'] },
    { name: 'Glass Group', terms: ['Transparent'] },
    { name: 'Finish', terms: ['Silverline', 'Outside-Dyed'] },
    { name: 'Dyed', terms: ['Non Dyed'] },
    { name: 'Galvanized', terms: ['Non-galvanized'] },
    { name: 'Plating', terms: ['Non-Plating'] },
  ];

  it('mirrors the product page: terms joined by ", " in name order, keys in sidecar order', () => {
    const result = sidecarFromAttributes(product({ attributes }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.sidecar)).toEqual(['shape', 'size', 'colorGroup', 'glassGroup', 'finish', 'dyed', 'galvanized', 'plating']);
    expect(result.sidecar.finish).toBe('Outside-Dyed, Silverline');
  });

  it('omits a missing colour group and defaults a missing finish, as the page scraper did', () => {
    const without = attributes.filter((a) => a.name !== 'Color Group' && a.name !== 'Finish');
    const result = sidecarFromAttributes(product({ attributes: without }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sidecar.colorGroup).toBeUndefined();
    expect(result.sidecar.finish).toBe('Not Specified');
    expect(Object.keys(result.sidecar)).toEqual(['shape', 'size', 'glassGroup', 'finish', 'dyed', 'galvanized', 'plating']);
  });

  it('reports the required attributes that are missing', () => {
    const result = sidecarFromAttributes(product({ attributes: attributes.filter((a) => a.name !== 'Plating' && a.name !== 'Dyed') }));
    expect(result).toEqual({ ok: false, missing: ['Dyed', 'Plating'] });
  });

  it('accepts the names the Store API uses (Color, Glass Type) as well as the page labels', () => {
    const api = attributes.map((a) => (a.name === 'Color Group' ? { ...a, name: 'Color' } : a.name === 'Glass Group' ? { ...a, name: 'Glass Type' } : a));
    const result = sidecarFromAttributes(product({ attributes: api }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sidecar.colorGroup).toBe('Silver');
    expect(result.sidecar.glassGroup).toBe('Transparent');
  });

  it('sorts terms case-insensitively', () => {
    expect(joinAttributeTerms(['Rainbow', 'Frosted (Matte)', ' Glazed Luster '])).toBe('Frosted (Matte), Glazed Luster, Rainbow');
  });
});

describe('reduceStoreProduct', () => {
  it('keeps only the fields the pipeline needs and decodes the name', () => {
    const reduced = reduceStoreProduct({
      id: 42,
      sku: 'N-RR6S-3271',
      name: '3271 Round Rocailles (SH) 6/0 &#8211; test &amp; co',
      slug: '3271-round-rocailles-sh-6-0',
      permalink: 'https://directory.miyuki-beads.co.jp/3271-round-rocailles-sh-6-0/',
      categories: [{ id: 1, name: 'Round Rocailles' }],
      images: [{ id: 9, src: 'https://x/a.jpg', name: 'a' }, { src: '' }],
      attributes: [{ name: 'Finish', terms: [{ name: 'Silverline' }, { name: 'Rainbow' }] }],
      extra: 'dropped',
    } as never);
    expect(reduced).toEqual({
      id: 42,
      sku: 'N-RR6S-3271',
      name: '3271 Round Rocailles (SH) 6/0 – test & co',
      slug: '3271-round-rocailles-sh-6-0',
      permalink: 'https://directory.miyuki-beads.co.jp/3271-round-rocailles-sh-6-0/',
      categories: ['Round Rocailles'],
      images: [{ src: 'https://x/a.jpg', name: 'a' }],
      attributes: [{ name: 'Finish', terms: ['Silverline', 'Rainbow'] }],
    });
    expect(decodeHtmlEntities('a &quot;b&quot; &#039;c&#039;')).toBe('a "b" \'c\'');
  });
});
