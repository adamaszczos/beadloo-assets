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
 * - metadata, the first of: the same number's directory sidecar at another size (colour group
 *   included), then for a square-hole colour the round-hole bead of the same number; the number's
 *   reviewed decision in `sources/miyuki/round-rocaille-attributes.csv` (cards whose headings span
 *   several finishes); the glass and finish Miyuki's Delica list gives the number as a seed twin,
 *   unless a directory twin read the same way disagrees (batch e); the same number's sidecar at
 *   another size from any other official source, then the round-hole bead's for a square-hole colour;
 *   the card's section heading through `sources/miyuki/sample-cards/sample-card-sections.csv` (each
 *   heading mapped to a catalogue heading, whose evidence is the directory beads under it); a
 *   square-hole colour carries `hole: Square Hole`;
 * - a registry row names the card, page, cell, section, what the card states as the size, and the
 *   metadata source.
 *
 * A bead counts as present once it has its sidecar and its registry row; one with only one of them
 * (a run that stopped half way) is written again, and its registry row is saved with it.
 *
 * Then `pnpm beads:miyuki:round_rocailles:sync -- --local-only` for thumbnails, colours, metadata, aliases.
 * Usage: pnpm beads:miyuki:sample-cards:add [--batch sources/miyuki/batches/e-mud-cover-15-0.csv] [--dry-run]
 *          [--only 1603,3271SH] [--plan plan.csv (implies --dry-run)] [--rewrite-images]
 */
import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT, getMiyukiSampleCardsDirectory } from '../../common/lib/paths.js';
import { COLOR_ACCURACIES, readRegistry, registryKey, todayIso, writeBeadsAndRegistry, type ColorAccuracy, type RegistryRow } from '../common/registry.js';
import { chooseMetadataDonor, DONOR_SIZES } from '../catalogue/add-round-rocaille-beads.js';
import { formatCsv, parseCsv } from '../common/csv.js';
import { readDurabilityTsv } from '../common/official-lists.js';
import { attributesFromOfficialFinish, OfficialFinishError, type OfficialAttributes } from '../common/official-finish.js';
import { ATTRIBUTE_DECISIONS_PATH, parseAttributeDecisions, type AttributeDecision } from '../common/attribute-decisions.js';
import { originalPath, prepareOriginalTarget, readSidecar, writeSidecar, type Sidecar } from '../common/bead-files.js';
import { writeStrandOriginal } from './card-images.js';

const BEAD_TYPE = 'miyuki-round_rocailles' as const;
const DEFAULT_BATCH = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'batches', 'b-sample-cards.csv');
const SECTIONS = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'sample-cards', 'sample-card-sections.csv');
const CELLS = getMiyukiSampleCardsDirectory('cells');
/** Card 867/R prints four sizes for its article as a whole. */
const FOUR_SIZE_CARD = '867/R';
const FOUR_SIZES = ['15', '11', '8', '6'];
/** Pixels in from a located cell's border before the strand is looked for. */
const CELL_INSET = 3;
const ATTRIBUTE_COLUMNS = ['glassGroup', 'finish', 'dyed', 'galvanized', 'plating'] as const;

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

/**
 * A row's colour accuracy: `photo` unless the row says otherwise, as for a card that warns its strand
 * shows another size's colour (TE-58: "the size 15/0 appears brighter and the size 8/0 darker than 11/0").
 */
export function rowColorAccuracy(row: { color_accuracy?: string }): ColorAccuracy {
  const value = (row.color_accuracy ?? '').trim();
  if (!value) return 'photo';
  if (!(COLOR_ACCURACIES as readonly string[]).includes(value)) throw new Error(`unknown color_accuracy "${value}"`);
  return value as ColorAccuracy;
}

/**
 * The card headings by name. A mapped heading names all five attributes and its evidence; an unmapped
 * one (a heading spanning several finishes) names none, so a bead under it is never guessed.
 */
