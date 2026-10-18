/**
 * The counts printed at the end of a parse. Pure.
 */

import type { CatalogueRow, CatalogueShape, CellIssue } from './types.js';

export interface SizeSummary {
  size: string;
  cells: number;
  /** Distinct colour numbers (prefix + number + hole) at this size. */
  distinct: number;
  roundHole: number;
  squareHole: number;
  /** Delica only: distinct numbers per prefix. */
  prefixes: Record<string, number>;
}

export interface ShapeSummary {
  shape: CatalogueShape;
  cells: number;
  sizes: SizeSummary[];
  sections: Array<{ ja: string; en: string; cells: number }>;
  /** Colour numbers listed more than once at the same size, with the pages. */
  duplicates: Array<{ key: string; pages: number[] }>;
}

export interface ParseSummary {
  shapes: ShapeSummary[];
  empty: number;
  unparsed: number;
  warnings: number;
  skipped: number;
  issues: CellIssue[];
}

export function colourKey(row: CatalogueRow): string {
  return `${row.prefix}${row.colourNo}${row.hole === 'SH' ? '/SH' : ''}`;
}

const SHAPE_ORDER: CatalogueShape[] = ['round-rocailles', 'delica'];

function compareSizes(a: string, b: string): number {
  return Number.parseInt(b, 10) - Number.parseInt(a, 10);
}

function summariseSize(size: string, rows: CatalogueRow[]): SizeSummary {
  const distinct = new Map<string, CatalogueRow>();
  for (const row of rows) distinct.set(colourKey(row), row);
  const prefixes: Record<string, number> = {};
  for (const row of distinct.values()) {
    if (row.prefix) prefixes[row.prefix] = (prefixes[row.prefix] ?? 0) + 1;
  }
  return {
    size,
    cells: rows.length,
    distinct: distinct.size,
    roundHole: [...distinct.values()].filter((row) => row.hole === 'RH').length,
    squareHole: [...distinct.values()].filter((row) => row.hole === 'SH').length,
    prefixes,
  };
}

function summariseShape(shape: CatalogueShape, rows: CatalogueRow[]): ShapeSummary {
  const bySize = new Map<string, CatalogueRow[]>();
  const bySection = new Map<string, { ja: string; en: string; cells: number }>();
  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    bySize.set(row.size, [...(bySize.get(row.size) ?? []), row]);
    const sectionKey = `${row.sectionJa}\u0000${row.sectionEn}`;
    const section = bySection.get(sectionKey) ?? { ja: row.sectionJa, en: row.sectionEn, cells: 0 };
    section.cells++;
    bySection.set(sectionKey, section);
    const key = `${row.size} ${colourKey(row)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), row.page]);
  }
  return {
    shape,
    cells: rows.length,
    sizes: [...bySize.entries()].sort(([a], [b]) => compareSizes(a, b)).map(([size, sizeRows]) => summariseSize(size, sizeRows)),
    sections: [...bySection.values()],
    duplicates: [...byKey.entries()].filter(([, pages]) => pages.length > 1).map(([key, pages]) => ({ key, pages })),
  };
}

export function summarise(rows: CatalogueRow[], issues: CellIssue[], skipped: number): ParseSummary {
  return {
    shapes: SHAPE_ORDER.map((shape) => summariseShape(shape, rows.filter((row) => row.shape === shape))),
    empty: issues.filter((issue) => issue.kind === 'empty').length,
    unparsed: issues.filter((issue) => issue.kind === 'unparsed').length,
    warnings: issues.filter((issue) => issue.kind === 'warning').length,
    skipped,
    issues,
  };
}

const MAX_ISSUES_LISTED = 60;

function formatSize(size: SizeSummary): string {
  const prefixes = Object.entries(size.prefixes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, count]) => `${prefix} ${count}`)
    .join(', ');
  const holes = size.squareHole > 0 ? ` (${size.roundHole} round hole + ${size.squareHole} square hole)` : '';
  return `    ${size.size.padEnd(5)} ${String(size.cells).padStart(5)} cells, ${String(size.distinct).padStart(5)} distinct${holes}${prefixes ? `: ${prefixes}` : ''}`;
}

export function formatSummary(summary: ParseSummary): string {
  const lines: string[] = [];
  for (const shape of summary.shapes) {
    lines.push(`${shape.shape}: ${shape.cells} cells`);
    lines.push(...shape.sizes.map(formatSize));
    lines.push('  sections:');
    for (const section of shape.sections) lines.push(`    ${String(section.cells).padStart(5)}  ${section.ja} / ${section.en}`);
    if (shape.duplicates.length > 0) {
      lines.push(`  listed more than once at the same size: ${shape.duplicates.length}`);
      for (const duplicate of shape.duplicates) lines.push(`    ${duplicate.key} on pages ${duplicate.pages.join(', ')}`);
    }
  }
  lines.push(`empty cells: ${summary.empty}, unparsed cells: ${summary.unparsed}, warnings: ${summary.warnings}, cells of other shapes skipped: ${summary.skipped}`);
  for (const issue of summary.issues.slice(0, MAX_ISSUES_LISTED)) {
    lines.push(`  ${issue.kind.padEnd(8)} p${issue.page} @ ${issue.cell.x.toFixed(1)},${issue.cell.y.toFixed(1)}: ${issue.reason}`);
  }
  if (summary.issues.length > MAX_ISSUES_LISTED) lines.push(`  ... ${summary.issues.length - MAX_ISSUES_LISTED} more`);
  return lines.join('\n');
}
