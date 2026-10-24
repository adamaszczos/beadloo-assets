#!/usr/bin/env tsx
/**
 * Adds the 51 Delica `-1` colours as beads of their own, beside the old numbers (issue #203).
 *
 * Miyuki's official Delica list (`durability.tsv`, 2026-10-08) names `DB106-1` … `DB1538-1` and no
 * longer the plain numbers; Miyuki's directory still sells the plain numbers (`DB106`), with photos and
 * a different finish (Glazed Luster where the list gives Glass Enamel). So the `-1` is a different
 * product, and a beader may hold either. The plain numbers stay as the directory's beads; this script
 * adds each `-1` from the official list with its own photograph, the strand on Miyuki's Delica 11/0
 * sample card N-2, at the cell `pnpm beads:miyuki:sample-cards:locate-delica` placed and a human
 * confirmed (`sources/miyuki/sample-cards/n2-renumbered-cells.csv`).
 *
 * The sidecar's glass group and finish are the official list's, in the directory's vocabulary
 * (`Matte Opaque - Glass Enamel` → Opaque, `Frosted (Matte), Glass enamel`); no colour group, because
 * Miyuki publishes none for these products. The registry row names the list row and the card cell.
 *
 * Then `pnpm beads:miyuki:delica:sync -- --local-only` (thumbnails, colours, metadata).
 * A bead already on disk is left alone (like the other adders); `--rewrite` crops and writes it again.
 * Usage: pnpm beads:miyuki:sample-cards:add-delica [--dry-run] [--rewrite]
 */
import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT, getMiyukiSampleCardsDirectory } from '../../common/lib/paths.js';
import { readDurabilityTsv, type DelicaOfficialRow } from '../common/official-lists.js';
import { attributesFromOfficialFinish } from '../common/official-finish.js';
import { todayIso, writeBeadsAndRegistry, type RegistryRow } from '../common/registry.js';
import { parseCsv } from '../common/csv.js';
import { originalPath, prepareOriginalTarget, sidecarPath, writeSidecar, type Sidecar } from '../common/bead-files.js';
import { parseBox } from './add-card-beads.js';
import { renderCardPage, writeStrandOriginal } from './card-images.js';

const BEAD_TYPE = 'miyuki-delica' as const;
const SIZE = '11';
const DPI = 150;
const CELLS_CSV = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'sample-cards', 'n2-renumbered-cells.csv');
/** Pixels in from a located cell's border before the strand is looked for. */
const CELL_INSET = 3;

export type CellRow = Record<string, string>;

/**
 * The official list's "Glass Type / Finish" in the directory's vocabulary (`attributesFromOfficialFinish`):
 * a leading `Matte` is the directory's `Frosted (Matte)` finish, `AB` its `Rainbow`; finish terms are
 * listed alphabetically, as the directory lists them.
 */
export function officialGlassAndFinish(text: string): { glassGroup: string; finish: string } {
  const { glassGroup, finish } = attributesFromOfficialFinish(text);
  return { glassGroup, finish };
}

export function buildDelicaCardSidecar(row: Pick<DelicaOfficialRow, 'glassTypeFinish'>): Sidecar {
  const { glassGroup, finish } = officialGlassAndFinish(row.glassTypeFinish);
  return {
    shape: 'Delica',
    size: '11/0',
    glassGroup,
    finish,
    dyed: 'Non Dyed',
    galvanized: 'Non-galvanized',
    plating: 'Non-Plating',
    colorAccuracy: 'photo',
  };
}

/** Rows the adder takes: confirmed by eye, with a strand cell. */
export function isConfirmedCell(row: CellRow): boolean {
  return (row.status ?? '').startsWith('confirmed by eye') && Boolean(parseBox(row.bead_cell_px150 ?? ''));
}

export function registryRowFor(row: CellRow, official: Pick<DelicaOfficialRow, 'dbNumber' | 'glassTypeFinish'>, addedOn = todayIso()): RegistryRow {
  const oldNumber = official.dbNumber.replace(/-1$/, '');
  return {
    beadId: row.beadId,
    size: SIZE,
    listingSource: 'durability-tsv',
    imageSource: 'sample-card',
    sizeSource: 'durability-tsv',
    colorAccuracy: 'photo',
    sourceRef: `durability.tsv ${official.dbNumber} "${official.glassTypeFinish}"; image: sample card ${row.card} (${row.pdf}) p.${row.page} bead cell (${row.bead_cell_px150}); the old number ${oldNumber} is a separate bead, which Miyuki's directory still sells`,
    addedOn,
  };
}

async function pageRender(card: string, page: string): Promise<string> {
  const file = getMiyukiSampleCardsDirectory('cells', `${card}-p${page}-${DPI}.png`);
  await renderCardPage(getMiyukiSampleCardsDirectory(`${card}.pdf`), Number(page), DPI, file);
  return file;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const rewrite = process.argv.includes('--rewrite');
  const official = new Map(readDurabilityTsv().map((row) => [row.beadId, row]));
  const rows = parseCsv(fs.readFileSync(CELLS_CSV, 'utf-8')).filter(isConfirmedCell);
  const planned: Array<{ row: CellRow; listRow: DelicaOfficialRow; sidecar: Sidecar }> = [];
  const skipped: string[] = [];
  let onDisk = 0;
  for (const row of rows) {
    const listRow = official.get(row.beadId);
    if (!listRow?.renumbered) { skipped.push(`${row.beadId} (not a -1 colour of the official list)`); continue; }
    if (!rewrite && fs.existsSync(sidecarPath(BEAD_TYPE, SIZE, row.beadId))) { onDisk += 1; continue; }
    planned.push({ row, listRow, sidecar: buildDelicaCardSidecar(listRow) });
  }
  console.log(`Delica -1 colours from card N-2${dryRun ? ' (dry run)' : ''}: ${planned.length}${onDisk ? ` (${onDisk} already on disk, left alone; --rewrite writes them again)` : ''}`);
  if (skipped.length) console.log(`  skipped: ${skipped.join('; ')}`);
  if (dryRun) {
    for (const { row, listRow } of planned.slice(0, 4)) console.log(`  ${row.beadId}: ${registryRowFor(row, listRow).sourceRef}`);
    return;
  }
  await writeBeadsAndRegistry(BEAD_TYPE, planned, async ({ row, listRow, sidecar }) => {
    const target = originalPath(BEAD_TYPE, SIZE, row.beadId);
    prepareOriginalTarget(target);
    await writeStrandOriginal(await pageRender(row.card, row.page), parseBox(row.bead_cell_px150)!, target, CELL_INSET);
    writeSidecar(BEAD_TYPE, SIZE, row.beadId, sidecar);
    return registryRowFor(row, listRow);
  });
  console.log('  originals, sidecars and registry rows written');
  console.log('\nNext: pnpm beads:miyuki:delica:sync -- --local-only');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nadd-delica-card-beads failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
