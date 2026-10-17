#!/usr/bin/env tsx
/**
 * Miyuki library audit: `beads/miyuki/**` against the committed official sources.
 *
 * Prints, per bead type and size, what is on disk, what has a provenance row, and which official
 * (colour, size) pairs are still missing, by source. It is the scoreboard of issue
 * adamaszczos/beadloo#203 and fails when a bead has no registry row or a directory product does not
 * parse.
 *
 * Usage:
 *   pnpm beads:miyuki:audit                       Report
 *   pnpm beads:miyuki:audit -- --write-registry   Add registry rows for beads that have none (bootstrap)
 *   pnpm beads:miyuki:audit -- --write-hold-out   Rewrite sources/miyuki/hold-out.csv
 *   pnpm beads:miyuki:audit -- --lookup 22,327,2479   Where these round-rocaille colour numbers appear, by source
 */

import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT, getBeadTypeDirectory } from '../common/lib/paths.js';
import { DIRECTORY_DUMP_PATH, applyDecisions, readDecisions, readDirectoryDump } from './common/directory-catalog.js';
import { classifyDirectoryProducts, type DirectoryListing, type DirectoryListings, type MiyukiBeadType } from './common/directory-products.js';
import { readDurabilityTsv, DURABILITY_TSV_PATH, type DelicaOfficialRow } from './common/official-lists.js';
import { readRegistry, registryKey, todayIso, upsertRegistryRows, writeRegistry, type RegistryRow } from './common/registry.js';
import { listingKey } from './common/sync-pipeline.js';
import { parseCsv } from './common/csv.js';

const BEAD_TYPES: MiyukiBeadType[] = ['miyuki-delica', 'miyuki-round_rocailles'];
const CATALOGUE_DIR = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'catalogue', 'gb-6');
const HOLD_OUT_PATH = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'hold-out.csv');

// ============================================================================
// Pure helpers
// ============================================================================

export type DiskInventory = Map<string, Set<string>>; // size → bead IDs (upper case)

export function readDiskInventory(beadType: MiyukiBeadType): DiskInventory {
  const inventory: DiskInventory = new Map();
  const typeDir = getBeadTypeDirectory(beadType);
  if (!fs.existsSync(typeDir)) return inventory;
  for (const size of fs.readdirSync(typeDir).filter((entry) => fs.statSync(path.join(typeDir, entry)).isDirectory())) {
    const ids = new Set<string>();
    for (const file of fs.readdirSync(path.join(typeDir, size))) {
      if (file.endsWith('.metadata.json')) ids.add(file.slice(0, -'.metadata.json'.length).toUpperCase());
    }
    inventory.set(size, ids);
  }
  return inventory;
}

export function sortSizes(sizes: Iterable<string>): string[] {
  return Array.from(sizes).sort((a, b) => Number(a) - Number(b));
}


/** Registry rows per colour accuracy (`photo`, `swatch`, `approximate`), for the scoreboard line. */
export function countColourAccuracy(rows: ReadonlyArray<Pick<RegistryRow, 'colorAccuracy'>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.colorAccuracy] = (counts[row.colorAccuracy] ?? 0) + 1;
  return counts;
}

/** The colour number without Miyuki's `-1` marker and without a square-hole suffix (for lookups). */
export function baseColourNumber(id: string): string {
  return id.toUpperCase().replace(/-1$/, '').replace(/SH$/, '');
}

/**
 * The colour number without a square-hole suffix; a `-1` number stays itself, because it is a
 * different product from the plain number (beadloo-assets PR #2).
 */
export function seedColourNumber(id: string): string {
  return id.toUpperCase().replace(/SH$/, '');
}

export type CatalogueRow = { colour_no: string; size: string; hole: string; prefix: string; page: string; section_en?: string };

/** A catalogue row that names a colour: the round-rocaille Mix page lists bead mixes, which are not colours. */
export function isCatalogueColourRow(row: Pick<CatalogueRow, 'section_en'>): boolean {
  return !/^mix\b/i.test((row.section_en ?? '').trim());
}

export function parseCatalogueCsv(text: string): CatalogueRow[] {
  return parseCsv(text).map((row) => ({
    colour_no: row.colour_no ?? '',
    size: row.size ?? '',
    hole: row.hole ?? '',
    prefix: row.prefix ?? '',
    page: row.page ?? '',
    section_en: row.section_en ?? '',
  }));
}

