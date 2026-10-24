#!/usr/bin/env tsx
/**
 * Adds round-rocaille colours that Miyuki's printed catalogue GB-6 lists and Beadloo lacks
 * (issue #203 Phase 4): the per-size gaps, size 1/0, the `HB` colours and the square-hole colours.
 * A mix (the catalogue's Mix page) is not a colour and is left out.
 *
 * For each catalogue (colour, size) without a bead on disk, under the number as printed (a `-1` colour
 * of the official list is a different product, never the catalogue's plain number):
 * - the image follows decision D1: Miyuki's directory photo of the same colour at another size when
 *   Beadloo holds one as a photo (copied under `downloaded/miyuki/round_rocailles/<size>/<id>.jpg`,
 *   colour accuracy `photo`, the source size in the registry), else the catalogue swatch crop
 *   (`downloaded/miyuki/catalogue/gb-6/round-rocailles/<size>/<no>[-SH].png`, accuracy `swatch`);
 *   a square-hole colour never borrows a round-hole photo;
 * - the metadata comes from the sidecar of the same colour at another size (then, for a square-hole
 *   colour, from the round-hole bead of the same number), else from
 *   `sources/miyuki/catalogue/gb-6/round-rocailles-sections.csv`, the catalogue heading mapped to the
 *   directory vocabulary with its evidence; `colorGroup` only ever comes from a directory sidecar;
 * - a registry row records the catalogue page and cell and where image and metadata came from.
 *
 * Then run `pnpm beads:miyuki:round_rocailles:sync -- --local-only` for thumbnails, colours, metadata and aliases.
 *
 * Usage: pnpm beads:miyuki:round_rocailles:add-catalogue [--dry-run] [--sizes 1,5] [--only 404,1SH]
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { ASSET_REPO_ROOT, getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from '../../common/lib/paths.js';
import { readRegistry, registryKey, todayIso, upsertRegistryRows, writeRegistry, type ColorAccuracy, type RegistryRow } from '../common/registry.js';
import { parseCsv } from '../common/csv.js';
import { readSidecar, type Sidecar } from '../common/bead-files.js';

const BEAD_TYPE = 'miyuki-round_rocailles' as const;
const CATALOGUE_DIR = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'catalogue', 'gb-6');
const CROPS_DIR = path.join(ASSET_REPO_ROOT, 'downloaded', 'miyuki', 'catalogue', 'gb-6', 'round-rocailles');
/** Where to look for the same colour's photo and sidecar first: the sizes the directory covers best. */
export const DONOR_SIZES = ['11', '8', '15', '6', '5', '2', '1'];

export type CatalogueRoundRocailleRow = { colour_no: string; size: string; hole: string; section_en: string; page: string; cell_x: string; cell_y: string };
export type SectionMapping = Pick<Sidecar, 'glassGroup' | 'finish' | 'dyed' | 'galvanized' | 'plating'> & { evidence: string };

/** A catalogue row that names a colour: the Mix page lists bead mixes, which are not colours. */
export function isColourRow(row: Pick<CatalogueRoundRocailleRow, 'section_en'>): boolean {
  return !/^mix\b/i.test(row.section_en.trim());
}

export function sizeDirectory(size: string): string {
  return size.replace('/0', '');
}

/** Beadloo's ID: the number as printed plus `SH` for square hole. */
export function catalogueRoundRocailleId(row: Pick<CatalogueRoundRocailleRow, 'colour_no' | 'hole'>): string {
  const number = row.colour_no.trim().toUpperCase();
  return row.hole === 'SH' ? `${number}SH` : number;
}

export function catalogueCropName(row: Pick<CatalogueRoundRocailleRow, 'colour_no' | 'hole'>): string {
  return `${row.colour_no.trim().toUpperCase()}${row.hole === 'SH' ? '-SH' : ''}.png`;
}

export type DonorLookup = {
  /** The sizes (directory names) that hold this ID with an original image Beadloo trusts as a photo. */
  photoSizes: (beadId: string) => string[];
  sidecar: (beadId: string, size: string) => Sidecar | null;
};

/** Decision D1: the same colour's directory photo at another size, nearest preferred size first. */
export function chooseImageDonor(beadId: string, size: string, lookup: Pick<DonorLookup, 'photoSizes'>): string | null {
  const candidates = new Set(lookup.photoSizes(beadId));
  return DONOR_SIZES.find((donorSize) => donorSize !== size && candidates.has(donorSize)) ?? null;
}

export type MetadataDonor = { sidecar: Sidecar; source: string };

