#!/usr/bin/env tsx
/**
 * Adds Delica colours that Miyuki's printed catalogue GB-6 lists and the directory does not
 * (issue #203 Phase 3): the regular colours DB665, DB1130, DB1140, DBS134, DBM626 and the 156
 * Delica Cut colours (DBC, DBSC, DBMC, DBLC).
 *
 * For each catalogue row without a bead on disk:
 * - the original image is the swatch crop the catalogue parser wrote
 *   (`downloaded/miyuki/catalogue/gb-6/delica/<size>/<code>.png`), converted to JPEG under
 *   `downloaded/miyuki/delica/<size>/<beadId>.jpg`; its colour accuracy is `swatch`;
 * - the metadata comes, in this order, from `sources/miyuki/catalogue/gb-6/delica-metadata.csv`
 *   (hand-mapped from the official list's finish string, evidence recorded there), else from the
 *   regular bead of the same colour number at the same size, else at 11/0 (Miyuki's colour numbers
 *   name a colour across sizes and lines); `colorGroup` is left out, Miyuki publishes it only on
 *   the directory; Cut beads carry `cut: "Cut"`; a colour the official list flags carries
 *   `status: "Discontinued"`;
 * - a registry row records the catalogue page and cell and where the metadata came from.
 *
 * Then run `pnpm beads:miyuki:delica:sync -- --local-only` for thumbnails, colours, metadata and aliases.
 *
 * Usage: pnpm beads:miyuki:delica:add-catalogue [--dry-run] [--only DB0665,DBC0010]
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { ASSET_REPO_ROOT, getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from '../../common/lib/paths.js';
import { readDurabilityTsv } from '../common/official-lists.js';
import { readRegistry, todayIso, upsertRegistryRows, writeRegistry, type RegistryRow } from '../common/registry.js';
import { parseCsv } from '../common/csv.js';
import { readSidecar, type Sidecar } from '../common/bead-files.js';

const BEAD_TYPE = 'miyuki-delica' as const;
const CATALOGUE_DIR = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'catalogue', 'gb-6');
const CROPS_DIR = path.join(ASSET_REPO_ROOT, 'downloaded', 'miyuki', 'catalogue', 'gb-6', 'delica');
const PREFIX_SIZE: Record<string, string> = { DB: '11', DBC: '11', DBM: '10', DBMC: '10', DBL: '8', DBLC: '8', DBS: '15', DBSC: '15' };
const SIZE_LABEL: Record<string, string> = { '11': '11/0', '10': '10/0', '8': '8/0', '15': '15/0' };

export type CatalogueDelicaRow = { colour_no: string; size: string; prefix: string; section_en: string; page: string; cell_x: string; cell_y: string };

export function catalogueDelicaId(row: Pick<CatalogueDelicaRow, 'colour_no' | 'prefix'>): string | null {
  const match = /^(\d+)([A-Z]*)$/i.exec(row.colour_no.trim());
  if (!match || !(row.prefix in PREFIX_SIZE)) return null;
  return `${row.prefix}${match[1].padStart(4, '0')}${match[2].toUpperCase()}`;
}

export function catalogueCropName(row: Pick<CatalogueDelicaRow, 'colour_no' | 'prefix'>): string {
  return `${row.prefix}${row.colour_no.trim().toUpperCase()}.png`;
}

/** The regular bead of the same colour number: same size first, then 11/0. */
export function metadataDonorCandidates(beadId: string): string[] {
  const match = /^(DB[MLS]?)(C?)(\d{4})([A-Z]*)$/.exec(beadId);
  if (!match) return [];
  const [, prefix, , number, suffix] = match;
  const sameSize = `${prefix}${number}${suffix}`;
  return prefix === 'DB' ? [sameSize] : [sameSize, `DB${number}${suffix}`];
}

export function buildCatalogueSidecar(
  beadId: string,
  size: string,
  donor: Sidecar,
  options: { cut: boolean; discontinued: boolean },
): Sidecar {
  const { colorGroup: _dropped, formerly: _formerly, ...official } = donor;
  void _dropped;
  void _formerly;
  return {
    shape: 'Delica',
    size: SIZE_LABEL[size],
    glassGroup: official.glassGroup,
    finish: official.finish ?? 'Not Specified',
    dyed: official.dyed,
    galvanized: official.galvanized,
    plating: official.plating,
    ...(options.cut ? { cut: 'Cut' } : {}),
    ...(options.discontinued ? { status: 'Discontinued' } : {}),
    colorAccuracy: 'swatch',
  };
}

type Resolved = { beadId: string; size: string; row: CatalogueDelicaRow; crop: string; sidecar: Sidecar; metadataSource: string };