/** Beadloo's bead ID for a catalogue row: `DB` + `22L` → `DB0022L`; `1` + SH → `1SH`. */
export function catalogueRowToBeadId(row: Pick<CatalogueRow, 'colour_no' | 'hole' | 'prefix'>, beadType: MiyukiBeadType): string {
  if (beadType === 'miyuki-delica') {
    const match = row.colour_no.match(/^(\d+)([A-Z]*)(-1)?$/i);
    if (!match) return `${row.prefix}${row.colour_no}`.toUpperCase();
    return `${row.prefix}${match[1].padStart(4, '0')}${match[2]}${match[3] ?? ''}`.toUpperCase();
  }
  return `${row.colour_no}${row.hole === 'SH' ? 'SH' : ''}`.toUpperCase();
}

function compactSize(size: string): string {
  return size.replace('/0', '').replace(/^0+(?!$)/, '');
}

function list(ids: Iterable<string>, limit = 12): string {
  const array = Array.from(ids);
  return array.length > limit ? `${array.slice(0, limit).join(' ')} … (${array.length})` : array.join(' ');
}

// ============================================================================
// Sections
// ============================================================================

type Problems = { beadsWithoutRegistry: number; unparsedProducts: number };

function auditRegistry(beadType: MiyukiBeadType, inventory: DiskInventory, listingsByKey: Map<string, DirectoryListing>, writeRegistryRows: boolean, problems: Problems): void {
  const registry = readRegistry(beadType);
  const rowKeys = new Set(registry.map((row) => registryKey(row.beadId, row.size)));
  const additions: RegistryRow[] = [];
  console.log(`\n${beadType}`);
  console.log(`  size   beads   registry  missing`);
  for (const size of sortSizes(inventory.keys())) {
    const ids = inventory.get(size)!;
    const missing = Array.from(ids).filter((id) => !rowKeys.has(registryKey(id, size))).sort();
    console.log(`  ${size.padEnd(6)} ${String(ids.size).padStart(5)}   ${String(ids.size - missing.length).padStart(8)}  ${missing.length}${missing.length ? `  ${list(missing)}` : ''}`);
    problems.beadsWithoutRegistry += missing.length;
    if (writeRegistryRows) {
      for (const beadId of missing) {
        const listing = listingsByKey.get(`${size}:${beadId}`);
        additions.push({
          beadId: listing?.beadId ?? beadId,
          size,
          listingSource: listing ? 'directory' : 'directory-historical',
          imageSource: listing ? 'directory' : 'directory-historical',
          sizeSource: listing ? 'directory' : 'directory-historical',
          colorAccuracy: 'photo',
          sourceRef: listing ? `product:${listing.productId} ${listing.permalink}` : 'synced from the directory before the dump existed (2026-10-16)',
          addedOn: todayIso(),
        });
      }
    }
  }
  if (writeRegistryRows && additions.length > 0) {
    const { rows, added } = upsertRegistryRows(registry, additions);
    writeRegistry(beadType, rows);
    console.log(`  wrote ${added} registry row(s)`);
    problems.beadsWithoutRegistry -= added;
  }
  const accuracy = countColourAccuracy(registry);
  console.log(`  colour accuracy: ${Object.keys(accuracy).sort().map((key) => `${key} ${accuracy[key]}`).join(', ')}`);
  const squareHole = countSquareHole(inventory);
  if (squareHole.length > 0) console.log(`  square hole: ${squareHole.map(([size, count]) => `${size}/0 ${count}`).join(', ')}`);
}

/** Square-hole IDs (`<n>SH`) per size, for the sizes that have any. */
export function countSquareHole(inventory: DiskInventory): Array<[string, number]> {
  return sortSizes(inventory.keys())
    .map((size): [string, number] => [size, Array.from(inventory.get(size) ?? []).filter((id) => id.endsWith('SH')).length])
    .filter(([, count]) => count > 0);
}

