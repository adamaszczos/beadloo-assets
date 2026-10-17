import { describe, expect, it } from 'vitest';
import {
  DELICA_PREFIX_SIZES,
  classifyHeading,
  isStandaloneSize,
  normaliseWhitespace,
  parseColourNumber,
  parsePageHeader,
  parseSizes,
  sizeDirectoryName,
} from '../../../../../scripts/beads/miyuki/catalogue/lib/numbers.js';

describe('parseColourNumber', () => {
  it('reads plain round-rocaille numbers as round hole', () => {
    expect(parseColourNumber('1')).toEqual({ colourNo: '1', hole: 'RH', prefix: '' });
    expect(parseColourNumber('2441')).toEqual({ colourNo: '2441', hole: 'RH', prefix: '' });
  });

  it('keeps the printed suffixes', () => {
    for (const printed of ['1F', '5D', '131SF', '2400SFR', '133L', '483D', '408FR', '4511-L', '1130-1']) {
      expect(parseColourNumber(printed)).toEqual({ colourNo: printed, hole: 'RH', prefix: '' });
    }
  });

  it('reads the HB series', () => {
    expect(parseColourNumber('HB167')).toEqual({ colourNo: 'HB167', hole: 'RH', prefix: '' });
    expect(parseColourNumber('HB2060')).toEqual({ colourNo: 'HB2060', hole: 'RH', prefix: '' });
  });

  it('splits the square-hole marker off the number', () => {
    expect(parseColourNumber('1/SH')).toEqual({ colourNo: '1', hole: 'SH', prefix: '' });
    expect(parseColourNumber('22 / SH')).toEqual({ colourNo: '22', hole: 'SH', prefix: '' });
  });

  it('separates every Delica prefix from its number', () => {
    expect(parseColourNumber('DB 1130')).toEqual({ colourNo: '1130', hole: 'RH', prefix: 'DB' });
    expect(parseColourNumber('DB1130-1')).toEqual({ colourNo: '1130-1', hole: 'RH', prefix: 'DB' });
    expect(parseColourNumber('DB 22L')).toEqual({ colourNo: '22L', hole: 'RH', prefix: 'DB' });
    expect(parseColourNumber('DBC 31')).toEqual({ colourNo: '31', hole: 'RH', prefix: 'DBC' });
    expect(parseColourNumber('DBM 626')).toEqual({ colourNo: '626', hole: 'RH', prefix: 'DBM' });
    expect(parseColourNumber('DBMC 100')).toEqual({ colourNo: '100', hole: 'RH', prefix: 'DBMC' });
    expect(parseColourNumber('DBL 1')).toEqual({ colourNo: '1', hole: 'RH', prefix: 'DBL' });
    expect(parseColourNumber('DBLC 29')).toEqual({ colourNo: '29', hole: 'RH', prefix: 'DBLC' });
    expect(parseColourNumber('DBS 134')).toEqual({ colourNo: '134', hole: 'RH', prefix: 'DBS' });
    expect(parseColourNumber('DBSC 1')).toEqual({ colourNo: '1', hole: 'RH', prefix: 'DBSC' });
  });

  it('rejects everything that is not a colour number', () => {
    for (const text of ['', '11/0', 'H 5030', 'DBX 1', 'DB', 'abc', '2mm', '1/0', 'カラーNo.', '12345']) {
      expect(parseColourNumber(text), text).toBeNull();
    }
  });

  it('knows the size of every Delica prefix', () => {
    expect(DELICA_PREFIX_SIZES).toEqual({
      DB: '11/0',
      DBC: '11/0',
      DBM: '10/0',
      DBMC: '10/0',
      DBL: '8/0',
      DBLC: '8/0',
      DBS: '15/0',
      DBSC: '15/0',
    });
  });
});

describe('sizes', () => {
  it('lists every size in a header in print order', () => {
    expect(parseSizes('Round Rocaille Beads 5/0 ・1/0')).toEqual(['5/0', '1/0']);
    expect(parseSizes('Delica Beads® Cut 11/0')).toEqual(['11/0']);
    expect(parseSizes('Precious Beads')).toEqual([]);
  });

  it('recognises a line that is only a size', () => {
    expect(isStandaloneSize('11/0')).toBe(true);
    expect(isStandaloneSize(' 1/0 ')).toBe(true);
    expect(isStandaloneSize('11/SH')).toBe(false);
    expect(isStandaloneSize('丸小ビーズ 11/0')).toBe(false);
  });

  it('maps a size to its directory name', () => {
    expect(sizeDirectoryName('11/0')).toBe('11');
    expect(sizeDirectoryName('1/0')).toBe('1');
  });

  it('collapses the catalogue whitespace variants', () => {
    expect(normaliseWhitespace(' Round Rocaille　Beads  11/0 ')).toBe('Round Rocaille Beads 11/0');
  });
});

