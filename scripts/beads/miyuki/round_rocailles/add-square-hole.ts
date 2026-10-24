#!/usr/bin/env tsx
/**
 * Adds the square-hole round rocailles Miyuki's old/new colour table names and no card or
 * catalogue pictures (issue #203 Phase 5, batch c), from the reviewed
 * `sources/miyuki/batches/c-older-square-hole.csv`: only rows whose proposal is the approved one.
 *
 * Decision (2026-10-17): the colour is approximate, taken from the round-hole bead of the same
 * number at the size the table's `Square Hole Round <size>/0` section states. The bead's original
 * is a copy of the round-hole bead's original, its sidecar the round-hole bead's with
 * `hole: Square Hole` and `colorAccuracy: approximate`; the registry row says so, sources
 * `color-change-tsv` (listing and size) and `round-hole-sibling` (image). The old numbers become
 * search aliases through `pnpm beads:miyuki:aliases`, which the sync runs. A square-hole colour
 * without a round-hole sibling stays held.
 *
 * Then `pnpm beads:miyuki:round_rocailles:sync -- --local-only`.
 * Usage: pnpm beads:miyuki:round_rocailles:add-square-hole [--dry-run] [--only 10SH,12SH]
 */
import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT, getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from '../../common/lib/paths.js';
import { readRegistry, todayIso, upsertRegistryRows, writeRegistry, type RegistryRow } from '../common/registry.js';
import { parseCsv } from '../common/csv.js';
import { readSidecar, type Sidecar } from '../common/bead-files.js';

const BEAD_TYPE = 'miyuki-round_rocailles' as const;
const BATCH = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'batches', 'c-older-square-hole.csv');
const APPROVED_PROPOSAL = /^add with colorAccuracy approximate/;

export type BatchRow = Record<string, string>;

/** The rows the adder takes: approved proposal, not yet on disk. */
export function isApprovedRow(row: BatchRow): boolean {
  return APPROVED_PROPOSAL.test(row.proposal ?? '') && row.on_disk !== 'yes' && /SH$/i.test(row.official_id ?? '');
}

/** The sidecar of a square-hole colour from its round-hole sibling's: same attributes, the hole and the accuracy added. */
export function squareHoleSidecar(sibling: Sidecar): Sidecar {
  const { hole: _hole, colorAccuracy: _accuracy, formerly: _formerly, ...rest } = sibling;
  void _hole; void _accuracy; void _formerly;
  return { ...rest, hole: 'Square Hole', colorAccuracy: 'approximate' };
}

export function registryRowFor(row: BatchRow, base: string, addedOn = todayIso()): RegistryRow {
  return {
    beadId: row.official_id.toUpperCase(),
    size: row.size,
    listingSource: 'color-change-tsv',
    imageSource: 'round-hole-sibling',
    sizeSource: 'color-change-tsv',
    colorAccuracy: 'approximate',
    sourceRef: `color_change.tsv "Square Hole Round ${row.size}/0" (old numbers ${row.old_numbers}); image and attributes: the round-hole bead ${base} at ${row.size}/0 (approximate: no official image of the square-hole colour, decision of 2026-10-17)`,
    addedOn,
  };
}

function originalOf(size: string, beadId: string): string | null {
  const dir = getDownloadedBeadTypeDirectory(BEAD_TYPE, size);
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const file = path.join(dir, `${beadId}${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const onlyIndex = argv.indexOf('--only');
  const only = onlyIndex >= 0 && argv[onlyIndex + 1] ? new Set(argv[onlyIndex + 1].split(',').map((v) => v.trim().toUpperCase())) : null;

  const rows = parseCsv(fs.readFileSync(BATCH, 'utf-8'));
  const added: Array<{ row: BatchRow; base: string; original: string; sidecar: Sidecar }> = [];
  const skipped = new Map<string, string[]>();
  const skip = (reason: string, id: string) => (skipped.get(reason) ?? skipped.set(reason, []).get(reason)!).push(id);
  for (const row of rows) {
    if (!isApprovedRow(row)) continue;
    const beadId = row.official_id.toUpperCase();
    if (only && !only.has(beadId)) continue;
    const base = beadId.slice(0, -'SH'.length);
    if (readSidecar(BEAD_TYPE, row.size, beadId)) { skip('already on disk', `${beadId}@${row.size}`); continue; }
    const sibling = readSidecar(BEAD_TYPE, row.size, base);
    const original = originalOf(row.size, base);
    if (!sibling || !original) { skip('no round-hole sibling with an original and a sidecar', `${beadId}@${row.size}`); continue; }
    added.push({ row, base, original, sidecar: squareHoleSidecar(sibling) });
  }
  console.log(`Square-hole beads to add${dryRun ? ' (dry run)' : ''}: ${added.length}`);
  for (const size of Array.from(new Set(added.map((e) => e.row.size))).sort((a, b) => Number(a) - Number(b))) {
    const atSize = added.filter((e) => e.row.size === size);
    console.log(`  ${size}/0: ${atSize.length}  ${atSize.map((e) => e.row.official_id).join(' ')}`);
  }
  for (const [reason, ids] of skipped) console.log(`  skipped (${reason}): ${ids.length} ${ids.slice(0, 10).join(' ')}${ids.length > 10 ? ' …' : ''}`);
  if (dryRun) return;

  const registryRows: RegistryRow[] = [];
  for (const entry of added) {
    const beadId = entry.row.official_id.toUpperCase();
    const target = path.join(getDownloadedBeadTypeDirectory(BEAD_TYPE, entry.row.size), `${beadId}${path.extname(entry.original)}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(entry.original, target);
    const beadDir = getBeadTypeDirectory(BEAD_TYPE, entry.row.size);
    fs.writeFileSync(path.join(beadDir, `${beadId}.metadata.json`), `${JSON.stringify(entry.sidecar, null, 2)}\n`, 'utf-8');
    registryRows.push(registryRowFor(entry.row, entry.base));
  }
  const { rows: merged, added: addedRows } = upsertRegistryRows(readRegistry(BEAD_TYPE), registryRows);
  writeRegistry(BEAD_TYPE, merged);
  console.log(`  wrote ${added.length} originals + sidecars, ${addedRows} registry rows`);
  console.log('\nNext: pnpm beads:miyuki:round_rocailles:sync -- --local-only (thumbnails, colours, metadata, aliases).');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nadd-square-hole failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