export type DonorFilter = {
  /** Whether the bead `id` at `donorSize` may lend its attributes (for instance only one the directory lists). */
  accept?: (id: string, donorSize: string) => boolean;
  /** How the registry row names the donor. */
  sourceLabel?: (id: string, donorSize: string) => string;
};

/** The same colour at another size first (the image donor's size preferred); a square-hole colour may then take the round-hole bead's. */
export function chooseMetadataDonor(beadId: string, size: string, imageDonorSize: string | null, lookup: Pick<DonorLookup, 'sidecar'>, filter: DonorFilter = {}): MetadataDonor | null {
  const accept = filter.accept ?? (() => true);
  const sourceLabel = filter.sourceLabel ?? ((id, donorSize) => `official attributes of ${id} at ${donorSize}/0 (directory)`);
  const ids = beadId.endsWith('SH') ? [beadId, beadId.slice(0, -'SH'.length)] : [beadId];
  for (const id of ids) {
    const sizes = id === beadId ? [imageDonorSize, ...DONOR_SIZES].filter((s): s is string => Boolean(s) && s !== size) : [size, ...DONOR_SIZES];
    for (const donorSize of Array.from(new Set(sizes))) {
      if (!accept(id, donorSize)) continue;
      const sidecar = lookup.sidecar(id, donorSize);
      if (sidecar) return { sidecar, source: sourceLabel(id, donorSize) };
    }
  }
  return null;
}

export function buildRoundRocailleSidecar(
  size: string,
  donor: Sidecar,
  options: { squareHole: boolean; colorAccuracy: ColorAccuracy; keepColorGroup: boolean },
): Sidecar {
  return {
    shape: 'Round Rocailles',
    size: `${size}/0`,
    ...(options.keepColorGroup && donor.colorGroup ? { colorGroup: donor.colorGroup } : {}),
    glassGroup: donor.glassGroup,
    finish: donor.finish || 'Not Specified',
    dyed: donor.dyed,
    galvanized: donor.galvanized,
    plating: donor.plating,
    ...(options.squareHole ? { hole: 'Square Hole' } : {}),
    colorAccuracy: options.colorAccuracy,
  };
}

function originalPath(size: string, beadId: string): string {
  return path.join(getDownloadedBeadTypeDirectory(BEAD_TYPE, size), `${beadId}.jpg`);
}

type Resolved = {
  beadId: string;
  size: string;
  row: CatalogueRoundRocailleRow;
  image: { kind: 'photo'; donorSize: string } | { kind: 'swatch'; crop: string };
  sidecar: Sidecar;
  metadataSource: string;
};
type Skipped = { beadId: string; skip: string };

export function resolveCatalogueBead(
  row: CatalogueRoundRocailleRow,
  context: { sections: ReadonlyMap<string, SectionMapping>; lookup: DonorLookup; hasCrop: (crop: string) => boolean },
): Resolved | Skipped {
  const size = sizeDirectory(row.size);
  const beadId = catalogueRoundRocailleId(row);
  if (context.lookup.sidecar(beadId, size)) return { beadId, skip: 'already on disk' };

  const donorSize = chooseImageDonor(beadId, size, context.lookup);
  const crop = path.join(CROPS_DIR, size, catalogueCropName(row));
  if (!donorSize && !context.hasCrop(crop)) return { beadId, skip: `no photo at another size and no swatch crop (${path.relative(ASSET_REPO_ROOT, crop)})` };
  const image: Resolved['image'] = donorSize ? { kind: 'photo', donorSize } : { kind: 'swatch', crop };

  const donor = chooseMetadataDonor(beadId, size, donorSize, context.lookup);
  const section = context.sections.get(row.section_en.trim());
  if (!donor && !section) return { beadId, skip: `no official metadata source (heading "${row.section_en}" unmapped)` };
  const sidecar = buildRoundRocailleSidecar(size, donor ? donor.sidecar : section!, {
    squareHole: row.hole === 'SH',
    colorAccuracy: image.kind,
    keepColorGroup: Boolean(donor),
  });
  const metadataSource = donor ? donor.source : `heading "${row.section_en}" via round-rocailles-sections.csv (${section!.evidence})`;
  return { beadId, size, row, image, sidecar, metadataSource };
}

