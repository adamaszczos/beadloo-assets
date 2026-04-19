import { describe, expect, it } from 'vitest';
import {
  getPreciosaRelativeAssetStem,
  inferPreciosaColorGroup,
  inferPreciosaRocaillesMetadata,
  normalizePreciosaBeadId,
  parsePreciosaCatalogListing,
  parsePreciosaDetailHtml,
  resolvePreciosaRocaillesSyncSizes,
} from '../../../../scripts/beads/preciosa/rocailles/sync.js';

describe('normalizePreciosaBeadId', () => {
  it('normalizes whole article numbers into filesystem-safe bead IDs', () => {
    expect(normalizePreciosaBeadId('311-19001-10/0-00050')).toBe('311-19001-10_0-00050');
    expect(normalizePreciosaBeadId('311-19001-10_0-00050')).toBe('311-19001-10_0-00050');
  });

  it('rejects malformed bead IDs', () => {
    expect(normalizePreciosaBeadId('311-19001')).toBeNull();
    expect(normalizePreciosaBeadId('not-a-bead')).toBeNull();
  });
});

describe('parsePreciosaCatalogListing', () => {
  it('parses listing rows from the product endpoint', () => {
    expect(
      parsePreciosaCatalogListing({
        href: '/detail/1514',
        colour: '00050',
        article: '311-19001',
        size: '10/0',
        photoView: '/produkty/perlicky/fotky/311-19001-10_0-00050.webp?v=1774867210',
        product: ['311-19001-10_0-00050', '311-19001-10/0-00050'],
      })
    ).toEqual({
      beadId: '311-19001-10_0-00050',
      detailUrl: 'https://catalog.preciosa-ornela.com/detail/1514',
      imageUrl: 'https://catalog.preciosa-ornela.com/produkty/perlicky/fotky/311-19001-10_0-00050.webp?v=1774867210',
      articleNumber: '311-19001',
      size: '10',
      sizeLabel: '10/0',
      colorNumber: '00050',
      productKeys: ['311-19001-10_0-00050', '311-19001-10/0-00050'],
    });
  });
});

describe('parsePreciosaDetailHtml', () => {
  it('extracts the Preciosa detail fields needed for metadata generation', () => {
    const html = `
      <div class="detailContent__row"><p>Color number:</p><h3>00050</h3></div>
      <div class="detailContent__row"><p>Color description:</p><p>crystal</p></div>
      <li class="detailContent__row"><p>Resistance:</p><p>1 - very resistant</p></li>
      <li class="detailContent__row"><p>Natural / Finished:</p><p>natural</p></li>
      <li class="detailContent__row"><p>Whole article number:</p><p><b>311-19001-10/0-00050</b></p></li>
      <div class="detailInfo__row"><p>Article number (shape):</p><p><b>311-19001</b></p></div>
      <div class="detailInfo__row"><p>Article (shape) description:</p><p>Rocailles, round hole, loose</p></div>
      <div class="detailInfo__row"><p>Size:</p><p><b>10/0</b></p></div>
    `;

    expect(parsePreciosaDetailHtml(html)).toEqual({
      wholeArticleNumber: '311-19001-10/0-00050',
      additionalArticleNumber: '311-19001',
      articleDescription: 'Rocailles, round hole, loose',
      sizeLabel: '10/0',
      colorNumber: '00050',
      colorDescription: 'crystal',
      resistance: '1 - very resistant',
      naturalFinished: 'natural',
    });
  });

  it('accepts detail pages with a blank color description', () => {
    const html = `
      <div class="detailContent__row"><p>Color number:</p><h3>26711</h3></div>
      <div class="detailContent__row"><p>Color description:</p><p></p></div>
      <li class="detailContent__row"><p>Resistance:</p><p>0 - not tested</p></li>
      <li class="detailContent__row"><p>Natural / Finished:</p><p>finished</p></li>
      <li class="detailContent__row"><p>Whole article number:</p><p><b>331-19001-6/0-26711</b></p></li>
      <div class="detailInfo__row"><p>Article number (shape):</p><p><b>331-19001</b></p></div>
      <div class="detailInfo__row"><p>Article (shape) description:</p><p>Rocailles, round hole, loose</p></div>
      <div class="detailInfo__row"><p>Size:</p><p><b>6/0</b></p></div>
    `;

    expect(parsePreciosaDetailHtml(html)).toEqual({
      wholeArticleNumber: '331-19001-6/0-26711',
      additionalArticleNumber: '331-19001',
      articleDescription: 'Rocailles, round hole, loose',
      sizeLabel: '6/0',
      colorNumber: '26711',
      colorDescription: '',
      resistance: '0 - not tested',
      naturalFinished: 'finished',
    });
  });
});

