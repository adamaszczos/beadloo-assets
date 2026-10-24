#!/usr/bin/env tsx
/**
 * Marks every Miyuki bead an official source calls discontinued: `status: "Discontinued"` in its
 * sidecar (issue #203). The bead stays in the library and stays usable: beaders draw with what they own.
 *
 * Sources:
 * - Miyuki's Delica list (`official/durability.tsv`, its Discontinued column): Delica at 11/0;
 * - Miyuki's Glass Enamel notice of 2023-07-03 (`official/glass-enamel-discontinued-2023-07-03.tsv`):
 *   the Delica numbers at the size their prefix names, and the non-Delica colour numbers at every
 *   round-rocaille size on disk (a colour number names the same glass and finish in every shape).
 *
 * Idempotent; never removes a bead. Run it after a sync that rewrites directory sidecars, then the
 * `--local-only` syncs so the metadata JSON follows. It names the notice's numbers that Miyuki's
 * directory dump still sells: the notice marks them anyway, and the owner decides with both in view.
 * (It replaced `beads:miyuki:delica:mark-discontinued`, which marked the Delica list's flags alone.)
 *
 * Usage: pnpm beads:miyuki:mark-discontinued [--dry-run]
 */
import * as fs from 'fs';
import * as path from 'path';
import { getBeadTypeDirectory } from '../common/lib/paths.js';
import { OFFICIAL_DIR, readDurabilityTsv } from './common/official-lists.js';
import { ROUND_ROCAILLE_SIZES } from './common/round-rocaille-ids.js';
import { DIRECTORY_DUMP_PATH, readDirectoryDump } from './common/directory-catalog.js';
import { classifyDirectoryProducts, delicaSizeForPrefix, type DirectoryListing, type MiyukiBeadType } from './common/directory-products.js';

const NOTICE = path.join(OFFICIAL_DIR, 'glass-enamel-discontinued-2023-07-03.tsv');

export type NoticeEntry = { kind: 'delica' | 'non-delica'; number: string; comment: string };

export function withDiscontinuedStatus(sidecar: Record<string, unknown>): { sidecar: Record<string, unknown>; changed: boolean } {
  if (sidecar.status === 'Discontinued') return { sidecar, changed: false };
  const { colorAccuracy, formerly, ...rest } = sidecar;
  // Keep the issue #203 fields at the end in a stable order: status, colorAccuracy, formerly.
  const next: Record<string, unknown> = { ...rest, status: 'Discontinued' };
  if (colorAccuracy !== undefined) next.colorAccuracy = colorAccuracy;
  if (formerly !== undefined) next.formerly = formerly;
  return { sidecar: next, changed: true };
}

/** The notice's table: a header row switches between its Delica and non-Delica halves. */
export function parseGlassEnamelNotice(text: string): NoticeEntry[] {
  const entries: NoticeEntry[] = [];
  let kind: NoticeEntry['kind'] = 'delica';
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('\t').map((cell) => cell.trim());
    const number = cells[1] ?? '';
    if (!number) continue;
    if (/^color no\. in non-delica/i.test(number)) { kind = 'non-delica'; continue; }
    if (/^color no\./i.test(number)) { kind = 'delica'; continue; }
    if (!/discontinued/i.test(cells[2] ?? '')) continue;
    entries.push({ kind, number: number.toUpperCase(), comment: (cells[2] ?? '').replace(/&#8594;/g, '→') });
  }
  return entries;
}

export type DiscontinuedTarget = { file: string; beadType: MiyukiBeadType; reason: string };

/** Sidecar files the official sources mark discontinued, with their bead type and the reason. */
export function discontinuedTargets(entries: NoticeEntry[], delicaFlagged: string[], exists: (file: string) => boolean): DiscontinuedTarget[] {
  const targets = new Map<string, DiscontinuedTarget>();
  const add = (beadType: MiyukiBeadType, size: string, beadId: string, reason: string) => {
    const file = path.join(getBeadTypeDirectory(beadType, size), `${beadId}.metadata.json`);
    if (exists(file)) targets.set(file, { file, beadType, reason });
  };
  for (const beadId of delicaFlagged) add('miyuki-delica', '11', beadId, "Miyuki's Delica list (durability.tsv) flags it discontinued");
  for (const entry of entries) {
    const reason = `Miyuki's Glass Enamel notice of 2023-07-03: ${entry.comment}`;
    if (entry.kind === 'delica') {
      const prefix = /^(DB[MLS]?)C?\d/.exec(entry.number)?.[1];
      const size = prefix ? delicaSizeForPrefix(prefix) : null;
      if (size) add('miyuki-delica', size, entry.number, reason);
      continue;
    }
    for (const size of ROUND_ROCAILLE_SIZES) add('miyuki-round_rocailles', size, entry.number, reason);
  }
  return Array.from(targets.values());
}

/** The notice's numbers the directory still lists, as `number@size`: a Delica number as such, a colour number as a round rocaille. */
export function noticeNumbersStillListed(entries: ReadonlyArray<NoticeEntry>, listings: ReadonlyArray<Pick<DirectoryListing, 'beadType' | 'beadId' | 'size'>>): string[] {
  const wanted = new Map(entries.map((entry) => [`${entry.kind === 'delica' ? 'miyuki-delica' : 'miyuki-round_rocailles'}:${entry.number}`, entry.number]));
  return listings
    .filter((listing) => wanted.has(`${listing.beadType}:${listing.beadId.toUpperCase()}`))
    .map((listing) => `${listing.beadId.toUpperCase()}@${listing.size}`)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const entries = parseGlassEnamelNotice(fs.readFileSync(NOTICE, 'utf-8'));
  const delicaFlagged = readDurabilityTsv().filter((row) => row.discontinued).map((row) => row.beadId);
  const targets = discontinuedTargets(entries, delicaFlagged, (file) => fs.existsSync(file));
  let marked = 0;
  const byType = new Map<string, number>();
  for (const { file, beadType } of targets) {
    const { sidecar, changed } = withDiscontinuedStatus(JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>);
    if (!changed) continue;
    if (!dryRun) fs.writeFileSync(file, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf-8');
    marked += 1;
    byType.set(beadType, (byType.get(beadType) ?? 0) + 1);
  }
  console.log(`Notice entries: ${entries.length} (Delica ${entries.filter((e) => e.kind === 'delica').length}, non-Delica ${entries.filter((e) => e.kind === 'non-delica').length}); Delica list flags: ${delicaFlagged.length}`);
  console.log(`Sidecars the sources mark: ${targets.length}; newly marked${dryRun ? ' (dry run)' : ''}: ${marked} (${Array.from(byType, ([t, n]) => `${t} ${n}`).join(', ') || 'none'})`);
  if (!fs.existsSync(DIRECTORY_DUMP_PATH)) {
    console.log('No directory dump: cannot tell which notice numbers Miyuki still sells.');
    return;
  }
  const stillListed = noticeNumbersStillListed(entries, classifyDirectoryProducts(readDirectoryDump().products).listings);
  const numbers = new Set(stillListed.map((listing) => listing.split('@')[0]));
  console.log(`Notice numbers the directory dump still lists (marked discontinued all the same): ${numbers.size} numbers, ${stillListed.length} listings${stillListed.length ? `  ${stillListed.join(' ')}` : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