export function parseSectionMappings(rows: ReadonlyArray<Record<string, string>>): Map<string, SectionMapping> {
  const sections = new Map<string, SectionMapping>();
  for (const row of rows) {
    const heading = (row.card_section ?? '').trim();
    const value = (column: string) => (row[column] ?? '').trim();
    const mapping: SectionMapping = { catalogue_heading: value('catalogue_heading'), glassGroup: value('glassGroup'), finish: value('finish'), dyed: value('dyed'), galvanized: value('galvanized'), plating: value('plating'), evidence: value('evidence') };
    const filled = ATTRIBUTE_COLUMNS.filter((column) => mapping[column]);
    if (!heading) throw new Error('sample-card-sections.csv: a row has no card_section');
    if (sections.has(heading)) throw new Error(`sample-card-sections.csv: "${heading}" is mapped twice`);
    if (mapping.catalogue_heading && (filled.length < ATTRIBUTE_COLUMNS.length || !mapping.evidence)) throw new Error(`sample-card-sections.csv: "${heading}" is mapped but lacks ${[...ATTRIBUTE_COLUMNS, 'evidence' as const].filter((column) => !mapping[column]).join(', ')}`);
    if (!mapping.catalogue_heading && filled.length > 0) throw new Error(`sample-card-sections.csv: "${heading}" names attributes but no catalogue_heading`);
    sections.set(heading, mapping);
  }
  return sections;
}

export function buildCardSidecar(size: string, source: Sidecar, options: { squareHole: boolean; keepColorGroup: boolean; colorAccuracy?: ColorAccuracy }): Sidecar {
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
    colorAccuracy: options.colorAccuracy ?? 'photo',
  };
}

/** Which of the sources in the header a bead's attributes came from. */
export type MetadataKind = 'directory' | 'decision' | 'delica-list' | 'other-size' | 'section';

export type Resolved = { beadId: string; size: string; row: BatchRow; sidecar: Sidecar; metadataSource: string; metadataKind: MetadataKind; render: string; bead: Rect };

type Donor = { sidecar: Sidecar; source: string };
type PhraseLookup = (beadId: string) => { attributes: OfficialAttributes; source: string } | null;

export type CardBeadLookup = {
  /** Whether the bead is already in the library: its sidecar and its registry row. */
  inLibrary: (beadId: string, size: string) => boolean;
  sections: ReadonlyMap<string, SectionMapping>;
  renderExists: (render: string) => boolean;
  /** The same number's sidecar at another size that Miyuki's directory itself lists (the round-hole bead's for a square-hole colour). */
  directoryDonor?: (beadId: string, size: string) => Donor | null;
  /** The number's reviewed glass-and-finish decision, with its evidence. */
  decision?: (beadId: string) => Donor | null;
  /** The Delica list's glass and finish for the number as a seed twin, when that reading is trusted. */
  officialPhrase?: PhraseLookup;
  /** The same number's sidecar at another size from any official source, its source named (the round-hole bead's for a square-hole colour). */
  anyDonor?: (beadId: string, size: string) => Donor | null;
};

/** Where a card bead's attributes come from, strongest first (see the header). */
export function chooseCardMetadata(beadId: string, size: string, cardSection: string, lookup: CardBeadLookup): (Donor & { keepColorGroup: boolean; kind: MetadataKind }) | null {
  const directory = lookup.directoryDonor?.(beadId, size);
  if (directory) return { ...directory, keepColorGroup: true, kind: 'directory' };
  const decision = lookup.decision?.(beadId);
  if (decision) return { ...decision, keepColorGroup: false, kind: 'decision' };
  const phrase = lookup.officialPhrase?.(beadId);
  if (phrase) return { sidecar: phrase.attributes, source: phrase.source, keepColorGroup: false, kind: 'delica-list' };
  const donor = lookup.anyDonor?.(beadId, size);
  if (donor) return { ...donor, keepColorGroup: true, kind: 'other-size' };
  const section = lookup.sections.get(cardSection.trim());
  if (section?.catalogue_heading) return { sidecar: section, source: `card section "${cardSection}" → ${section.evidence}`, keepColorGroup: false, kind: 'section' };
  return null;
}

export function resolveCardBead(row: BatchRow, size: string, lookup: CardBeadLookup): Resolved | { beadId: string; size: string; skip: string } {
  // The number as the card prints it: a card photographs that product (a `-1` colour is another one).
  const beadId = row.colour_no.trim().toUpperCase();
  if (lookup.inLibrary(beadId, size)) return { beadId, size, skip: 'already on disk' };
  const bead = parseBox(row.bead_cell_px150)!;
  const render = path.join(CELLS, `${row.pdf.replace(/\.pdf$/, '')}-p${row.page}-150.png`);
  if (!lookup.renderExists(render)) return { beadId, size, skip: `no page render ${path.relative(ASSET_REPO_ROOT, render)}` };
  const metadata = chooseCardMetadata(beadId, size, row.card_section, lookup);
  if (!metadata) return { beadId, size, skip: `no official metadata source (section "${row.card_section}" unmapped)` };
  const sidecar = buildCardSidecar(size, metadata.sidecar, { squareHole: beadId.endsWith('SH'), keepColorGroup: metadata.keepColorGroup, colorAccuracy: rowColorAccuracy(row) });
  return { beadId, size, row, sidecar, metadataSource: metadata.source, metadataKind: metadata.kind, render, bead };
}

