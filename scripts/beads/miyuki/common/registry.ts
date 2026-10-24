/**
 * Bead provenance registry: `sources/miyuki/registry/<type>.csv`, one row per bead and size.
 *
 * Every bead under `beads/miyuki/**` must have a row saying where its listing, image and size come
 * from and how trustworthy its colour is (issue adamaszczos/beadloo#203, section 2). The syncs append
 * rows when they add beads; `pnpm beads:miyuki:audit` fails when a bead has none.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT } from '../../common/lib/paths.js';
import type { MiyukiBeadType } from './directory-products.js';
import { splitCsvLine } from './csv.js';

export const REGISTRY_DIR = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'registry');

/** Where a fact comes from. `directory-historical` = was on Miyuki's directory when synced before the dump existed, no longer listed. */
export const REGISTRY_SOURCES = [
  'directory',
  'directory-historical',
  'catalogue-gb6',
  'durability-tsv',
  'sample-card',
  'delica-cross-reference',
  'same-colour-other-size',
  /** Miyuki's old/new colour table (`color_change.tsv`): names a square-hole colour and its size. */
  'color-change-tsv',
  /** The round-hole bead of the same number and size stands in for a square-hole colour with no image of its own. */
  'round-hole-sibling',
  /** Miyuki's 2007 "Conversion chart 11/0 Round to Delica" (and its reverse): names round colours at 11/0. */
  'conversion-chart-2007',
  /** Shops sell it as a Miyuki round rocaille at that size, but no Miyuki document names it: shown as "Not confirmed by Miyuki". */
  'retailer',
  /** A bead drawn by the renderer in a colour measured from photos, standing in where no Miyuki photo exists. */
  'rendered',
] as const;

export type RegistrySource = (typeof REGISTRY_SOURCES)[number];

export const COLOR_ACCURACIES = ['photo', 'swatch', 'approximate'] as const;

export type ColorAccuracy = (typeof COLOR_ACCURACIES)[number];

export type RegistryRow = {
  beadId: string;
  size: string;
  listingSource: RegistrySource;
  imageSource: RegistrySource;
  sizeSource: RegistrySource;
  colorAccuracy: ColorAccuracy;
  /** Product id, catalogue page and cell, card file: whatever lets a human find the evidence. */
  sourceRef: string;
  addedOn: string;
};

export const REGISTRY_COLUMNS: Array<keyof RegistryRow> = [
  'beadId',
  'size',
  'listingSource',
  'imageSource',
  'sizeSource',
  'colorAccuracy',
  'sourceRef',
  'addedOn',
];

export function registryPath(beadType: MiyukiBeadType): string {
  return path.join(REGISTRY_DIR, `${beadType.replace('miyuki-', '')}.csv`);
}

export function registryKey(beadId: string, size: string): string {
  return `${size}:${beadId.toUpperCase()}`;
}

/** Why a row's sources or colour accuracy are not values the registry knows (a typo, a shifted column), or null. */
export function registryRowProblem(row: RegistryRow): string | null {
  for (const column of ['listingSource', 'imageSource', 'sizeSource'] as const) {
    if (!(REGISTRY_SOURCES as readonly string[]).includes(row[column])) return `unknown ${column} "${row[column]}"`;
  }
  if (!(COLOR_ACCURACIES as readonly string[]).includes(row.colorAccuracy)) return `unknown colorAccuracy "${row.colorAccuracy}"`;
  return null;
}

/** Whether a row's image is Miyuki's own photo of the bead: `photo` accuracy, neither a shop's listing nor drawn by the renderer. */
export function isMiyukiPhotoRow(row: RegistryRow | undefined): boolean {
  return row?.colorAccuracy === 'photo' && row.listingSource !== 'retailer' && row.imageSource !== 'retailer' && row.imageSource !== 'rendered';
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function parseRegistryCsv(text: string): RegistryRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  if (header.join(',') !== REGISTRY_COLUMNS.join(',')) {
    throw new Error(`Unexpected registry header: ${lines[0]}`);
  }
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {} as Record<keyof RegistryRow, string>;
    REGISTRY_COLUMNS.forEach((column, index) => {
      row[column] = cells[index] ?? '';
    });
    return row as RegistryRow;
  });
}

export function formatRegistryCsv(rows: RegistryRow[]): string {
  const sorted = [...rows].sort((a, b) => Number(a.size) - Number(b.size) || compareBeadIds(a.beadId, b.beadId));
  const lines = [REGISTRY_COLUMNS.join(',')];
  for (const row of sorted) {
    lines.push(REGISTRY_COLUMNS.map((column) => escapeCsv(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Numeric-first ordering so `3`, `10`, `1001` and `DB0001`, `DB0010` read in catalogue order. */
export function compareBeadIds(a: string, b: string): number {
  const parse = (id: string) => {
    const match = id.toUpperCase().match(/^([A-Z]*)(\d+)(.*)$/);
    return match ? { prefix: match[1], number: Number.parseInt(match[2], 10), rest: match[3] } : { prefix: id, number: Number.NaN, rest: '' };
  };
  const left = parse(a);
  const right = parse(b);
  if (left.prefix !== right.prefix) return left.prefix.localeCompare(right.prefix);
  if (left.number !== right.number) return (left.number || 0) - (right.number || 0);
  return left.rest.localeCompare(right.rest);
}

export function readRegistry(beadType: MiyukiBeadType): RegistryRow[] {
  const file = registryPath(beadType);
  if (!fs.existsSync(file)) return [];
  return parseRegistryCsv(fs.readFileSync(file, 'utf-8'));
}

export function writeRegistry(beadType: MiyukiBeadType, rows: RegistryRow[]): void {
  const file = registryPath(beadType);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, formatRegistryCsv(rows), 'utf-8');
}

/** Adds rows for beads that have none; existing rows are never overwritten (provenance is append-only). */
export function upsertRegistryRows(existing: RegistryRow[], additions: RegistryRow[]): { rows: RegistryRow[]; added: number } {
  const byKey = new Map(existing.map((row) => [registryKey(row.beadId, row.size), row]));
  let added = 0;
  for (const row of additions) {
    const key = registryKey(row.beadId, row.size);
    if (!byKey.has(key)) {
      byKey.set(key, row);
      added += 1;
    }
  }
  return { rows: Array.from(byKey.values()), added };
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export type RegistryStore = { read: () => RegistryRow[]; write: (rows: RegistryRow[]) => void };

/**
 * Writes planned beads one at a time and saves the registry rows of the beads written, also when a
 * later one fails: a bead never stays on disk without its row. `write` puts one bead's files in place
 * and returns its row. Returns how many rows were added.
 */
export async function writeBeadsAndRegistry<T>(
  beadType: MiyukiBeadType,
  entries: Iterable<T>,
  write: (entry: T) => Promise<RegistryRow> | RegistryRow,
  store: RegistryStore = { read: () => readRegistry(beadType), write: (rows) => writeRegistry(beadType, rows) },
): Promise<number> {
  const written: RegistryRow[] = [];
  let added = 0;
  try {
    for (const entry of entries) written.push(await write(entry));
  } finally {
    if (written.length > 0) {
      const merged = upsertRegistryRows(store.read(), written);
      store.write(merged.rows);
      added = merged.added;
    }
  }
  return added;
}
