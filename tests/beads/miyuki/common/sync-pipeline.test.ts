import { describe, expect, it } from 'vitest';
import {
  describeListings,
  findNewListings,
  isOriginalImageFile,
  listingKey,
  registryRowForDirectoryListing,
} from '../../../../scripts/beads/miyuki/common/sync-pipeline.js';
import type { DirectoryListing } from '../../../../scripts/beads/miyuki/common/directory-products.js';

const listing = (beadId: string, size: string): DirectoryListing => ({
  beadType: 'miyuki-round_rocailles',
  beadId,
  size,
  hole: beadId.endsWith('SH') ? 'SH' : 'RH',
  name: `#${beadId} Round Rocailles ${size}/0`,
  sku: `N-RR${size}-${beadId.padStart(4, '0')}`,
  imageUrl: `https://x/${size}-${beadId}.jpg`,
  productId: Number.parseInt(beadId, 10),
  permalink: `https://directory.miyuki-beads.co.jp/${beadId}-round-rocailles-${size}-0/`,
  attributes: [],
  conflicts: [],
});

describe('findNewListings', () => {
  it('keeps only the requested size and the IDs not known locally, case-insensitively', () => {
    const listings = [listing('1', '6'), listing('1F', '6'), listing('29', '6'), listing('29', '8')];
    expect(findNewListings(listings, '6', ['1f']).map((l) => l.beadId)).toEqual(['1', '29']);
    expect(findNewListings(listings, '8', []).map((l) => l.beadId)).toEqual(['29']);
    expect(findNewListings(listings, '11', [])).toEqual([]);
  });
});

describe('registryRowForDirectoryListing', () => {
  it('records the directory as the source of listing, image and size with a photo-grade colour', () => {
    expect(registryRowForDirectoryListing(listing('2422', '6'), '2026-10-16')).toEqual({
      beadId: '2422',
      size: '6',
      listingSource: 'directory',
      imageSource: 'directory',
      sizeSource: 'directory',
      colorAccuracy: 'photo',
      sourceRef: 'product:2422 https://directory.miyuki-beads.co.jp/2422-round-rocailles-6-0/',
      addedOn: '2026-10-16',
    });
  });
});

describe('small helpers', () => {
  it('recognises originals and derivatives', () => {
    expect(isOriginalImageFile('1.jpg')).toBe(true);
    expect(isOriginalImageFile('DB0001.JPG')).toBe(true);
    expect(isOriginalImageFile('1_16x16.jpg')).toBe(false);
    expect(isOriginalImageFile('1_48x48.jpg')).toBe(false);
    expect(isOriginalImageFile('1.metadata.json')).toBe(false);
  });

  it('keys and describes listings', () => {
    expect(listingKey(listing('1f', '6'))).toBe('6:1F');
    expect(describeListings([listing('1', '6'), listing('2', '6')])).toBe('1, 2');
    expect(describeListings(Array.from({ length: 10 }, (_, i) => listing(String(i), '6')), 3)).toBe('0, 1, 2, … (10)');
  });
});