/** The fields a reading is compared on; the Delica list never names a plating the directory records. */
function readingKey(attributes: Pick<OfficialAttributes, 'glassGroup' | 'finish' | 'dyed' | 'galvanized'>): string {
  return [attributes.glassGroup, attributes.finish, attributes.dyed, attributes.galvanized].join(' | ');
}

/**
 * The Delica list's seed twins, read as round-rocaille attributes, and how often each reading matches
 * the directory on the twins the directory carries. A reading counts unless a directory twin read the
 * same way disagrees: the list describes the Delica twin, and for some finishes ("Color Lined", "Gold
 * Luster") the directory records the round rocaille differently. Trust follows the reading, not the
 * phrase's wording (`Qpaque - AB` and `Opaque - AB` are one reading). A phrase with a term the reader
 * does not know is left out and counted in `unknownTerms`.
 */
export function buildOfficialPhraseLookup(
  rows: ReadonlyArray<{ dbNumber: string; seedNumber: string; glassTypeFinish: string }>,
  directorySidecar: (beadId: string) => Sidecar | null,
): { lookup: PhraseLookup; unknownTerms: Map<string, number> } {
  const trust = new Map<string, { agree: number; disagree: number }>();
  const twins = new Map<string, { dbNumber: string; phrase: string; attributes: OfficialAttributes }>();
  const unknownTerms = new Map<string, number>();
  for (const row of rows) {
    const seed = row.seedNumber.trim().toUpperCase();
    if (!seed || seed === 'N/A') continue;
    let attributes: OfficialAttributes;
    try {
      attributes = attributesFromOfficialFinish(row.glassTypeFinish);
    } catch (error) {
      if (!(error instanceof OfficialFinishError)) throw error;
      const term = error.term ?? '(no glass named)';
      unknownTerms.set(term, (unknownTerms.get(term) ?? 0) + 1);
      continue;
    }
    twins.set(seed, { dbNumber: row.dbNumber, phrase: row.glassTypeFinish.replace(/\s+/g, ' ').trim(), attributes });
    const directory = directorySidecar(seed);
    if (!directory) continue;
    const key = readingKey(attributes);
    const counts = trust.get(key) ?? { agree: 0, disagree: 0 };
    counts[readingKey({ glassGroup: directory.glassGroup ?? '', finish: directory.finish ?? '', dyed: directory.dyed ?? '', galvanized: directory.galvanized ?? '' }) === key ? 'agree' : 'disagree'] += 1;
    trust.set(key, counts);
  }
  const lookup: PhraseLookup = (beadId) => {
    const twin = twins.get(beadId.toUpperCase());
    if (!twin) return null;
    const counts = trust.get(readingKey(twin.attributes)) ?? { agree: 0, disagree: 0 };
    if (counts.disagree > 0) return null;
    const evidence = counts.agree > 0 ? `the reading matches the directory on ${counts.agree} of ${counts.agree} twins read the same way` : 'no directory twin is read this way to compare';
    return { attributes: twin.attributes, source: `Miyuki's Delica list: seed twin of ${twin.dbNumber}, "${twin.phrase}" (${evidence})` };
  };
  return { lookup, unknownTerms };
}

export type CardLookupSources = {
  registry: ReadonlyMap<string, RegistryRow>;
  sidecar: (beadId: string, size: string) => Sidecar | null;
  sections: ReadonlyMap<string, SectionMapping>;
  decisions: ReadonlyMap<string, AttributeDecision>;
  delicaList: ReadonlyArray<{ dbNumber: string; seedNumber: string; glassTypeFinish: string }>;
  renderExists: (render: string) => boolean;
  /** `--rewrite-images`: every ready row resolves again, nothing counts as present. */
  rewriteImages: boolean;
};

