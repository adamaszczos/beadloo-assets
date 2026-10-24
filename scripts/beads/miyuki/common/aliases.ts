#!/usr/bin/env tsx
/**
 * Alias files: old bead IDs that resolve to Miyuki's official current ID (issue #203, decision 7).
 *
 * An alias is another number for the SAME bead. Miyuki's `-1` colours are not aliases: the official
 * Delica list gives `DB106-1` a different finish from the `DB106` Miyuki's directory still sells, so
 * both are beads of their own and a beader picks one (decided 2026-10-17, beadloo-assets PR #2).
 *
 * Sources, all official:
 * - `color_change.tsv`: Miyuki's old (tentative) numbers to unified numbers, in the `Round <size>/0`
 *   sections (`701` → `1` at 8/0, `3 S.H.` → `3SH`) and the `Square Hole Round <size>/0` ones
 *   (`131S` → `1SH` at 11/0).
 * - the directory dump: a product name that carries the old number in brackets
 *   (`#1(131S) Round Rocailles 6/0` → `131S` → `1` at 6/0).
 *
 * A candidate becomes an alias only when the official bead exists in `beads/` at that size, so an
 * alias never points at nothing; the rest are reported as pending (they arrive with later phases).
 * One file per type and size, `generated/data/miyuki/<type>/<size>-aliases.json`, mirrored into the
 * app by `pnpm beadloo:sync`; the app's resolver maps an old ID only when the official bead is loaded.
 *
 * Usage: pnpm beads:miyuki:aliases   (also run by both Miyuki syncs after their metadata step)
 */

import * as fs from 'fs';
import * as path from 'path';
import { GENERATED_DATA_DIR, getBeadTypeDirectory, getGeneratedBeadTypeDataDirectory } from '../../common/lib/paths.js';
import { canonicalDelicaId, readColorChangeTsv, type ColorChangeRow } from './official-lists.js';
import type { DirectoryListing, MiyukiBeadType } from './directory-products.js';
import { DIRECTORY_DUMP_PATH, loadDirectoryListings } from './directory-catalog.js';
import { ROUND_ROCAILLE_SIZES } from './round-rocaille-ids.js';

export type AliasCandidate = {
  beadType: MiyukiBeadType;
  /** Compact size, or null when the source states none (then every size that has the official bead). */
  size: string | null;
  oldId: string;
  officialId: string;
  source: string;
};

export type AliasFiles = Record<string, Record<string, string>>; // "<type>/<size>" → { oldId: officialId }

export const DELICA_SIZES = ['8', '10', '11', '15'];

/** Candidates from the old/new table: only the `Round <size>/0` sections are round rocailles. */
export function aliasCandidatesFromColorChange(rows: ColorChangeRow[]): AliasCandidate[] {
  const candidates: AliasCandidate[] = [];
  for (const row of rows) {
    if (row.shape.toLowerCase() !== 'round' || !row.size || !row.unified) continue;
    const officialId = `${row.unified}${row.squareHole ? 'SH' : ''}`;
    if (row.oldNumber === officialId) continue;
    candidates.push({ beadType: 'miyuki-round_rocailles', size: row.size, oldId: row.oldNumber, officialId, source: `color_change.tsv ${row.section}` });
  }
  return candidates;
}

/** Candidates from the directory: the old number a product name carries in brackets, at that product's size. */
export function aliasCandidatesFromDirectory(listings: ReadonlyArray<Pick<DirectoryListing, 'beadType' | 'beadId' | 'size' | 'oldNumber' | 'name'>>): AliasCandidate[] {
  const candidates: AliasCandidate[] = [];
  for (const listing of listings) {
    if (!listing.oldNumber || listing.oldNumber.toUpperCase() === listing.beadId.toUpperCase()) continue;
    candidates.push({ beadType: listing.beadType, size: listing.size, oldId: listing.oldNumber, officialId: listing.beadId, source: `directory name "${listing.name}"` });
  }
  return candidates;
}

function readDirectoryCandidates(): AliasCandidate[] {
  if (!fs.existsSync(DIRECTORY_DUMP_PATH)) return [];
  const listings = (['miyuki-delica', 'miyuki-round_rocailles'] as MiyukiBeadType[]).flatMap(
    (beadType) => loadDirectoryListings(beadType, { includeSquareHole: true }).listings,
  );
  return aliasCandidatesFromDirectory(listings);
}