function auditDirectory(classified: DirectoryListings, inventories: Record<MiyukiBeadType, DiskInventory>, problems: Problems): void {
  console.log(`\nDirectory coverage (dump)`);
  const decisions = readDecisions();
  problems.unparsedProducts = classified.unparsed.length;
  if (classified.unparsed.length > 0) {
    console.log(`  UNPARSED products: ${classified.unparsed.length}`);
    for (const entry of classified.unparsed.slice(0, 10)) console.log(`    ${entry.product.name} [${entry.product.sku}]`);
  }
  for (const beadType of BEAD_TYPES) {
    const inventory = inventories[beadType];
    const ofType = classified.listings.filter((listing) => listing.beadType === beadType);
    const sizes = sortSizes(new Set(ofType.map((listing) => listing.size)));
    console.log(`  ${beadType}`);
    for (const size of sizes) {
      const atSize = ofType.filter((listing) => listing.size === size);
      const onDisk = inventory.get(size) ?? new Set<string>();
      const missing = atSize.filter((listing) => !onDisk.has(listing.beadId.toUpperCase()));
      // Square-hole listings are ordinary beads since issue #203: a missing one is simply missing.
      const conflicts = applyDecisions(missing.filter((listing) => listing.conflicts.length > 0), decisions).undecided;
      const plain = missing.filter((listing) => listing.conflicts.length === 0);
      console.log(
        `    ${size.padEnd(4)} listed ${String(atSize.length).padStart(5)}  on disk ${String(atSize.length - missing.length).padStart(5)}  missing ${String(plain.length).padStart(3)}${plain.length ? ` (${list(plain.map((l) => l.beadId))})` : ''}${conflicts.length ? `  conflicts ${conflicts.length} (${list(conflicts.map((l) => l.beadId))})` : ''}`
      );
    }
  }
}

function auditOfficialDelicaList(rows: DelicaOfficialRow[], inventory: DiskInventory): string[] {
  const onDisk = new Set(Array.from(inventory.values()).flatMap((ids) => Array.from(ids)));
  const present: string[] = [];
  const missingActive: string[] = [];
  const missingDiscontinued: string[] = [];
  for (const row of rows) {
    if (onDisk.has(row.beadId)) present.push(row.beadId);
    else if (row.discontinued) missingDiscontinued.push(row.beadId);
    else missingActive.push(row.beadId);
  }
  console.log(`\nOfficial Delica list (durability.tsv): ${rows.length} colours`);
  console.log(`  present:                       ${present.length}`);
  console.log(`  missing, active:               ${missingActive.length}${missingActive.length ? `  ${list(missingActive)}` : ''}`);
  console.log(`  missing, discontinued:         ${missingDiscontinued.length}${missingDiscontinued.length ? `  ${list(missingDiscontinued)}` : ''}`);
  console.log(`  discontinued in the list:      ${rows.filter((row) => row.discontinued).length}`);
  return missingDiscontinued;
}

function auditSeedNumbers(rows: DelicaOfficialRow[], inventory: DiskInventory, listings: DirectoryListing[], catalogue: CatalogueRow[]): string[] {
  const onDisk = new Set(Array.from(inventory.values()).flatMap((ids) => Array.from(ids, seedColourNumber)));
  const listed = new Set(listings.map((listing) => seedColourNumber(listing.beadId)));
  const inCatalogue = new Set(catalogue.map((row) => seedColourNumber(row.colour_no)));
  const seeds = new Set(rows.map((row) => row.seedNumber).filter((seed) => seed && !/^N\/?A$/i.test(seed)).map(seedColourNumber));
  const present = Array.from(seeds).filter((seed) => onDisk.has(seed));
  const sourcedElsewhere = Array.from(seeds).filter((seed) => !onDisk.has(seed) && (listed.has(seed) || inCatalogue.has(seed)));
  const holdOut = Array.from(seeds).filter((seed) => !onDisk.has(seed) && !listed.has(seed) && !inCatalogue.has(seed)).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b));
  console.log(`\nRound-rocaille numbers named by the Delica cross-reference (Seed#): ${seeds.size}`);
  console.log(`  present at some size:              ${present.length}`);
  console.log(`  listed by the directory/catalogue: ${sourcedElsewhere.length}`);
  console.log(`  no size stated anywhere (hold-out): ${holdOut.length}`);
  return holdOut;
}

