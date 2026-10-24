#!/usr/bin/env tsx
/**
 * Adds the lead-free Glass Enamel round rocailles of Miyuki's sample card TE-64 (issue #203, batch e).
 *
 * Miyuki's notice of 2023-07-03 (`sources/miyuki/official/glass-enamel-discontinued-2023-07-03.tsv`)
 * discontinued its leaded glass-enamel colours and named a lead-free `-1` alternative for some; card
 * TE-64 photographs the round-rocaille alternatives and gives the line's sizes, 15/0 11/0 8/0 6/0.
 * Both survive only in the Internet Archive (`sources/miyuki/sample-cards/archived-cards.csv`, which
 * also records the PDF's SHA-256; the run stops on a PDF with other bytes or a card row without its URL).
 *
 * - sizes: the card's four, for every colour (the card shows one strand per colour and the article's
 *   sizes once, as card 867/R does; the 867/R precedent adds a colour at every size its card states);
 * - image: the colour's strand cell (`sources/miyuki/sample-cards/te-64-cells.csv`, at 300 dpi) cropped
 *   to the strand, the same original at all four sizes; colour accuracy `photo`;
 * - metadata: the Delica list's phrase for the colour as a seed twin (`2479-1` ← DB268-1 "Opaque - Glass
 *   Enamel - Luster"), read with `attributesFromOfficialFinish`; for a colour the list does not name, the
 *   row of `sources/miyuki/sample-cards/te-64-metadata.csv` with its evidence (a row for a colour the
 *   list names is reported and ignored: the list is Miyuki's own word);
 * - a registry row names the card, the cell, the sizes' source and the metadata source.
 *
 * Then `pnpm beads:miyuki:round_rocailles:sync -- --local-only`.
 * Usage: pnpm beads:miyuki:sample-cards:add-glass-enamel [--dry-run]
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT, getMiyukiSampleCardsDirectory } from '../../common/lib/paths.js';
import { readRegistry, registryKey, todayIso, writeBeadsAndRegistry, type RegistryRow } from '../common/registry.js';
import { parseCsv } from '../common/csv.js';
import { readDurabilityTsv } from '../common/official-lists.js';
import { attributesFromOfficialFinish } from '../common/official-finish.js';
import { isInLibrary, originalPath, prepareOriginalTarget, writeSidecar, type Sidecar } from '../common/bead-files.js';
import { buildCardSidecar, parseBox, type Rect } from './add-card-beads.js';
import { renderCardPage, writeStrandOriginal } from './card-images.js';

const BEAD_TYPE = 'miyuki-round_rocailles' as const;
const CARD = 'TE-64';
const SIZES = ['15', '11', '8', '6'];
const DPI = 300;
const PDF = getMiyukiSampleCardsDirectory('archived', `${CARD}.pdf`);
const RENDER = getMiyukiSampleCardsDirectory('cells', `${CARD}-p1-${DPI}.png`);
const CELLS = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'sample-cards', 'te-64-cells.csv');
const METADATA = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'sample-cards', 'te-64-metadata.csv');
const ARCHIVED = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'sample-cards', 'archived-cards.csv');
/** TE-64's strand cells are located inside the table lines, so the crop starts at the cell's edge. */
const CELL_INSET = 0;

const ATTRIBUTES = ['glassGroup', 'finish', 'dyed', 'galvanized', 'plating'] as const;
export type GlassEnamelOverride = Record<(typeof ATTRIBUTES)[number] | 'evidence', string>;

/** The reviewed rows of `te-64-metadata.csv` by colour; throws on a blank attribute or evidence. */
export function parseGlassEnamelOverrides(rows: ReadonlyArray<Record<string, string>>): Map<string, GlassEnamelOverride> {
  const overrides = new Map<string, GlassEnamelOverride>();
  for (const row of rows) {
    const colourNo = (row.colour_no ?? '').trim().toUpperCase();
    const blank = [...ATTRIBUTES, 'evidence' as const].find((column) => !(row[column] ?? '').trim());
    if (!colourNo || blank) throw new Error(`te-64-metadata.csv: ${colourNo || 'a row'} has no ${colourNo ? blank : 'colour_no'}`);
    const value = (column: keyof GlassEnamelOverride) => row[column].trim();
    overrides.set(colourNo, { glassGroup: value('glassGroup'), finish: value('finish'), dyed: value('dyed'), galvanized: value('galvanized'), plating: value('plating'), evidence: value('evidence') });
  }
  return overrides;
}

/** The card's row in `archived-cards.csv`; throws when it is missing or lacks the archived URL or the SHA-256. */
export function archivedCard(rows: ReadonlyArray<Record<string, string>>, card: string): { url: string; sha256: string } {
  const row = rows.find((r) => r.card === card);
  const url = (row?.archived_url ?? '').trim();
  const sha256 = (row?.sha256 ?? '').trim().toLowerCase();
  if (!url || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`archived-cards.csv: ${card} needs its archived_url and sha256`);
  return { url, sha256 };
}

export type PlannedGlassEnamelBead = { beadId: string; size: string; strand: Rect; sidecar: Sidecar; metadataSource: string };