describe('inferPreciosaColorGroup', () => {
  it('removes finish terms while keeping the color description readable', () => {
    expect(inferPreciosaColorGroup('harlequin chalkwhite-blue')).toBe('chalkwhite-blue');
    expect(inferPreciosaColorGroup('metallic lt. topaz')).toBe('lt. topaz');
  });
});

describe('inferPreciosaRocaillesMetadata', () => {
  it('infers transparent natural metadata for crystal beads', () => {
    expect(
      inferPreciosaRocaillesMetadata({
        wholeArticleNumber: '311-19001-10/0-00050',
        additionalArticleNumber: '311-19001',
        articleDescription: 'Rocailles, round hole, loose',
        sizeLabel: '10/0',
        colorNumber: '00050',
        colorDescription: 'crystal',
        resistance: '1 - very resistant',
        naturalFinished: 'natural',
      })
    ).toEqual(
      expect.objectContaining({
        shape: 'Rocailles',
        size: '10/0',
        colorGroup: 'crystal',
        glassGroup: 'Transparent',
        dyed: 'Non Dyed',
        galvanized: 'Non Galvanized',
        plating: 'Non Plated',
        additionalArticleNumber: '311-19001',
      })
    );
  });

  it('captures finish and plating cues from the color description', () => {
    const metadata = inferPreciosaRocaillesMetadata({
      wholeArticleNumber: '331-39001-6/0-07712',
      additionalArticleNumber: '331-39001',
      articleDescription: 'Rocailles, round hole, loose',
      sizeLabel: '6/0',
      colorNumber: '07712',
      colorDescription: 'harlequin chalkwhite-blue',
      naturalFinished: 'finished',
    });

    expect(metadata.finish).toContain('Harlequin');
    expect(metadata.colorGroup).toBe('chalkwhite-blue');
    expect(metadata.plating).toBe('Plated');
  });

  it('detects metallic finishes', () => {
    const metadata = inferPreciosaRocaillesMetadata({
      wholeArticleNumber: '331-19001-10/0-01710',
      additionalArticleNumber: '331-19001',
      articleDescription: 'Rocailles, round hole, loose',
      sizeLabel: '10/0',
      colorNumber: '01710',
      colorDescription: 'metallic gold',
      naturalFinished: 'finished',
    });

    expect(metadata.glassGroup).toBe('Metallic');
    expect(metadata.finish).toContain('Metallic');
    expect(metadata.plating).toBe('Plated');
  });
});

describe('resolvePreciosaRocaillesSyncSizes', () => {
  it('uses the union of listing and local sizes when no sizes were explicitly requested', () => {
    expect(resolvePreciosaRocaillesSyncSizes(null, ['1', '10', '33'], ['6', '10'])).toEqual([
      '1',
      '6',
      '10',
      '33',
    ]);
  });

  it('only keeps explicitly requested sizes that exist in live or local data', () => {
    expect(resolvePreciosaRocaillesSyncSizes(['1', '12', '33'], ['1', '33'], ['10'])).toEqual(['1', '33']);
  });
});

describe('getPreciosaRelativeAssetStem', () => {
  it('uses the article directory plus color-number filename stem', () => {
    const listing = {
      beadId: '311-19001-1_0-20420',
      detailUrl: 'https://catalog.preciosa-ornela.com/detail/1',
      imageUrl: 'https://catalog.preciosa-ornela.com/produkty/perlicky/fotky/311-19001-1_0-20420.webp',
      articleNumber: '311-19001',
      size: '1' as const,
      sizeLabel: '1/0' as const,
      colorNumber: '20420',
      productKeys: ['311-19001-1_0-20420'],
    };

    expect(getPreciosaRelativeAssetStem(listing)).toBe('311-19001/20420');
  });

  it('keeps the filename as the color number even when multiple articles share it', () => {
    const left = {
      beadId: '331-19001-10_0-17070',
      detailUrl: 'https://catalog.preciosa-ornela.com/detail/1',
      imageUrl: 'https://catalog.preciosa-ornela.com/produkty/perlicky/fotky/331-19001-10_0-17070.webp',
      articleNumber: '331-19001',
      size: '10' as const,
      sizeLabel: '10/0' as const,
      colorNumber: '17070',
      productKeys: ['331-19001-10_0-17070'],
    };
    const right = {
      beadId: '331-29001-10_0-17070',
      detailUrl: 'https://catalog.preciosa-ornela.com/detail/2',
      imageUrl: 'https://catalog.preciosa-ornela.com/produkty/perlicky/fotky/331-29001-10_0-17070.webp',
      articleNumber: '331-29001',
      size: '10' as const,
      sizeLabel: '10/0' as const,
      colorNumber: '17070',
      productKeys: ['331-29001-10_0-17070'],
    };

    expect(getPreciosaRelativeAssetStem(left)).toBe('331-19001/17070');
    expect(getPreciosaRelativeAssetStem(right)).toBe('331-29001/17070');
  });
});