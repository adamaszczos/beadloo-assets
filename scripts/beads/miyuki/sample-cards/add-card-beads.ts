#!/usr/bin/env tsx
/**
 * Adds the round-rocaille colours Miyuki's sample cards show and Beadloo lacks (issue #203 Phase 5,
 * batch b), from the reviewed `sources/miyuki/batches/b-sample-cards.csv`: only rows confirmed by
 * eye with a bead cell located on the page, at the size the row records (card 867/R states four
 * sizes for its article, so its colours go in at all four; the black cover prints none and takes
 * the card list's 11/0).
 *
 * - image: the bead-photo cell cropped from the card's page render (Miyuki's photograph of the
 *   beads, scanned), kept as the original under `downloaded/miyuki/round_rocailles/<size>/<id>.jpg`,
 *   colour accuracy `photo`, registry source `sample-card`;
 * - metadata: the same number's directory sidecar at another size (colour group included), else the
 *   card's section heading through `sources/miyuki/sample-cards/sample-card-sections.csv`
 *   (each heading mapped to a catalogue heading, whose evidence is the directory beads under it);
 *   a square-hole colour carries `hole: Square Hole`;
 * - a registry row names the card, page, cell, section, what the card states as the size, and the
 *   metadata source.
 *
 * Then `pnpm beads:miyuki:round_rocailles:sync -- --local-only` for thumbnails, colours, metadata, aliases.
 * Usage: pnpm beads:miyuki:sample-cards:add [--dry-run] [--only 1603,3271SH]
 */
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { ASSET_REPO_ROOT, getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from '../../common/lib/paths.js';
import { readRegistry, registryKey, todayIso, upsertRegistryRows, writeRegistry, type RegistryRow } from '../common/registry.js';
import { chooseMetadataDonor, DONOR_SIZES, type Sidecar } from '../catalogue/add-round-rocaille-beads.js';
import { parseCsv } from '../common/csv.js';

const BEAD_TYPE = 'miyuki-round_rocailles' as const;
const BATCH = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'batches', 'b-sample-cards.csv');
const SECTIONS = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'sample-cards', 'sample-card-sections.csv');
const CELLS = path.join(ASSET_REPO_ROOT, 'downloaded', 'miyuki', 'sample-cards', 'cells');
/** Card 867/R prints four sizes for its article as a whole. */
const FOUR_SIZE_CARD = '867/R';
const FOUR_SIZES = ['15', '11', '8', '6'];

export type BatchRow = Record<string, string>;
export type SectionMapping = { catalogue_heading: string; glassGroup: string; finish: string; dyed: string; galvanized: string; plating: string; evidence: string };
export type Rect = { x: number; y: number; w: number; h: number };

/** Compact sizes a row goes in at: 867/R all four, otherwise the one its `card_size` names. */
export function sizesForRow(row: Record<string, string>): string[] {
  if (row.card === FOUR_SIZE_CARD) return FOUR_SIZES;
  const match = /(\d+)\/0/.exec(row.card_size ?? '');
  return match ? [match[1]] : [];
}

export function parseBox(text: string): Rect | null {
  const parts = text.split(',').map(Number);
  return parts.length === 4 && parts.every((n) => Number.isFinite(n) && n >= 0) ? { x: parts[0], y: parts[1], w: parts[2], h: parts[3] } : null;
}

/** Rows the adder takes: confirmed by eye, not excluded, with a bead cell located. */
export function isReadyRow(row: BatchRow): boolean {
  return row.status.startsWith('confirmed by eye') && !row.status.startsWith('EXCLUDED') && Boolean(parseBox(row.bead_cell_px150)) && Boolean(row.page);
}

export function buildCardSidecar(size: string, source: Sidecar, options: { squareHole: boolean; keepColorGroup: boolean }): Sidecar {
  return {
    shape: 'Round Rocailles',
    size: `${size}/0`,
    ...(options.keepColorGroup && source.colorGroup ? { colorGroup: source.colorGroup } : {}),
    glassGroup: source.glassGroup,
    finish: source.finish || 'Not Specified',
    dyed: source.dyed,
    galvanized: source.galvanized,
    plating: source.plating,
    ...(options.squareHole ? { hole: 'Square Hole' } : {}),
    colorAccuracy: 'photo',
  };
}

