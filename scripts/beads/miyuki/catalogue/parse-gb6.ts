#!/usr/bin/env tsx
/**
 * Miyuki catalogue GB-6 parser
 *
 * Reads the printed catalogue (a PDF, not committed) cell by cell, following
 * the drawn table borders, and writes one CSV per shape with every colour cell
 * of the round-rocaille and Delica pages, plus optional swatch crops.
 *
 * Usage:
 *   pnpm beads:miyuki:catalogue -- --pdf path/to/GB-6.pdf
 *   pnpm beads:miyuki:catalogue -- --pdf path/to/GB-6.pdf --crops            # crops into downloaded/miyuki/catalogue/gb-6/
 *   pnpm beads:miyuki:catalogue -- --pdf path/to/GB-6.pdf --crops some/dir --out some/other/dir
 */

import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT, DOWNLOADED_ROOT } from '../../common/lib/paths.js';
import { CROP_DPI, cropRelativePath, writeSwatchCrop } from './lib/crops.js';
import { formatCsv, sortRows } from './lib/csv.js';
import { initialWalkState, parsePage } from './lib/page.js';
import { CataloguePdf } from './lib/pdf.js';
import { formatSummary, summarise, type ParseSummary } from './lib/summary.js';
import type { CatalogueRow, CatalogueShape, CellIssue } from './lib/types.js';

export const DEFAULT_OUTPUT_DIR = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'catalogue', 'gb-6');
export const DEFAULT_CROPS_DIR = path.join(DOWNLOADED_ROOT, 'miyuki', 'catalogue', 'gb-6');

export const CSV_FILE_NAMES: Record<CatalogueShape, string> = {
  'round-rocailles': 'round-rocailles.csv',
  delica: 'delica.csv',
};

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/** PDF page numbers (1-based) holding each shape; the coating pages (84-91) list round rocailles under shape headings. */
export const GB6_PAGE_RANGES: Record<CatalogueShape, number[]> = {
  'round-rocailles': [...range(14, 27), ...range(84, 91)],
  delica: range(66, 83),
};

export interface ParseOptions {
  pdfPath: string;
  outDir: string;
  /** Directory for swatch crops, or null to skip cropping. */
  cropsDir: string | null;
  log?: (line: string) => void;
}

export interface ParseResult {
  rows: CatalogueRow[];
  issues: CellIssue[];
  skipped: number;
  summary: ParseSummary;
  csvPaths: Record<CatalogueShape, string>;
  cropsWritten: number;
}

/** Keeps crop paths unique: a colour listed twice at one size gets its page appended the second time. */
export function uniqueCropPath(relativePath: string, row: CatalogueRow, used: Set<string>): string {
  const candidate = used.has(relativePath) ? relativePath.replace(/\.png$/, `-p${row.page}.png`) : relativePath;
  used.add(candidate);
  return candidate;
}

async function writeCrops(pdf: CataloguePdf, rows: CatalogueRow[], cropsDir: string, used: Set<string>): Promise<number> {
  if (rows.length === 0) return 0;
  const render = pdf.renderPage(rows[0].page, CROP_DPI);
  for (const row of sortRows(rows)) {
    await writeSwatchCrop(render, row.swatch, CROP_DPI, path.join(cropsDir, uniqueCropPath(cropRelativePath(row), row, used)));
  }
  return rows.length;
}

export async function parseCatalogue(options: ParseOptions): Promise<ParseResult> {
  const log = options.log ?? (() => undefined);
  const pdf = await CataloguePdf.open(options.pdfPath);
  try {
    const rows: CatalogueRow[] = [];
    const issues: CellIssue[] = [];
    const usedCropPaths = new Set<string>();
    let skipped = 0;
    let cropsWritten = 0;
    for (const shape of Object.keys(GB6_PAGE_RANGES) as CatalogueShape[]) {
      let state = initialWalkState();
      for (const pageNumber of GB6_PAGE_RANGES[shape]) {
        if (pageNumber > pdf.pageCount()) throw new Error(`page ${pageNumber} is past the end of the PDF (${pdf.pageCount()} pages)`);
        const result = parsePage(pdf.readPageGraphics(pageNumber), shape, state);
        state = result.state;
        rows.push(...result.rows);
        issues.push(...result.issues);
        skipped += result.skipped;
        log(`p${pageNumber} ${shape}: ${result.rows.length} cells, ${result.issues.length} issues (${result.header?.en ?? 'no header'} ${result.header?.sizes.join(' ') ?? ''})`);
        if (options.cropsDir) cropsWritten += await writeCrops(pdf, result.rows, options.cropsDir, usedCropPaths);
      }
    }
    fs.mkdirSync(options.outDir, { recursive: true });
    const csvPaths = {} as Record<CatalogueShape, string>;
    for (const shape of Object.keys(CSV_FILE_NAMES) as CatalogueShape[]) {
      csvPaths[shape] = path.join(options.outDir, CSV_FILE_NAMES[shape]);
      fs.writeFileSync(
        csvPaths[shape],
        formatCsv(rows.filter((row) => row.shape === shape))
      );
    }
    return { rows: sortRows(rows), issues, skipped, summary: summarise(rows, issues, skipped), csvPaths, cropsWritten };
  } finally {
    pdf.destroy();
  }
}

function printUsage(): void {
  console.log(`Usage: pnpm beads:miyuki:catalogue -- --pdf <GB-6.pdf> [--crops [dir]] [--out <dir>]

  --pdf <path>    the catalogue PDF (required; never committed)
  --crops [dir]   also write a 300 dpi PNG crop of every swatch (default dir: ${path.relative(ASSET_REPO_ROOT, DEFAULT_CROPS_DIR)}/)
  --out <dir>     where the CSVs go (default: ${path.relative(ASSET_REPO_ROOT, DEFAULT_OUTPUT_DIR)}/)`);
}

export function parseArgs(argv: string[]): ParseOptions {
  const options: ParseOptions = { pdfPath: '', outDir: DEFAULT_OUTPUT_DIR, cropsDir: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    const takesValue = next !== undefined && !next.startsWith('--');
    if (arg === '--pdf' && takesValue) options.pdfPath = path.resolve(next), index++;
    else if (arg === '--out' && takesValue) options.outDir = path.resolve(next), index++;
    else if (arg === '--crops') options.cropsDir = takesValue ? (index++, path.resolve(next)) : DEFAULT_CROPS_DIR;
    else throw new Error(`unknown or incomplete argument: ${arg}`);
  }
  if (!options.pdfPath) throw new Error('--pdf <path> is required');
  return options;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    printUsage();
    return;
  }
  const options = parseArgs(argv);
  if (!fs.existsSync(options.pdfPath)) throw new Error(`PDF not found: ${options.pdfPath}`);

  const startedAt = Date.now();
  const result = await parseCatalogue({ ...options, log: (line) => console.log(line) });

  console.log('');
  console.log(formatSummary(result.summary));
  console.log('');
  for (const csvPath of Object.values(result.csvPaths)) console.log(`wrote ${path.relative(ASSET_REPO_ROOT, csvPath)}`);
  if (options.cropsDir) console.log(`wrote ${result.cropsWritten} swatch crops under ${path.relative(ASSET_REPO_ROOT, options.cropsDir)}/`);
  console.log(`Completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nGB-6 parse failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