/** The lookup `resolveCardBead` reads, from the registry, the sidecars on disk and the reviewed sources. */
export function buildCardBeadLookup(sources: CardLookupSources): { lookup: CardBeadLookup; unknownTerms: Map<string, number> } {
  const { registry, sidecar } = sources;
  const listedByDirectory = (beadId: string, size: string) => registry.get(registryKey(beadId, size))?.listingSource === 'directory';
  const donorLookup = { sidecar };
  const directoryDonor = (beadId: string, size: string) =>
    chooseMetadataDonor(beadId, size, null, donorLookup, { accept: listedByDirectory, sourceLabel: (id, donorSize) => `official attributes of ${id} at ${donorSize}/0 (directory)` });
  const anyDonor = (beadId: string, size: string) =>
    chooseMetadataDonor(beadId, size, null, donorLookup, { sourceLabel: (id, donorSize) => `attributes of ${id} at ${donorSize}/0 (${registry.get(registryKey(id, donorSize))?.listingSource ?? 'unregistered'})` });
  // A seed twin's directory sidecar at any size, to see how the directory records that reading.
  const directoryTwin = (beadId: string) => {
    const size = DONOR_SIZES.find((donorSize) => listedByDirectory(beadId, donorSize) && sidecar(beadId, donorSize));
    return size ? sidecar(beadId, size) : null;
  };
  const { lookup: officialPhrase, unknownTerms } = buildOfficialPhraseLookup(sources.delicaList, directoryTwin);
  const lookup: CardBeadLookup = {
    inLibrary: (beadId, size) => !sources.rewriteImages && registry.has(registryKey(beadId, size)) && sidecar(beadId, size) !== null,
    sections: sources.sections,
    renderExists: sources.renderExists,
    directoryDonor,
    decision: (beadId) => {
      const decided = sources.decisions.get(beadId.toUpperCase());
      return decided ? { sidecar: decided, source: `reviewed decision ${decided.decidedOn}: ${decided.evidence}` } : null;
    },
    officialPhrase,
    anyDonor,
  };
  return { lookup, unknownTerms };
}

/** Whether a bead's registry row says its image is this card row's cell (the row `registryRowFor` writes). */
export function isOwnCardImage(registryRow: RegistryRow | undefined, row: BatchRow): boolean {
  return registryRow?.imageSource === 'sample-card' && registryRow.sourceRef.startsWith(`sample card ${row.card} (${row.pdf}) p.${row.page} `);
}

export function registryRowFor(entry: Resolved, addedOn = todayIso()): RegistryRow {
  return {
    beadId: entry.beadId,
    size: entry.size,
    listingSource: 'sample-card',
    imageSource: 'sample-card',
    sizeSource: 'sample-card',
    colorAccuracy: rowColorAccuracy(entry.row),
    sourceRef: `sample card ${entry.row.card} (${entry.row.pdf}) p.${entry.row.page} bead cell (${entry.row.bead_cell_px150}) "${entry.row.card_section}"; size: ${entry.row.card_states_size}; metadata: ${entry.metadataSource}`,
    addedOn,
  };
}

const PLAN_COLUMNS = ['beadId', 'size', 'card', 'card_section', 'glassGroup', 'finish', 'dyed', 'galvanized', 'metadataSource'];

/** The resolved beads, one row each, then the skipped ones with the reason. */
export function formatPlan(added: ReadonlyArray<Resolved>, skipped: ReadonlyMap<string, string[]>): string {
  const rows: Array<Record<string, string>> = added.map((e) => ({ beadId: e.beadId, size: e.size, card: e.row.card, card_section: e.row.card_section, glassGroup: e.sidecar.glassGroup, finish: e.sidecar.finish, dyed: e.sidecar.dyed, galvanized: e.sidecar.galvanized, metadataSource: e.metadataSource }));
  for (const [reason, ids] of skipped) {
    for (const id of ids) {
      const [beadId, size] = id.split('@');
      rows.push({ beadId, size, metadataSource: `SKIPPED: ${reason}` });
    }
  }
  return formatCsv(rows, PLAN_COLUMNS);
}

/** How many beads of a size take their attributes from each source, for the run's summary. */
export function countMetadataKinds(entries: ReadonlyArray<Pick<Resolved, 'metadataKind'>>): Record<MetadataKind, number> {
  const counts: Record<MetadataKind, number> = { directory: 0, decision: 0, 'delica-list': 0, 'other-size': 0, section: 0 };
  for (const entry of entries) counts[entry.metadataKind] += 1;
  return counts;
}

export type CardArgs = { dryRun: boolean; rewriteImages: boolean; only: Set<string> | null; batchFile: string; planFile: string | null };

/** The command line; `--batch` and `--plan` are read against the repo root, and `--plan` is a dry run. */
export function parseCardArgs(argv: readonly string[]): CardArgs {
  const valueOf = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
  };
  const only = valueOf('--only');
  const batch = valueOf('--batch');
  const plan = valueOf('--plan');
  return {
    // --plan <file>: every resolved bead with its attributes and their source, for review before a run.
    dryRun: argv.includes('--dry-run') || plan !== null,
    // --rewrite-images: write again the originals this card supplied (its registry rows say so); sidecars and registry untouched.
    rewriteImages: argv.includes('--rewrite-images'),
    only: only ? new Set(only.split(',').map((v) => v.trim().toUpperCase())) : null,
    batchFile: batch ? path.resolve(ASSET_REPO_ROOT, batch) : DEFAULT_BATCH,
    planFile: plan ? path.resolve(ASSET_REPO_ROOT, plan) : null,
  };
}

