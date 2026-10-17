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
export type RegistrySource =
  | 'directory'
  | 'directory-historical'
  | 'catalogue-gb6'
  | 'durability-tsv'
  | 'sample-card'
  | 'delica-cross-reference'
  | 'same-colour-other-size'
  /** Miyuki's old/new colour table (`color_change.tsv`): names a square-hole colour and its size. */
  | 'color-change-tsv'
  /** The round-hole bead of the same number and size stands in for a square-hole colour with no image of its own. */
  | 'round-hole-sibling';

export type ColorAccuracy = 'photo' | 'swatch' | 'approximate';

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