export function readDiskIds(beadType: MiyukiBeadType, size: string): Set<string> {
  const dir = getBeadTypeDirectory(beadType, size);
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.metadata.json')).map((f) => f.slice(0, -'.metadata.json'.length).toUpperCase()));
}

export type AliasBuildResult = { files: AliasFiles; emitted: AliasCandidate[]; pending: AliasCandidate[] };

/**
 * Resolves candidates against what is on disk: an alias is emitted only where its official bead
 * exists, and never where the old ID is itself a bead at that size (a bead is never aliased away).
 */
export function buildAliasFiles(
  candidates: AliasCandidate[],
  diskIds: (beadType: MiyukiBeadType, size: string) => Set<string>,
  sizes: Record<MiyukiBeadType, string[]> = { 'miyuki-delica': DELICA_SIZES, 'miyuki-round_rocailles': ROUND_ROCAILLE_SIZES }
): AliasBuildResult {
  const files: AliasFiles = {};
  for (const beadType of Object.keys(sizes) as MiyukiBeadType[]) {
    for (const size of sizes[beadType]) files[`${beadType}/${size}`] = {};
  }
  const emitted: AliasCandidate[] = [];
  const pending: AliasCandidate[] = [];
  for (const candidate of candidates) {
    const targetSizes = candidate.size ? [candidate.size] : sizes[candidate.beadType];
    let placed = false;
    for (const size of targetSizes) {
      const ids = diskIds(candidate.beadType, size);
      if (!ids.has(candidate.officialId.toUpperCase()) || ids.has(candidate.oldId.toUpperCase())) continue;
      const key = `${candidate.beadType}/${size}`;
      files[key] ??= {};
      files[key][candidate.oldId.toUpperCase()] = candidate.officialId.toUpperCase();
      placed = true;
    }
    (placed ? emitted : pending).push(candidate);
  }
  for (const key of Object.keys(files)) {
    files[key] = Object.fromEntries(Object.entries(files[key]).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
  }
  return { files, emitted, pending };
}

export function aliasFilePath(beadType: MiyukiBeadType, size: string, dataRoot = GENERATED_DATA_DIR): string {
  return getGeneratedBeadTypeDataDirectory(beadType, dataRoot, `${size}-aliases.json`);
}

export function writeAliasFiles(files: AliasFiles, dataRoot = GENERATED_DATA_DIR): string[] {
  const written: string[] = [];
  for (const [key, table] of Object.entries(files)) {
    const [beadType, size] = key.split('/') as [MiyukiBeadType, string];
    const file = aliasFilePath(beadType, size, dataRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(table, null, 2)}\n`, 'utf-8');
    written.push(file);
  }
  return written;
}

export function generateAliasFiles(options: { verbose?: boolean } = {}): AliasBuildResult {
  const candidates = [
    ...aliasCandidatesFromColorChange(readColorChangeTsv()),
    ...readDirectoryCandidates(),
  ];
  const result = buildAliasFiles(candidates, readDiskIds);
  writeAliasFiles(result.files);
  const emittedCount = Object.values(result.files).reduce((sum, table) => sum + Object.keys(table).length, 0);
  console.log(`  aliases: ${emittedCount} emitted across ${Object.keys(result.files).length} files, ${result.pending.length} pending (official bead not on disk yet)`);
  if (options.verbose) {
    for (const candidate of result.pending.slice(0, 20)) console.log(`    pending: ${candidate.oldId} → ${candidate.officialId} (${candidate.beadType}${candidate.size ? ` ${candidate.size}/0` : ''}; ${candidate.source})`);
  }
  return result;
}

/** Sanity: every canonical Delica alias must be a Delica ID. */
export function assertCanonicalDelicaAliases(files: AliasFiles): void {
  for (const [key, table] of Object.entries(files)) {
    if (!key.startsWith('miyuki-delica/')) continue;
    for (const [oldId, officialId] of Object.entries(table)) {
      if (!canonicalDelicaId(oldId) || !canonicalDelicaId(officialId)) throw new Error(`alias ${oldId} → ${officialId} in ${key} is not a Delica ID`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = generateAliasFiles({ verbose: process.argv.includes('--verbose') });
  assertCanonicalDelicaAliases(result.files);
}