function auditCatalogue(rowsByShape: Record<string, CatalogueRow[]>, inventories: Record<MiyukiBeadType, DiskInventory>): void {
  console.log(`\nCatalogue GB-6 coverage`);
  const shapes: Array<[string, MiyukiBeadType]> = [['round-rocailles', 'miyuki-round_rocailles'], ['delica', 'miyuki-delica']];
  for (const [shape, beadType] of shapes) {
    const rows = rowsByShape[shape];
    if (!rows) {
      console.log(`  ${shape}: no CSV yet (run pnpm beads:miyuki:catalogue)`);
      continue;
    }
    const inventory = inventories[beadType];
    const colourRows = rows.filter(isCatalogueColourRow);
    const mixes = rows.length - colourRows.length;
    const sizes = sortSizes(new Set(colourRows.map((row) => compactSize(row.size))));
    console.log(`  ${shape}: ${rows.length} cells${mixes > 0 ? ` (${mixes} mix cells left out: a mix is not a colour)` : ''}`);
    for (const size of sizes) {
      // A colour can be printed twice at one size (its size section and a coating page): count IDs, not cells.
      const atSize = Array.from(new Set(colourRows.filter((row) => compactSize(row.size) === size).map((row) => catalogueRowToBeadId(row, beadType))));
      const onDisk = inventory.get(size) ?? new Set<string>();
      const missing = atSize.filter((beadId) => !onDisk.has(beadId.toUpperCase()));
      console.log(`    ${size.padEnd(4)} listed ${String(atSize.length).padStart(5)}  present ${String(atSize.length - missing.length).padStart(5)}  missing ${String(missing.length).padStart(4)}${missing.length ? `  (${list(missing, 8)})` : ''}`);
    }
  }
}

export type ColourLookup = {
  colourNo: string;
  onDisk: string[];
  directory: string[];
  catalogue: string[];
  delicaEquivalents: string[];
};

/** Every place a round-rocaille colour number appears: sizes on disk, directory listings, catalogue rows (with page), and the Delica colours Miyuki's cross-reference ties it to. */
export function lookupColour(
  colourNo: string,
  inventory: DiskInventory,
  listings: DirectoryListing[],
  catalogue: CatalogueRow[],
  delicaRows: DelicaOfficialRow[]
): ColourLookup {
  const wanted = baseColourNumber(colourNo.replace(/^0+(?=\d)/, ''));
  const onDisk = sortSizes(inventory.keys())
    .flatMap((size) => Array.from(inventory.get(size)!).filter((id) => baseColourNumber(id) === wanted).map((id) => `${size}/0 (${id})`));
  const directory = listings
    .filter((listing) => baseColourNumber(listing.beadId) === wanted)
    .sort((a, b) => Number(a.size) - Number(b.size))
    .map((listing) => `${listing.size}/0 (${listing.beadId}${listing.conflicts.length ? ', conflict' : ''})`);
  const catalogueHits = catalogue
    .filter((row) => baseColourNumber(row.colour_no) === wanted)
    .map((row) => `${row.size}${row.hole === 'SH' ? ' SH' : ''} p.${row.page}`);
  const delicaEquivalents = delicaRows
    .filter((row) => row.seedNumber && baseColourNumber(row.seedNumber) === wanted)
    .map((row) => `${row.beadId} (${row.glassTypeFinish}${row.discontinued ? ', discontinued' : ''})`);
  return { colourNo, onDisk, directory, catalogue: Array.from(new Set(catalogueHits)), delicaEquivalents };
}

function printLookup(result: ColourLookup): void {
  const show = (values: string[]) => (values.length ? values.join(', ') : 'none');
  console.log(`\n  colour ${result.colourNo}`);
  console.log(`    in Beadloo:        ${show(result.onDisk)}`);
  console.log(`    directory:         ${show(result.directory)}`);
  console.log(`    catalogue GB-6:    ${show(result.catalogue)}`);
  console.log(`    Delica equivalent: ${show(result.delicaEquivalents)}`);
}

