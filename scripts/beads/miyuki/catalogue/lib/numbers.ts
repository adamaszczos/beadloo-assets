/**
 * Text grammar of catalogue GB-6: colour numbers, sizes, page headers and the
 * section headings printed inside the tables. Pure functions only.
 */

import type { CatalogueShape, ColourNumber, SectionHeading } from './types.js';

export const DELICA_PREFIXES = ['DB', 'DBC', 'DBM', 'DBMC', 'DBL', 'DBLC', 'DBS', 'DBSC'] as const;

export type DelicaPrefix = (typeof DELICA_PREFIXES)[number];

/** The size each Delica prefix is sold in; used to flag a number printed on the wrong page. */
export const DELICA_PREFIX_SIZES: Record<DelicaPrefix, string> = {
  DB: '11/0',
  DBC: '11/0',
  DBM: '10/0',
  DBMC: '10/0',
  DBL: '8/0',
  DBLC: '8/0',
  DBS: '15/0',
  DBSC: '15/0',
};

/** `1`, `1F`, `131SF`, `2400SFR`, `133L`, `483D`, `HB167`, `4511-L`, `1130-1`. */
const NUMBER_BODY = String.raw`(?:HB)?\d{1,4}[A-Z]{0,3}(?:-(?:L|\d{1,2}))?`;
const ROUND_ROCAILLE_PATTERN = new RegExp(String.raw`^(${NUMBER_BODY})(?:\s*/\s*(SH))?$`);
const DELICA_PATTERN = new RegExp(String.raw`^(DB[A-Z]{0,2})\s*(${NUMBER_BODY})$`);

const SIZE_PATTERN = /(\d{1,2})\/0/g;

/** Japanese names of the round-rocaille sizes, for headings that carry the name but not the size. */
const ROUND_ROCAILLE_NAME_SIZES: Array<[RegExp, string]> = [
  [/^丸特小ビーズ/, '15/0'],
  [/^丸特大ビーズ/, '6/0'],
  [/^丸小ビーズ/, '11/0'],
  [/^丸大ビーズ/, '8/0'],
  [/^EE\s?ビーズ/, '1/0'],
  [/^E\s?ビーズ/, '5/0'],
];

export function normaliseWhitespace(text: string): string {
  return text.replace(/[\s 　]+/g, ' ').trim();
}

/**
 * Parses one printed colour number. `1/SH` is colour `1` with a square hole; a
 * Delica number keeps its prefix apart (`DB 22L` → prefix `DB`, colour `22L`).
 */
export function parseColourNumber(text: string): ColourNumber | null {
  const value = normaliseWhitespace(text);
  const delica = DELICA_PATTERN.exec(value);
  if (delica) {
    const prefix = delica[1];
    if (!(DELICA_PREFIXES as readonly string[]).includes(prefix)) return null;
    return { colourNo: delica[2], hole: 'RH', prefix };
  }
  const round = ROUND_ROCAILLE_PATTERN.exec(value);
  if (!round) return null;
  return { colourNo: round[1], hole: round[2] === 'SH' ? 'SH' : 'RH', prefix: '' };
}

/** Every `N/0` size in the text, in print order. */
export function parseSizes(text: string): string[] {
  return [...text.matchAll(SIZE_PATTERN)].map((match) => `${match[1]}/0`);
}

/** A line that is nothing but a size, as printed in the intro block of each size section. */
export function isStandaloneSize(text: string): boolean {
  return /^\d{1,2}\/0$/.test(normaliseWhitespace(text));
}

export interface PageHeader {
  ja: string;
  /** The English family name without the sizes: `Round Rocaille Beads`, `Delica Beads® Cut`. */
  en: string;
  sizes: string[];
  shape: CatalogueShape | 'other';
}

/**
 * The band printed at the top of every catalogue page: the Japanese family, an
 * icon glyph (which reaches us as U+FFFD after an em space), then the English
 * family and the sizes on the page, e.g. `丸小ビーズ Round Rocaille Beads 11/0`.
 */
export function parsePageHeader(text: string): PageHeader | null {
  const parts = text.split(/[ �]+/).map(normaliseWhitespace).filter(Boolean);
  if (parts.length < 2) return null;
  const ja = parts[0];
  const enWithSizes = parts.slice(1).join(' ');
  const sizes = parseSizes(enWithSizes);
  const en = normaliseWhitespace(enWithSizes.replace(/\d{1,2}\/0/g, '').replace(/[・･]/g, ''));
  return { ja, en, sizes, shape: shapeOfEnglishName(en) };
}

function shapeOfEnglishName(en: string): CatalogueShape | 'other' {
  if (/round rocaille/i.test(en)) return 'round-rocailles';
  if (/delica/i.test(en)) return 'delica';
  return 'other';
}

export type HeadingMeaning =
  | { kind: 'shape'; shape: CatalogueShape | 'other'; size: string | null }
  | { kind: 'section'; section: SectionHeading };

/**
 * A tinted heading row inside a table is either a finish family (`スキ /
 * Transparent`) or, on the coating pages, a bead shape with its size (`丸小ビーズ
 * 11/0 / Round Rocaille Beads`). Shapes are told apart by the English word
 * "Beads", which no finish family uses.
 */
export function classifyHeading(heading: SectionHeading): HeadingMeaning {
  const ja = normaliseWhitespace(heading.ja);
  const en = normaliseWhitespace(heading.en);
  const namedShape = shapeOfEnglishName(en);
  const jaSize = ROUND_ROCAILLE_NAME_SIZES.find(([pattern]) => pattern.test(ja))?.[1] ?? null;
  const isShape = /\bBeads\b/i.test(en) || namedShape !== 'other' || jaSize !== null;
  if (!isShape) return { kind: 'section', section: { ja, en } };
  const shape = namedShape === 'other' && jaSize !== null ? 'round-rocailles' : namedShape;
  return { kind: 'shape', shape, size: parseSizes(ja)[0] ?? parseSizes(en)[0] ?? jaSize };
}

/** The directory name a size is stored under, following `beads/<brand>/<type>/<size>/` (`11/0` → `11`). */
export function sizeDirectoryName(size: string): string {
  return size.replace(/\/0$/, '');
}