function readSidecar(size: string, beadId: string): Sidecar | null {
  const file = path.join(getBeadTypeDirectory(BEAD_TYPE, size), `${beadId}.metadata.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf-8')) as Sidecar) : null;
}

type Resolved = { beadId: string; size: string; row: BatchRow; sidecar: Sidecar; metadataSource: string; render: string; bead: Rect };

export function resolveCardBead(
  row: BatchRow,
  size: string,
  lookup: { sidecar: (beadId: string, size: string) => Sidecar | null; sections: ReadonlyMap<string, SectionMapping>; renderExists: (render: string) => boolean },
): Resolved | { beadId: string; size: string; skip: string } {
  // The number as the card prints it: a card photographs that product (a `-1` colour is another one).
  const beadId = row.colour_no.trim().toUpperCase();
  if (lookup.sidecar(beadId, size)) return { beadId, size, skip: 'already on disk' };
  const bead = parseBox(row.bead_cell_px150)!;
  const render = path.join(CELLS, `${row.pdf.replace(/\.pdf$/, '')}-p${row.page}-150.png`);
  if (!lookup.renderExists(render)) return { beadId, size, skip: `no page render ${path.relative(ASSET_REPO_ROOT, render)}` };
  const donor = chooseMetadataDonor(beadId, size, null, lookup);
  const section = lookup.sections.get(row.card_section.trim());
  if (!donor && !section?.catalogue_heading) return { beadId, size, skip: `no official metadata source (section "${row.card_section}" unmapped)` };
  const sidecar = buildCardSidecar(size, donor ? donor.sidecar : section!, { squareHole: beadId.endsWith('SH'), keepColorGroup: Boolean(donor) });
  const metadataSource = donor ? donor.source : `card section "${row.card_section}" → ${section!.evidence}`;
  return { beadId, size, row, sidecar, metadataSource, render, bead };
}

export function registryRowFor(entry: Resolved, addedOn = todayIso()): RegistryRow {
  return {
    beadId: entry.beadId,
    size: entry.size,
    listingSource: 'sample-card',
    imageSource: 'sample-card',
    sizeSource: 'sample-card',
    colorAccuracy: 'photo',
    sourceRef: `sample card ${entry.row.card} (${entry.row.pdf}) p.${entry.row.page} bead cell (${entry.row.bead_cell_px150}) "${entry.row.card_section}"; size: ${entry.row.card_states_size}; metadata: ${entry.metadataSource}`,
    addedOn,
  };
}

/**
 * The strand inside a bead cell: the bounding box of the pixels darker than the card (the beads and
 * their wire), with a margin. The thumbnail generator crops the centre square of the original, so a
 * short strand sitting at the left of a wide cell would otherwise give an empty thumbnail.
 */
export function strandBox(pixels: Uint8Array, width: number, height: number, margin = 6): Rect {
  const dark = (x: number, y: number) => {
    const i = (y * width + x) * 3;
    return Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 190;
  };
  // A cell border or the card's frame is a dark line spanning the cell: leave those columns and rows out.
  const columnCount = new Array<number>(width).fill(0);
  const rowCount = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (dark(x, y)) { columnCount[x]++; rowCount[y]++; }
  const lineColumn = columnCount.map((n) => n >= height * 0.8);
  const lineRow = rowCount.map((n) => n >= width * 0.8);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    if (lineRow[y]) continue;
    for (let x = 0; x < width; x++) {
      if (lineColumn[x] || !dark(x, y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 - x0 < 20 || y1 - y0 < 3) return { x: 0, y: 0, w: width, h: height };
  return { x: Math.max(0, x0 - margin), y: Math.max(0, y0 - margin), w: Math.min(width, x1 + margin + 1) - Math.max(0, x0 - margin), h: Math.min(height, y1 + margin + 1) - Math.max(0, y0 - margin) };
}

async function writeOriginal(entry: Resolved): Promise<void> {
  const target = path.join(getDownloadedBeadTypeDirectory(BEAD_TYPE, entry.size), `${entry.beadId}.jpg`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const meta = await sharp(entry.render).metadata();
  const inset = 3;
  const region = {
    left: Math.max(0, entry.bead.x + inset),
    top: Math.max(0, entry.bead.y + inset),
    width: Math.max(1, Math.min(entry.bead.w - 2 * inset, (meta.width ?? 0) - entry.bead.x - inset)),
    height: Math.max(1, Math.min(entry.bead.h - 2 * inset, (meta.height ?? 0) - entry.bead.y - inset)),
  };
  const cell = sharp(entry.render).extract(region);
  const { data, info } = await cell.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const strand = strandBox(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
  await cell.extract({ left: strand.x, top: strand.y, width: strand.w, height: strand.h }).jpeg({ quality: 92 }).toFile(target);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  // --rewrite-images: write the originals again for every ready row (sidecars and registry untouched).
  const rewriteImages = argv.includes('--rewrite-images');
  const onlyIndex = argv.indexOf('--only');
  const only = onlyIndex >= 0 && argv[onlyIndex + 1] ? new Set(argv[onlyIndex + 1].split(',').map((v) => v.trim().toUpperCase())) : null;

  const rows = parseCsv(fs.readFileSync(BATCH, 'utf-8'));
  const sections = new Map(parseCsv(fs.readFileSync(SECTIONS, 'utf-8')).map((r) => [r.card_section, r as unknown as SectionMapping]));
  const lookup = { sidecar: (beadId: string, size: string) => (rewriteImages ? null : readSidecar(size, beadId)), sections, renderExists: (render: string) => fs.existsSync(render) };

  const added: Resolved[] = [];
  const skipped = new Map<string, string[]>();
  const notReady: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.status.startsWith('EXCLUDED')) continue;
    if (!isReadyRow(row)) { if (row.status.startsWith('confirmed by eye')) notReady.push(`${row.colour_no} (${row.card})`); continue; }
    for (const size of sizesForRow(row)) {
      const resolved = resolveCardBead(row, size, lookup);
      if (only && !only.has(resolved.beadId)) continue;
      const key = `${size}:${resolved.beadId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if ('skip' in resolved) {
        if (resolved.skip !== 'already on disk') (skipped.get(resolved.skip) ?? skipped.set(resolved.skip, []).get(resolved.skip)!).push(`${resolved.beadId}@${size}`);
        continue;
      }
      added.push(resolved);
    }
  }
  console.log(`Sample-card beads to add${dryRun ? ' (dry run)' : ''}: ${added.length}`);
  for (const size of Array.from(new Set(added.map((e) => e.size))).sort((a, b) => Number(a) - Number(b))) {
    const atSize = added.filter((e) => e.size === size);
    console.log(`  ${size}/0: ${atSize.length} (metadata from another size ${atSize.filter((e) => e.metadataSource.startsWith('official')).length}, from the card section ${atSize.filter((e) => e.metadataSource.startsWith('card section')).length}; square hole ${atSize.filter((e) => e.beadId.endsWith('SH')).length})`);
  }
  for (const [reason, ids] of skipped) console.log(`  skipped (${reason}): ${ids.length} ${ids.slice(0, 8).join(' ')}${ids.length > 8 ? ' …' : ''}`);
  if (notReady.length) console.log(`  confirmed rows without a located bead cell (not added): ${notReady.length} ${notReady.slice(0, 10).join(' ')}${notReady.length > 10 ? ' …' : ''}`);
  if (dryRun) {
    for (const e of added.slice(0, 6)) console.log(`  ${e.beadId} (${e.size}/0) ← ${path.basename(e.render)} cell ${e.row.bead_cell_px150}; ${e.metadataSource}`);
    return;
  }
  if (rewriteImages) {
    for (const entry of added) await writeOriginal(entry);
    console.log(`  rewrote ${added.length} originals (sidecars and registry untouched)`);
    console.log('\nNext: pnpm beads:miyuki:round_rocailles:sync -- --local-only (the newer originals get fresh thumbnails and colours).');
    return;
  }
  const registryRows: RegistryRow[] = [];
  for (const entry of added) {
    await writeOriginal(entry);
    const beadDir = getBeadTypeDirectory(BEAD_TYPE, entry.size);
    fs.mkdirSync(beadDir, { recursive: true });
    fs.writeFileSync(path.join(beadDir, `${entry.beadId}.metadata.json`), `${JSON.stringify(entry.sidecar, null, 2)}\n`, 'utf-8');
    registryRows.push(registryRowFor(entry));
  }
  const { rows: merged, added: addedRows } = upsertRegistryRows(readRegistry(BEAD_TYPE), registryRows);
  writeRegistry(BEAD_TYPE, merged);
  console.log(`  wrote ${added.length} originals + sidecars, ${addedRows} registry rows`);
  console.log('\nNext: pnpm beads:miyuki:round_rocailles:sync -- --local-only (thumbnails, colours, metadata, aliases).');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nadd-card-beads failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