function writeHoldOut(holdOut: string[], delicaWithoutSource: string[] = []): void {
  const lines = [
    'colour_no,source,note',
    ...holdOut.map((number) => `${number},durability-tsv Seed#,${number.endsWith('-1') ? 'a -1 number (a different product from the plain number); no official source states a size; held out until one does' : 'no official source states a size; held out until one does'}`),
    ...delicaWithoutSource.map((beadId) => `${beadId},durability-tsv discontinued,discontinued Delica with no official image and no colour source; held out until Miyuki provides one`),
  ];
  fs.writeFileSync(HOLD_OUT_PATH, `${lines.join('\n')}\n`, 'utf-8');
  console.log(`\nwrote ${path.relative(ASSET_REPO_ROOT, HOLD_OUT_PATH)} (${holdOut.length} colours)`);
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const argv = process.argv.slice(2);
  const writeRegistryRows = argv.includes('--write-registry');
  const writeHoldOutFile = argv.includes('--write-hold-out');
  const lookupIndex = argv.indexOf('--lookup');
  const lookups = lookupIndex >= 0 && argv[lookupIndex + 1] ? argv[lookupIndex + 1].split(',').map((v) => v.trim()).filter(Boolean) : [];
  const problems: Problems = { beadsWithoutRegistry: 0, unparsedProducts: 0 };
  if (writeRegistryRows && !fs.existsSync(DIRECTORY_DUMP_PATH)) {
    console.error('--write-registry needs the directory dump to tell live listings from historical ones; run `pnpm beads:miyuki:directory -- --fetch` first.');
    process.exit(1);
  }

  const inventories = Object.fromEntries(BEAD_TYPES.map((beadType) => [beadType, readDiskInventory(beadType)])) as Record<MiyukiBeadType, DiskInventory>;

  let classified: DirectoryListings | null = null;
  if (fs.existsSync(DIRECTORY_DUMP_PATH)) {
    classified = classifyDirectoryProducts(readDirectoryDump().products);
  } else {
    console.log(`No directory dump at ${path.relative(ASSET_REPO_ROOT, DIRECTORY_DUMP_PATH)}; directory coverage skipped.`);
  }
  const listingsByKey = new Map((classified?.listings ?? []).map((listing) => [listingKey(listing), listing]));

  console.log('\nBeads on disk and their registry rows');
  for (const beadType of BEAD_TYPES) auditRegistry(beadType, inventories[beadType], listingsByKey, writeRegistryRows, problems);

  if (classified) auditDirectory(classified, inventories, problems);

  const catalogue: Record<string, CatalogueRow[]> = {};
  for (const shape of ['round-rocailles', 'delica']) {
    const file = path.join(CATALOGUE_DIR, `${shape}.csv`);
    if (fs.existsSync(file)) catalogue[shape] = parseCatalogueCsv(fs.readFileSync(file, 'utf-8'));
  }

  if (lookups.length > 0) {
    const delicaRows = fs.existsSync(DURABILITY_TSV_PATH) ? readDurabilityTsv() : [];
    const rrListings = (classified?.listings ?? []).filter((listing) => listing.beadType === 'miyuki-round_rocailles');
    console.log('\nRound-rocaille colour lookup');
    for (const colourNo of lookups) {
      printLookup(lookupColour(colourNo, inventories['miyuki-round_rocailles'], rrListings, catalogue['round-rocailles'] ?? [], delicaRows));
    }
    return;
  }

  if (fs.existsSync(DURABILITY_TSV_PATH)) {
    const rows = readDurabilityTsv();
    const delicaWithoutSource = auditOfficialDelicaList(rows, inventories['miyuki-delica']);
    const holdOut = auditSeedNumbers(rows, inventories['miyuki-round_rocailles'], (classified?.listings ?? []).filter((l) => l.beadType === 'miyuki-round_rocailles'), catalogue['round-rocailles'] ?? []);
    if (writeHoldOutFile) writeHoldOut(holdOut, delicaWithoutSource);
  }

  auditCatalogue(catalogue, inventories);

  console.log('');
  if (problems.beadsWithoutRegistry > 0) console.error(`FAIL: ${problems.beadsWithoutRegistry} bead(s) without a registry row (run with --write-registry to bootstrap directory-sourced beads).`);
  if (problems.unparsedProducts > 0) console.error(`FAIL: ${problems.unparsedProducts} directory product(s) do not parse.`);
  if (problems.beadsWithoutRegistry > 0 || problems.unparsedProducts > 0) process.exit(1);
  console.log('Audit OK: every bead has a registry row and every directory product parses.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
