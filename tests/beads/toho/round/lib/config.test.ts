import { describe, expect, it } from 'vitest';
import {
  normalizeTohoRoundSize,
  getTohoRoundSizeDisplayName,
  getTohoRoundSizeCode,
  TOHO_ROUND_SIZES,
} from '../../../../../scripts/beads/toho/round/lib/config.js';

describe('normalizeTohoRoundSize', () => {
  it('returns "11" for null/undefined/empty', () => {
    expect(normalizeTohoRoundSize(null)).toBe('11');
    expect(normalizeTohoRoundSize(undefined)).toBe('11');
    expect(normalizeTohoRoundSize('')).toBe('11');
  });

  it('returns valid sizes as-is', () => {
    for (const size of TOHO_ROUND_SIZES) {
      expect(normalizeTohoRoundSize(size)).toBe(size);
    }
  });

  it('strips /0 suffix', () => {
    expect(normalizeTohoRoundSize('11/0')).toBe('11');
    expect(normalizeTohoRoundSize('8/0')).toBe('8');
    expect(normalizeTohoRoundSize('3/0')).toBe('3');
  });

  it('strips leading zeros', () => {
    expect(normalizeTohoRoundSize('03')).toBe('3');
    expect(normalizeTohoRoundSize('06')).toBe('6');
    expect(normalizeTohoRoundSize('08')).toBe('8');
  });

  it('trims whitespace', () => {
    expect(normalizeTohoRoundSize('  11  ')).toBe('11');
  });

  it('defaults unknown values to "11"', () => {
    expect(normalizeTohoRoundSize('99')).toBe('11');
    expect(normalizeTohoRoundSize('foo')).toBe('11');
  });
});

describe('getTohoRoundSizeDisplayName', () => {
  it.each([
    ['3', '3/0'],
    ['6', '6/0'],
    ['8', '8/0'],
    ['11', '11/0'],
    ['15', '15/0'],
  ] as const)('returns "%s/0" for size "%s"', (size, expected) => {
    expect(getTohoRoundSizeDisplayName(size)).toBe(expected);
  });

  it('normalizes before looking up', () => {
    expect(getTohoRoundSizeDisplayName('03')).toBe('3/0');
    expect(getTohoRoundSizeDisplayName('8/0')).toBe('8/0');
  });
});

describe('getTohoRoundSizeCode', () => {
  it.each([
    ['3', '03'],
    ['6', '06'],
    ['8', '08'],
    ['11', '11'],
    ['15', '15'],
  ] as const)('returns zero-padded code "%s" → "%s"', (size, expected) => {
    expect(getTohoRoundSizeCode(size)).toBe(expected);
  });

  it('normalizes before looking up', () => {
    expect(getTohoRoundSizeCode('06')).toBe('06');
  });
});
