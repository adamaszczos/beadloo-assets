import { describe, expect, it } from 'vitest';
import { parseBeadName, constructImageUrl, constructFallbackImageUrls } from '../../../../scripts/beads/miyuki/round_rocailles/sync.js';

describe('parseBeadName', () => {
  it('parses simple numeric ID (size 15)', () => {
    expect(parseBeadName('#1 Round Rocailles 15/0')).toEqual({ beadId: '1', size: '15' });
    expect(parseBeadName('#3201 Round Rocailles 2/0')).toEqual({ beadId: '3201', size: '2' });
  });

  it('parses ID with letter suffix', () => {
    expect(parseBeadName('#1F Round Rocailles 15/0')).toEqual({ beadId: '1F', size: '15' });
    expect(parseBeadName('#5D Round Rocailles 15/0')).toEqual({ beadId: '5D', size: '15' });
    expect(parseBeadName('#5L Round Rocailles 15/0')).toEqual({ beadId: '5L', size: '15' });
  });

  it('parses various sizes', () => {
    expect(parseBeadName('#1 Round Rocailles 2/0')).toEqual({ beadId: '1', size: '2' });
    expect(parseBeadName('#1 Round Rocailles 5/0')).toEqual({ beadId: '1', size: '5' });
    expect(parseBeadName('#1 Round Rocailles 6/0')).toEqual({ beadId: '1', size: '6' });
    expect(parseBeadName('#1 Round Rocailles 8/0')).toEqual({ beadId: '1', size: '8' });
    expect(parseBeadName('#1 Round Rocailles 11/0')).toEqual({ beadId: '1', size: '11' });
    expect(parseBeadName('#1 Round Rocailles 15/0')).toEqual({ beadId: '1', size: '15' });
  });

  it('is case-insensitive', () => {
    expect(parseBeadName('#1f round rocailles 15/0')).toEqual({ beadId: '1F', size: '15' });
  });

  it('returns null for non-matching names', () => {
    expect(parseBeadName('Random string')).toBeNull();
    expect(parseBeadName('')).toBeNull();
    expect(parseBeadName('DB0001 Delica Beads 11/0')).toBeNull();
    expect(parseBeadName('TOHO Round 11/0')).toBeNull();
  });
});

describe('constructImageUrl', () => {
  it('strips thumbnail dimensions from scraped image URL', () => {
    const result = constructImageUrl({
      beadId: '1',
      size: '15',
      name: '#1 Round Rocailles 15/0',
      imageUrl: 'https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/15-1-324x324.jpg',
    });
    expect(result).toBe('https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/15-1.jpg');
  });

  it('returns full-size URL when already clean', () => {
    const result = constructImageUrl({
      beadId: '1',
      size: '15',
      name: '#1 Round Rocailles 15/0',
      imageUrl: 'https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/15-1.jpg',
    });
    expect(result).toBe('https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/15-1.jpg');
  });

  it('handles bead IDs with letter suffixes', () => {
    const result = constructImageUrl({
      beadId: '1F',
      size: '15',
      name: '#1F Round Rocailles 15/0',
      imageUrl: 'https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/15-1F-324x324.jpg',
    });
    expect(result).toBe('https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/15-1F.jpg');
  });

  it('constructs a fallback URL when no imageUrl provided', () => {
    const result = constructImageUrl({
      beadId: '1',
      size: '15',
      name: '#1 Round Rocailles 15/0',
    });
    expect(result).toBe('https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/15-1.jpg');
  });

  it('constructs fallback URL for size 2', () => {
    const result = constructImageUrl({
      beadId: '3201',
      size: '2',
      name: '#3201 Round Rocailles 2/0',
    });
    expect(result).toBe('https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/2-3201.jpg');
  });
});

describe('constructFallbackImageUrls', () => {
  it('returns both fallback patterns', () => {
    const result = constructFallbackImageUrls({
      beadId: '2370',
      size: '11',
      name: '#2370 Round Rocailles 11/0',
    });
    expect(result).toEqual([
      'https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/2370-RR-11.jpg',
      'https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/11-0_2370.jpg',
    ]);
  });

  it('handles letter suffix in bead ID', () => {
    const result = constructFallbackImageUrls({
      beadId: '1F',
      size: '15',
      name: '#1F Round Rocailles 15/0',
    });
    expect(result).toEqual([
      'https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/1F-RR-15.jpg',
      'https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/15-0_1F.jpg',
    ]);
  });

  it('produces correct size-0 pattern for size 11', () => {
    const result = constructFallbackImageUrls({
      beadId: '4281',
      size: '11',
      name: '#4281 Round Rocailles 11/0',
    });
    expect(result[1]).toBe('https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/11-0_4281.jpg');
  });
});
