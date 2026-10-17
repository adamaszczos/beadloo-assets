/**
 * CSV output of the catalogue rows. Pure; the byte-identical guarantee of the
 * parser rests on this module always sorting and formatting the same way.
 */

import type { CatalogueRow } from './types.js';

export const CSV_HEADER = [
  'colour_no',
  'size',
  'hole',
  'prefix',
  'section_ja',
  'section_en',
  'page',
  'cell_x',
  'cell_y',
  'cell_w',
  'cell_h',
  'code_no',
] as const;

export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Page, then top to bottom, then left to right. */
export function sortRows(rows: CatalogueRow[]): CatalogueRow[] {
  return [...rows].sort((a, b) => a.page - b.page || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
}

const points = (value: number): string => value.toFixed(2);

export function formatCsvRow(row: CatalogueRow): string {
  return [
    row.colourNo,
    row.size,
    row.hole,
    row.prefix,
    row.sectionJa,
    row.sectionEn,
    String(row.page),
    points(row.cell.x),
    points(row.cell.y),
    points(row.cell.w),
    points(row.cell.h),
    row.codeNo,
  ]
    .map(csvEscape)
    .join(',');
}

export function formatCsv(rows: CatalogueRow[]): string {
  return [CSV_HEADER.join(','), ...sortRows(rows).map(formatCsvRow)].join('\n') + '\n';
}