describe('parsePageHeader', () => {
  it('splits the Japanese and English families and reads the sizes', () => {
    expect(parsePageHeader('丸小ビーズ �Round Rocaille Beads 11/0 ')).toEqual({
      ja: '丸小ビーズ',
      en: 'Round Rocaille Beads',
      sizes: ['11/0'],
      shape: 'round-rocailles',
    });
    expect(parsePageHeader('Eビーズ・EE ビーズ �Round Rocaille Beads 5/0 ・1/0')).toEqual({
      ja: 'Eビーズ・EE ビーズ',
      en: 'Round Rocaille Beads',
      sizes: ['5/0', '1/0'],
      shape: 'round-rocailles',
    });
    expect(parsePageHeader('デリカビーズカット �Delica Beads® Cut 11/0')).toEqual({
      ja: 'デリカビーズカット',
      en: 'Delica Beads® Cut',
      sizes: ['11/0'],
      shape: 'delica',
    });
  });

  it('reads a coating page family with no size', () => {
    expect(parsePageHeader('デュラコートビーズ �Duracoat® Beads')).toEqual({
      ja: 'デュラコートビーズ',
      en: 'Duracoat® Beads',
      sizes: [],
      shape: 'other',
    });
  });

  it('ignores lines that are not a bilingual header', () => {
    expect(parsePageHeader('カラーNo.')).toBeNull();
    expect(parsePageHeader('')).toBeNull();
  });
});

describe('classifyHeading', () => {
  it('treats a finish family as a section', () => {
    expect(classifyHeading({ ja: 'スキ', en: 'Transparent' })).toEqual({ kind: 'section', section: { ja: 'スキ', en: 'Transparent' } });
    expect(classifyHeading({ ja: '銀引外色付け', en: 'Silverlined Dyed Color' })).toEqual({
      kind: 'section',
      section: { ja: '銀引外色付け', en: 'Silverlined Dyed Color' },
    });
    expect(classifyHeading({ ja: 'ギョクラスター', en: 'Opaque Luster' }).kind).toBe('section');
    expect(classifyHeading({ ja: 'バロックコーティング', en: 'Baroque Coating' }).kind).toBe('section');
  });

  it('reads the round-rocaille shape headings of the coating pages with their size', () => {
    expect(classifyHeading({ ja: '丸小ビーズ 11/0', en: 'Round Rocaille Beads' })).toEqual({ kind: 'shape', shape: 'round-rocailles', size: '11/0' });
    expect(classifyHeading({ ja: '丸特小ビーズ 15/0', en: 'Round Rocaille Beads' })).toEqual({ kind: 'shape', shape: 'round-rocailles', size: '15/0' });
    expect(classifyHeading({ ja: 'E ビーズ 5/0', en: 'Round Rocaille Beads' })).toEqual({ kind: 'shape', shape: 'round-rocailles', size: '5/0' });
  });

  it('falls back to the Japanese name when the heading carries no size', () => {
    expect(classifyHeading({ ja: '丸特大ビーズ', en: '' })).toEqual({ kind: 'shape', shape: 'round-rocailles', size: '6/0' });
    expect(classifyHeading({ ja: 'EEビーズ', en: 'Round Rocaille Beads' })).toEqual({ kind: 'shape', shape: 'round-rocailles', size: '1/0' });
  });

  it('marks every other bead shape so its cells are skipped', () => {
    expect(classifyHeading({ ja: '六角ビーズ 8/0', en: 'Hexagon Beads' })).toEqual({ kind: 'shape', shape: 'other', size: '8/0' });
    expect(classifyHeading({ ja: 'トライアングルビーズ 5/0', en: 'Triangle Beads' })).toEqual({ kind: 'shape', shape: 'other', size: '5/0' });
    expect(classifyHeading({ ja: 'ロングドロップビーズ 3 × 5.5 ｍｍ', en: 'Long Drop Beads' })).toEqual({ kind: 'shape', shape: 'other', size: null });
    expect(classifyHeading({ ja: 'デリカビーズ 11/0', en: 'Delica Beads®' })).toEqual({ kind: 'shape', shape: 'delica', size: '11/0' });
  });
});
