import { describe, expect, it } from 'vitest';
import { parseBeadName, constructImageUrl, pickLargestSrcsetUrl } from '../../../../scripts/beads/miyuki/delica/sync.js';

describe('parseBeadName', () => {
  it('parses DB prefix (size 11)', () => {
    expect(parseBeadName('DB1 Delica Beads 11/0')).toEqual({ beadId: 'DB1', size: '11' });
    expect(parseBeadName('DB0001 Delica Beads 11/0')).toEqual({ beadId: 'DB0001', size: '11' });
  });

  it('parses DBL prefix (size 8)', () => {
    expect(parseBeadName('DBL1 Delica Beads 8/0')).toEqual({ beadId: 'DBL1', size: '8' });
    expect(parseBeadName('DBL1234 Delica Beads 8/0')).toEqual({ beadId: 'DBL1234', size: '8' });
  });

  it('parses DBM prefix (size 10)', () => {
    expect(parseBeadName('DBM1 Delica Beads 10/0')).toEqual({ beadId: 'DBM1', size: '10' });
  });

  it('parses DBS prefix (size 15)', () => {
    expect(parseBeadName('DBS5 Delica Beads 15/0')).toEqual({ beadId: 'DBS5', size: '15' });
  });

  it('is case-insensitive', () => {
    expect(parseBeadName('db100 delica beads 11/0')).toEqual({ beadId: 'db100', size: '11' });
  });

  it('returns null for non-matching names', () => {
    expect(parseBeadName('Random string')).toBeNull();
    expect(parseBeadName('')).toBeNull();
    expect(parseBeadName('TOHO Round 11/0')).toBeNull();
  });
});

describe('constructImageUrl', () => {
  it('strips thumbnail dimensions from scraped image URL', () => {
    const result = constructImageUrl({
      beadId: 'DB0001',
      size: '11',
      name: 'DB0001 Delica Beads 11/0',
      imageUrl: 'https://directory.miyuki-beads.co.jp/wp-content/uploads/2024/06/DB0001-324x324.jpg',
    });
    expect(result).toBe('https://directory.miyuki-beads.co.jp/wp-content/uploads/2024/06/DB0001.jpg');
  });

  it('returns full-size URL when already clean', () => {
    const result = constructImageUrl({
      beadId: 'DB0001',
      size: '11',
      name: 'DB0001 Delica Beads 11/0',
      imageUrl: 'https://directory.miyuki-beads.co.jp/wp-content/uploads/2024/06/DB0001.jpg',
    });
    expect(result).toBe('https://directory.miyuki-beads.co.jp/wp-content/uploads/2024/06/DB0001.jpg');
  });

  it('preserves lowercase image URLs from the server', () => {
    const result = constructImageUrl({
      beadId: 'DB271',
      size: '11',
      name: 'DB271 Delica Beads 11/0',
      imageUrl: 'https://directory.miyuki-beads.co.jp/wp-content/uploads/2024/06/db0271-324x324.jpg',
    });
    expect(result).toBe('https://directory.miyuki-beads.co.jp/wp-content/uploads/2024/06/db0271.jpg');
  });

  it('constructs a fallback URL when no imageUrl provided', () => {
    const result = constructImageUrl({
      beadId: 'DB45',
      size: '11',
      name: 'DB45 Delica Beads 11/0',
    });
    expect(result).toContain('DB0045.jpg');
    expect(result).toMatch(/^https:\/\//);
  });

  it('handles newer uploads in a different folder with a filename suffix (e.g. DB750)', () => {
    // DB750's image lives at /2026/05/DB0750_400.jpg — a different date folder and a `_400` suffix —
    // which the old `DB<digits>.jpg` matcher missed, leaving it permanently 404. Strip -WxH only.
    const result = constructImageUrl({
      beadId: 'DB750',
      size: '11',
      name: 'DB750 Delica Beads 11/0',
      imageUrl: 'https://directory.miyuki-beads.co.jp/wp-content/uploads/2026/05/DB0750_400-324x324.jpg',
    });
    expect(result).toBe('https://directory.miyuki-beads.co.jp/wp-content/uploads/2026/05/DB0750_400.jpg');
  });
});

describe('pickLargestSrcsetUrl', () => {
  it('returns the largest-width (full-size original) candidate', () => {
    const srcset = [
      'https://x/DB0750_400-324x324.jpg 324w',
      'https://x/DB0750_400-150x150.jpg 150w',
      'https://x/DB0750_400.jpg 400w',
      'https://x/DB0750_400-100x100.jpg 100w',
    ].join(', ');
    expect(pickLargestSrcsetUrl(`<img srcset="${srcset}">`)).toBe('https://x/DB0750_400.jpg');
  });

  it('returns undefined when there is no srcset', () => {
    expect(pickLargestSrcsetUrl('<img src="https://x/DB0001.jpg">')).toBeUndefined();
  });
});