export function resolveCatalogueBead(
  row: CatalogueDelicaRow,
  explicit: Map<string, Record<string, string>>,
  discontinued: Set<string>,
): Resolved | { beadId: string; skip: string } {
  const beadId = catalogueDelicaId(row);
  if (!beadId) return { beadId: `${row.prefix}${row.colour_no}`, skip: 'unparseable row' };
  const size = PREFIX_SIZE[row.prefix];
  // The catalogue prints the plain number; a `-1` colour is a different product (PR #2), never this one.
  if (readSidecar(BEAD_TYPE, size, beadId)) return { beadId, skip: 'already on disk' };
  const crop = path.join(CROPS_DIR, size, catalogueCropName(row));
  if (!fs.existsSync(crop)) return { beadId, skip: `no swatch crop at ${path.relative(ASSET_REPO_ROOT, crop)}` };
  const cut = row.prefix.endsWith('C');
  const explicitRow = explicit.get(beadId);
  let donor: Sidecar | null = null;
  let metadataSource = '';
  if (explicitRow) {
    donor = explicitRow;
    metadataSource = `delica-metadata.csv (${explicitRow.source})`;
  } else {
    for (const candidate of metadataDonorCandidates(beadId)) {
      const candidateSize = PREFIX_SIZE[/^(DB[MLS]?)/.exec(candidate)![1]];
      const sidecar = readSidecar(BEAD_TYPE, candidateSize, candidate);
      if (sidecar) {
        donor = sidecar;
        metadataSource = `official attributes of ${candidate} (${candidateSize}/0, directory)`;
        break;
      }
    }
  }
  if (!donor) return { beadId, skip: 'no official metadata source' };
  const sidecar = buildCatalogueSidecar(beadId, size, donor, { cut, discontinued: discontinued.has(beadId) });
  return { beadId, size, row, crop, sidecar, metadataSource };
}

async function writeOriginal(crop: string, size: string, beadId: string): Promise<string> {
  const target = path.join(getDownloadedBeadTypeDirectory(BEAD_TYPE, size), `${beadId}.jpg`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp(crop).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toFile(target);
  return target;
}

function registryRowFor(resolved: Resolved): RegistryRow {
  return {
    beadId: resolved.beadId,
    size: resolved.size,
    listingSource: 'catalogue-gb6',
    imageSource: 'catalogue-gb6',
    sizeSource: 'catalogue-gb6',
    colorAccuracy: 'swatch',
    sourceRef: `GB-6 p.${resolved.row.page} cell (${resolved.row.cell_x}, ${resolved.row.cell_y}) "${resolved.row.section_en}"; metadata: ${resolved.metadataSource}`,
    addedOn: todayIso(),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const onlyIndex = argv.indexOf('--only');
  const only = onlyIndex >= 0 && argv[onlyIndex + 1] ? new Set(argv[onlyIndex + 1].split(',').map((id) => id.trim().toUpperCase())) : null;

  const rows = parseCsv(fs.readFileSync(path.join(CATALOGUE_DIR, 'delica.csv'), 'utf-8')) as unknown as CatalogueDelicaRow[];
  const explicit = new Map(parseCsv(fs.readFileSync(path.join(CATALOGUE_DIR, 'delica-metadata.csv'), 'utf-8')).map((row) => [row.beadId.toUpperCase(), row]));
  const discontinued = new Set(readDurabilityTsv().filter((row) => row.discontinued).map((row) => row.beadId));

  const added: Resolved[] = [];
  const skipped = new Map<string, string[]>();
  for (const row of rows) {
    const resolved = resolveCatalogueBead(row, explicit, discontinued);
    if (only && !only.has(resolved.beadId)) continue;
    if ('skip' in resolved) {
      if (resolved.skip !== 'already on disk') (skipped.get(resolved.skip) ?? skipped.set(resolved.skip, []).get(resolved.skip)!).push(resolved.beadId);
      continue;
    }
    added.push(resolved);
  }

  console.log(`Catalogue Delica beads to add${dryRun ? ' (dry run)' : ''}: ${added.length}`);
  const perPrefix = new Map<string, number>();
  for (const entry of added) perPrefix.set(entry.row.prefix, (perPrefix.get(entry.row.prefix) ?? 0) + 1);
  console.log(`  by prefix: ${Array.from(perPrefix.entries()).map(([prefix, count]) => `${prefix} ${count}`).join(', ')}`);
  for (const [reason, ids] of skipped) console.log(`  skipped (${reason}): ${ids.length} ${ids.slice(0, 8).join(' ')}${ids.length > 8 ? ' …' : ''}`);

  if (dryRun) {
    for (const entry of added.slice(0, 5)) console.log(`  ${entry.beadId} (${entry.size}/0) ← ${path.basename(entry.crop)}; ${entry.metadataSource}`);
    return;
  }
  const registryRows: RegistryRow[] = [];
  for (const entry of added) {
    await writeOriginal(entry.crop, entry.size, entry.beadId);
    const beadDir = getBeadTypeDirectory(BEAD_TYPE, entry.size);
    fs.mkdirSync(beadDir, { recursive: true });
    fs.writeFileSync(path.join(beadDir, `${entry.beadId}.metadata.json`), `${JSON.stringify(entry.sidecar, null, 2)}\n`, 'utf-8');
    registryRows.push(registryRowFor(entry));
  }
  const { rows: merged, added: addedRows } = upsertRegistryRows(readRegistry(BEAD_TYPE), registryRows);
  writeRegistry(BEAD_TYPE, merged);
  console.log(`  wrote ${added.length} originals + sidecars, ${addedRows} registry rows`);
  console.log('\nNext: pnpm beads:miyuki:delica:sync -- --local-only (thumbnails, colours, metadata, aliases).');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nadd-delica-beads failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
