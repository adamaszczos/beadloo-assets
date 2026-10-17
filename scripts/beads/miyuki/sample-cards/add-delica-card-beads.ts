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
import sharp from 'sharp';
import { ASSET_REPO_ROOT, getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from '../../common/lib/paths.js';
import { CataloguePdf } from '../catalogue/lib/pdf.js';
import { readDurabilityTsv, type DelicaOfficialRow } from '../common/official-lists.js';
import { readRegistry, todayIso, upsertRegistryRows, writeRegistry, type RegistryRow } from '../common/registry.js';
import { parseCsv } from '../common/csv.js';
import { parseBox, strandBox } from './add-card-beads.js';
import type { Rect } from './read-cards.js';

const BEAD_TYPE = 'miyuki-delica' as const;
const SIZE = '11';
const DPI = 150;
const CELLS_CSV = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'sample-cards', 'n2-renumbered-cells.csv');
const CARDS_DIR = path.join(ASSET_REPO_ROOT, 'downloaded', 'miyuki', 'sample-cards');
const RENDERS_DIR = path.join(CARDS_DIR, 'cells');

export type Sidecar = Record<string, string>;
export type CellRow = Record<string, string>;

/**
 * The official list's "Glass Type / Finish" in the directory's vocabulary. A leading `Matte` is the
 * directory's `Frosted (Matte)` finish, `AB` its `Rainbow`; finish terms are listed alphabetically,
 * as the directory lists them.
 */
export function officialGlassAndFinish(text: string): { glassGroup: string; finish: string } {
  const parts = text.split('-').map((part) => part.trim()).filter(Boolean);
  let glass = parts[0] ?? '';
  const finishes: string[] = [];
  if (/^matte\s+/i.test(glass)) {
    finishes.push('Frosted (Matte)');
    glass = glass.replace(/^matte\s+/i, '');
  }
  for (const part of parts.slice(1)) {
    if (/^glass enamel$/i.test(part)) finishes.push('Glass enamel');
    else if (/^ab$/i.test(part)) finishes.push('Rainbow');
    else if (/^luster$/i.test(part)) finishes.push('Luster');
    else throw new Error(`unknown finish "${part}" in "${text}"`);
  }
  if (!/^(Opaque|Transparent|Silk|Alabaster)$/i.test(glass)) throw new Error(`unknown glass type "${glass}" in "${text}"`);
  const glassGroup = glass[0].toUpperCase() + glass.slice(1).toLowerCase();
  return { glassGroup, finish: finishes.sort((a, b) => a.localeCompare(b, 'en')).join(', ') };
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
  const file = path.join(RENDERS_DIR, `${card}-p${page}-${DPI}.png`);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(RENDERS_DIR, { recursive: true });
  const pdf = await CataloguePdf.open(path.join(CARDS_DIR, `${card}.pdf`));
  const img = pdf.renderPage(Number(page), DPI);
  pdf.destroy();
  await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } }).png().toFile(file);
  return file;
}

async function writeOriginal(render: string, bead: Rect, target: string): Promise<void> {
  const inset = 3;
  const meta = await sharp(render).metadata();
  const region = {
    left: Math.max(0, bead.x + inset),
    top: Math.max(0, bead.y + inset),
    width: Math.max(1, Math.min(bead.w - 2 * inset, (meta.width ?? 0) - bead.x - inset)),
    height: Math.max(1, Math.min(bead.h - 2 * inset, (meta.height ?? 0) - bead.y - inset)),
  };
  const cell = sharp(render).extract(region);
  const { data, info } = await cell.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const strand = strandBox(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await cell.extract({ left: strand.x, top: strand.y, width: strand.w, height: strand.h }).jpeg({ quality: 92 }).toFile(target);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const rewrite = process.argv.includes('--rewrite');
  const official = new Map(readDurabilityTsv().map((row) => [row.beadId, row]));
  const rows = parseCsv(fs.readFileSync(CELLS_CSV, 'utf-8')).filter(isConfirmedCell);
  const registryRows: RegistryRow[] = [];
  const skipped: string[] = [];
  let onDisk = 0;
  for (const row of rows) {
    const listRow = official.get(row.beadId);
    if (!listRow?.renumbered) { skipped.push(`${row.beadId} (not a -1 colour of the official list)`); continue; }
    if (!rewrite && fs.existsSync(path.join(getBeadTypeDirectory(BEAD_TYPE, SIZE), `${row.beadId}.metadata.json`))) { onDisk += 1; continue; }
    const sidecar = buildDelicaCardSidecar(listRow);
    registryRows.push(registryRowFor(row, listRow));
    if (dryRun) continue;
    const render = await pageRender(row.card, row.page);
    await writeOriginal(render, parseBox(row.bead_cell_px150)!, path.join(getDownloadedBeadTypeDirectory(BEAD_TYPE, SIZE), `${row.beadId}.jpg`));
    fs.writeFileSync(path.join(getBeadTypeDirectory(BEAD_TYPE, SIZE), `${row.beadId}.metadata.json`), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf-8');
  }
  console.log(`Delica -1 colours from card N-2${dryRun ? ' (dry run)' : ''}: ${registryRows.length}${onDisk ? ` (${onDisk} already on disk, left alone; --rewrite writes them again)` : ''}`);
  if (skipped.length) console.log(`  skipped: ${skipped.join('; ')}`);
  if (dryRun) {
    for (const r of registryRows.slice(0, 4)) console.log(`  ${r.beadId}: ${r.sourceRef}`);
    return;
  }
  const { rows: merged } = upsertRegistryRows(readRegistry(BEAD_TYPE), registryRows);
  writeRegistry(BEAD_TYPE, merged);
  console.log('  originals, sidecars and registry rows written');
  console.log('\nNext: pnpm beads:miyuki:delica:sync -- --local-only');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nadd-delica-card-beads failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