function writePlan(file: string, added: ReadonlyArray<Resolved>, skipped: ReadonlyMap<string, string[]>): void {
  fs.writeFileSync(file, formatPlan(added, skipped), 'utf-8');
  console.log(`  plan: ${file}`);
}

async function writeOriginal(entry: Resolved): Promise<void> {
  await writeStrandOriginal(entry.render, entry.bead, originalPath(BEAD_TYPE, entry.size, entry.beadId), CELL_INSET);
}

function report(added: ReadonlyArray<Resolved>, skipped: ReadonlyMap<string, string[]>, notReady: string[], dryRun: boolean): void {
  console.log(`Sample-card beads to add${dryRun ? ' (dry run)' : ''}: ${added.length}`);
  for (const size of Array.from(new Set(added.map((e) => e.size))).sort((a, b) => Number(a) - Number(b))) {
    const atSize = added.filter((e) => e.size === size);
    const kinds = countMetadataKinds(atSize);
    console.log(`  ${size}/0: ${atSize.length} (metadata from the directory at another size ${kinds.directory}, a reviewed decision ${kinds.decision}, the Delica list ${kinds['delica-list']}, another size from another source ${kinds['other-size']}, the card section ${kinds.section}; square hole ${atSize.filter((e) => e.beadId.endsWith('SH')).length})`);
  }
  for (const [reason, ids] of skipped) console.log(`  skipped (${reason}): ${ids.length} ${ids.slice(0, 8).join(' ')}${ids.length > 8 ? ' …' : ''}`);
  if (notReady.length) console.log(`  confirmed rows without a located bead cell (not added): ${notReady.length} ${notReady.slice(0, 10).join(' ')}${notReady.length > 10 ? ' …' : ''}`);
}

async function main(): Promise<void> {
  const { dryRun, rewriteImages, only, batchFile, planFile } = parseCardArgs(process.argv.slice(2));
  const rows = parseCsv(fs.readFileSync(batchFile, 'utf-8'));
  const registry = new Map(readRegistry(BEAD_TYPE).map((r) => [registryKey(r.beadId, r.size), r]));
  const { lookup, unknownTerms } = buildCardBeadLookup({
    registry,
    sidecar: (beadId, size) => readSidecar(BEAD_TYPE, size, beadId),
    sections: parseSectionMappings(parseCsv(fs.readFileSync(SECTIONS, 'utf-8'))),
    decisions: parseAttributeDecisions(fs.readFileSync(ATTRIBUTE_DECISIONS_PATH, 'utf-8')),
    delicaList: readDurabilityTsv(),
    renderExists: (render) => fs.existsSync(render),
    rewriteImages,
  });
  console.log(`Batch: ${path.relative(ASSET_REPO_ROOT, batchFile)}`);
  const unread = Array.from(unknownTerms.values()).reduce((sum, n) => sum + n, 0);
  if (unread) console.log(`  Delica-list seed twins not read (a term the reader does not know): ${unread} (${Array.from(unknownTerms, ([term, n]) => `${term} ${n}`).join(', ')})`);

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
      // A rewrite touches only originals this card supplied: a colour's other sizes may come from the
      // directory or the catalogue (card 867/R names four sizes, Beadloo had some from GB-6).
      if (rewriteImages && !isOwnCardImage(registry.get(registryKey(resolved.beadId, size)), row)) continue;
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
  report(added, skipped, notReady, dryRun);
  if (planFile) writePlan(planFile, added, skipped);
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
  const addedRows = await writeBeadsAndRegistry(BEAD_TYPE, added, async (entry) => {
    prepareOriginalTarget(originalPath(BEAD_TYPE, entry.size, entry.beadId));
    await writeOriginal(entry);
    writeSidecar(BEAD_TYPE, entry.size, entry.beadId, entry.sidecar);
    return registryRowFor(entry);
  });
  console.log(`  wrote ${added.length} originals + sidecars, ${addedRows} registry rows`);
  console.log('\nNext: pnpm beads:miyuki:round_rocailles:sync -- --local-only (thumbnails, colours, metadata, aliases).');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nadd-card-beads failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