export function planGlassEnamelBeads(
  cells: ReadonlyArray<Record<string, string>>,
  phraseOf: (seed: string) => { dbNumber: string; phrase: string } | null,
  overrides: ReadonlyMap<string, GlassEnamelOverride>,
  inLibrary: (beadId: string, size: string) => boolean,
): { planned: PlannedGlassEnamelBead[]; skipped: string[]; ignoredOverrides: string[] } {
  const planned: PlannedGlassEnamelBead[] = [];
  const skipped: string[] = [];
  const ignoredOverrides: string[] = [];
  for (const cell of cells) {
    const beadId = (cell.colour_no ?? '').trim().toUpperCase();
    const strand = parseBox(cell.strand_cell_px300 ?? '');
    if (!strand || !(cell.status ?? '').startsWith('confirmed by eye')) { skipped.push(`${beadId} (no confirmed cell)`); continue; }
    const twin = phraseOf(beadId);
    const override = overrides.get(beadId);
    let attributes: Sidecar;
    let metadataSource: string;
    if (twin) {
      if (override) ignoredOverrides.push(`${beadId} (Miyuki's Delica list names it: ${twin.dbNumber} "${twin.phrase}")`);
      attributes = attributesFromOfficialFinish(twin.phrase);
      metadataSource = `Miyuki's Delica list: seed twin of ${twin.dbNumber}, "${twin.phrase}"`;
    } else if (override) {
      attributes = override;
      metadataSource = override.evidence;
    } else {
      skipped.push(`${beadId} (no metadata source)`);
      continue;
    }
    for (const size of SIZES) {
      if (inLibrary(beadId, size)) continue;
      planned.push({ beadId, size, strand, sidecar: buildCardSidecar(size, attributes, { squareHole: false, keepColorGroup: false, colorAccuracy: 'photo' }), metadataSource });
    }
  }
  return { planned, skipped, ignoredOverrides };
}

export function glassEnamelRegistryRow(entry: PlannedGlassEnamelBead, archivedUrl: string, addedOn = todayIso()): RegistryRow {
  const { x, y, w, h } = entry.strand;
  return {
    beadId: entry.beadId,
    size: entry.size,
    listingSource: 'sample-card',
    imageSource: 'sample-card',
    sizeSource: 'sample-card',
    colorAccuracy: 'photo',
    sourceRef: `sample card ${CARD} (archived: ${archivedUrl}) strand cell (${x},${y},${w},${h}) at ${DPI} dpi "Glass Enamel lead free / Round Rocailles"; size: the card's article sizes 15/0 11/0 8/0 6/0 (one strand per colour); lead-free alternative named by Miyuki's notice of 2023-07-03; metadata: ${entry.metadataSource}`,
    addedOn,
  };
}

/** The archived PDF is the evidence: a file with other bytes than the recorded ones is not cropped. */
function verifyPdf(sha256: string): void {
  if (!fs.existsSync(PDF)) throw new Error(`no ${path.relative(ASSET_REPO_ROOT, PDF)}; download it from archived-cards.csv`);
  const actual = createHash('sha256').update(fs.readFileSync(PDF)).digest('hex');
  if (actual !== sha256) throw new Error(`${path.relative(ASSET_REPO_ROOT, PDF)}: sha256 ${actual} is not the recorded ${sha256}`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const registry = new Map(readRegistry(BEAD_TYPE).map((row) => [registryKey(row.beadId, row.size), row]));
  const cells = parseCsv(fs.readFileSync(CELLS, 'utf-8'));
  const overrides = parseGlassEnamelOverrides(parseCsv(fs.readFileSync(METADATA, 'utf-8')));
  const twins = new Map(readDurabilityTsv().filter((row) => row.seedNumber.endsWith('-1')).map((row) => [row.seedNumber.toUpperCase(), { dbNumber: row.dbNumber, phrase: row.glassTypeFinish }]));
  const card = archivedCard(parseCsv(fs.readFileSync(ARCHIVED, 'utf-8')), CARD);
  const { planned, skipped, ignoredOverrides } = planGlassEnamelBeads(cells, (seed) => twins.get(seed) ?? null, overrides, (beadId, size) => isInLibrary(BEAD_TYPE, size, beadId, registry));
  console.log(`${CARD} glass-enamel beads to add${dryRun ? ' (dry run)' : ''}: ${planned.length} (${new Set(planned.map((p) => p.beadId)).size} colours × ${SIZES.join('/')})`);
  for (const id of Array.from(new Set(planned.map((p) => p.beadId)))) {
    const first = planned.find((p) => p.beadId === id)!;
    console.log(`  ${id}: ${first.sidecar.glassGroup} / ${first.sidecar.finish} ← ${first.metadataSource.slice(0, 90)}`);
  }
  if (skipped.length) console.log(`  skipped: ${skipped.join(', ')}`);
  if (ignoredOverrides.length) console.log(`  te-64-metadata.csv rows ignored: ${ignoredOverrides.join(', ')}`);
  if (planned.length === 0) return;
  verifyPdf(card.sha256);
  if (dryRun) return;
  await renderCardPage(PDF, 1, DPI, RENDER);
  const added = await writeBeadsAndRegistry(BEAD_TYPE, planned, async (entry) => {
    const target = originalPath(BEAD_TYPE, entry.size, entry.beadId);
    prepareOriginalTarget(target);
    await writeStrandOriginal(RENDER, entry.strand, target, CELL_INSET);
    writeSidecar(BEAD_TYPE, entry.size, entry.beadId, entry.sidecar);
    return glassEnamelRegistryRow(entry, card.url);
  });
  console.log(`  wrote ${planned.length} originals + sidecars, ${added} registry rows`);
  console.log('\nNext: pnpm beads:miyuki:round_rocailles:sync -- --local-only');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nadd-glass-enamel-card failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