async function writeOriginal(entry: Resolved): Promise<void> {
  const target = originalPath(entry.size, entry.beadId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (entry.image.kind === 'photo') fs.copyFileSync(originalPath(entry.image.donorSize, entry.beadId), target);
  else await sharp(entry.image.crop).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toFile(target);
}

export function registryRowFor(entry: Resolved, addedOn = todayIso()): RegistryRow {
  const image = entry.image.kind === 'photo' ? `directory photo of ${entry.beadId} at ${entry.image.donorSize}/0 (decision D1)` : 'swatch crop';
  return {
    beadId: entry.beadId,
    size: entry.size,
    listingSource: 'catalogue-gb6',
    imageSource: entry.image.kind === 'photo' ? 'same-colour-other-size' : 'catalogue-gb6',
    sizeSource: 'catalogue-gb6',
    colorAccuracy: entry.image.kind,
    sourceRef: `GB-6 p.${entry.row.page} cell (${entry.row.cell_x}, ${entry.row.cell_y}) "${entry.row.section_en}"; image: ${image}; metadata: ${entry.metadataSource}`,
    addedOn,
  };
}

function buildLookup(): DonorLookup {
  const accuracy = new Map(readRegistry(BEAD_TYPE).map((row) => [registryKey(row.beadId, row.size), row.colorAccuracy]));
  return {
    photoSizes: (beadId) => DONOR_SIZES.filter((size) => fs.existsSync(originalPath(size, beadId)) && accuracy.get(registryKey(beadId, size)) === 'photo'),
    sidecar: (beadId, size) => readSidecar(BEAD_TYPE, size, beadId),
  };
}

function readSections(): Map<string, SectionMapping> {
  const rows = parseCsv(fs.readFileSync(path.join(CATALOGUE_DIR, 'round-rocailles-sections.csv'), 'utf-8'));
  return new Map(rows.map((row) => [row.section_en.trim(), { glassGroup: row.glassGroup, finish: row.finish, dyed: row.dyed, galvanized: row.galvanized, plating: row.plating, evidence: row.evidence }]));
}

function report(added: Resolved[], skipped: Map<string, string[]>, dryRun: boolean): void {
  console.log(`Catalogue round-rocaille beads to add${dryRun ? ' (dry run)' : ''}: ${added.length}`);
  const sizes = Array.from(new Set(added.map((entry) => entry.size))).sort((a, b) => Number(a) - Number(b));
  for (const size of sizes) {
    const atSize = added.filter((entry) => entry.size === size);
    const photo = atSize.filter((entry) => entry.image.kind === 'photo').length;
    const squareHole = atSize.filter((entry) => entry.beadId.endsWith('SH')).length;
    const bySection = atSize.filter((entry) => entry.metadataSource.startsWith('heading')).length;
    console.log(`  ${size}/0: ${atSize.length} (photo ${photo}, swatch ${atSize.length - photo}; square hole ${squareHole}; metadata from the heading ${bySection})`);
  }
  const headings = new Map<string, number>();
  for (const entry of added) {
    if (entry.metadataSource.startsWith('heading')) headings.set(entry.row.section_en, (headings.get(entry.row.section_en) ?? 0) + 1);
  }
  if (headings.size > 0) console.log(`  metadata from headings: ${Array.from(headings, ([heading, count]) => `${heading} ${count}`).join(', ')}`);
  for (const [reason, ids] of skipped) console.log(`  skipped (${reason}): ${ids.length} ${ids.slice(0, 8).join(' ')}${ids.length > 8 ? ' …' : ''}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const argAfter = (flag: string): string[] | null => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1].split(',').map((v) => v.trim().toUpperCase()) : null;
  };
  const only = argAfter('--only');
  const sizes = argAfter('--sizes');

  const rows = parseCsv(fs.readFileSync(path.join(CATALOGUE_DIR, 'round-rocailles.csv'), 'utf-8')) as unknown as CatalogueRoundRocailleRow[];
  const context = { sections: readSections(), lookup: buildLookup(), hasCrop: (crop: string) => fs.existsSync(crop) };

  const added: Resolved[] = [];
  const seen = new Set<string>();
  const skipped = new Map<string, string[]>();
  for (const row of rows) {
    if (!isColourRow(row)) continue;
    const size = sizeDirectory(row.size);
    if (sizes && !sizes.includes(size)) continue;
    const resolved = resolveCatalogueBead(row, context);
    if (only && !only.includes(resolved.beadId)) continue;
    const key = `${size}:${resolved.beadId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if ('skip' in resolved) {
      if (resolved.skip !== 'already on disk') (skipped.get(resolved.skip) ?? skipped.set(resolved.skip, []).get(resolved.skip)!).push(resolved.beadId);
      continue;
    }
    added.push(resolved);
  }
  report(added, skipped, dryRun);
  if (dryRun) {
    for (const entry of added.slice(0, 6)) console.log(`  ${entry.beadId} (${entry.size}/0) ← ${entry.image.kind === 'photo' ? `photo at ${entry.image.donorSize}/0` : path.basename(entry.image.crop)}; ${entry.metadataSource}`);
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
    console.error('\nadd-round-rocaille-beads failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
