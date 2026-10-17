/**
 * Shared types for the GB-6 catalogue parser.
 *
 * Everything here is expressed in PDF points with the origin at the top-left of
 * the page (the coordinate frame mupdf hands back), so the pure helpers never
 * need to know which library produced the geometry.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An axis-aligned line segment: for `h` `at` is the y and `from..to` the x range, for `v` the other way round. */
export interface Segment {
  axis: 'h' | 'v';
  at: number;
  from: number;
  to: number;
}

export interface TextLine extends Box {
  text: string;
  fontSize: number;
}

export interface FillRect extends Box {
  /** Approximate sRGB in 0..1, enough to tell white, a tint and a dark fill apart. */
  rgb: [number, number, number];
}

/** Everything the parser needs from one PDF page. */
export interface PageGraphics {
  page: number;
  width: number;
  height: number;
  segments: Segment[];
  fills: FillRect[];
  images: Box[];
  texts: TextLine[];
}

export type CatalogueShape = 'round-rocailles' | 'delica';

export type HoleShape = 'RH' | 'SH';

export interface ColourNumber {
  /** The number as printed, without the Delica prefix and without the `/SH` hole marker. */
  colourNo: string;
  hole: HoleShape;
  /** The Delica prefix (`DB`, `DBC`, ...) or an empty string for round rocailles. */
  prefix: string;
}

export interface SectionHeading {
  ja: string;
  en: string;
}

export interface CatalogueRow {
  shape: CatalogueShape;
  colourNo: string;
  size: string;
  hole: HoleShape;
  prefix: string;
  sectionJa: string;
  sectionEn: string;
  page: number;
  cell: Box;
  /** The swatch area inside the cell, for cropping. */
  swatch: Box;
  codeNo: string;
}

export type CellIssueKind = 'empty' | 'unparsed' | 'warning';

export interface CellIssue {
  kind: CellIssueKind;
  page: number;
  cell: Box;
  reason: string;
}
