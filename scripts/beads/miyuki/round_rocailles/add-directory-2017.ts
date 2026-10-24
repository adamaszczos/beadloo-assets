#!/usr/bin/env tsx
/**
 * Adds the round rocailles Miyuki's 2017 directory photographed and Beadloo lacks (issue #203, batch e).
 *
 * The 2017 directory offered its product photos as one archive per bead type
 * (`sources/miyuki/directory-2017.csv` lists every photo, `<size>-<number>.jpg` per size folder). A
 * photo is Miyuki's own picture of a colour at a size, so it proves both and serves as the image.
 *
 * - a number Miyuki's old/new colour table renames (`1254` → `2001`) is the same bead under an old
 *   number: it is reported, never added (the alias tables carry it);
 * - image: the 2017 photo itself, colour accuracy `photo`, registry source `directory-historical`;
 *   the photo must be on disk with the SHA-256 the list records, or the bead is not planned;
 * - metadata: the same number's sidecar at another size, else the base number's (`406L` ← `406`;
 *   `L` is "Light" in Miyuki's colour-number key, a lighter shade of the same glass and finish).
 *
 * Usage: pnpm beads:miyuki:round_rocailles:add-directory-2017 [--dry-run]
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT, getMiyukiDirectory2017Directory } from '../../common/lib/paths.js';
import { readRegistry, registryKey, todayIso, writeBeadsAndRegistry, type RegistryRow } from '../common/registry.js';
import { parseCsv } from '../common/csv.js';
import { readColorChangeTsv, renumbering } from '../common/official-lists.js';
import { isInLibrary, originalPath, prepareOriginalTarget, readSidecar, writeSidecar, type Sidecar } from '../common/bead-files.js';
import { isRoundRocailleId, isRoundRocailleSize } from '../common/round-rocaille-ids.js';
import { DONOR_SIZES, buildRoundRocailleSidecar } from '../catalogue/add-round-rocaille-beads.js';

const BEAD_TYPE = 'miyuki-round_rocailles' as const;
const LIST = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'directory-2017.csv');
const PHOTOS = getMiyukiDirectory2017Directory('rr', 'Round Rocailles');

/** `Size 11/11-406L.jpg` → `{ size: '11', beadId: '406L' }`; the `6S` folder holds square-hole colours. */
export function parse2017Photo(file: string): { size: string; beadId: string } | null {
  const match = /^Size (\d+)(S?)\/\d+S?-([0-9A-Za-z]+)\.jpg$/i.exec(file);
  if (!match) return null;
  const number = match[3].toUpperCase();
  return { size: match[1], beadId: match[2] ? `${number}SH` : number };
}

/** The base number of a suffixed colour (`406L` → `406`), for its attributes. */
export function baseNumber(beadId: string): string | null {
  const match = /^(\d+)[LD]$/.exec(beadId);
  return match ? match[1] : null;
}

type Donor = { sidecar: Sidecar; source: string };

function donorFor(beadId: string, size: string, sidecar: (size: string, beadId: string) => Sidecar | null): Donor | null {
  for (const id of [beadId, baseNumber(beadId)].filter((v): v is string => Boolean(v))) {
    for (const donorSize of [size, ...DONOR_SIZES]) {
      if (id === beadId && donorSize === size) continue;
      const found = sidecar(donorSize, id);
      if (found) return { sidecar: found, source: id === beadId ? `attributes of ${id} at ${donorSize}/0` : `attributes of ${id} at ${donorSize}/0 (${beadId} is its light/dark shade in Miyuki's colour-number key)` };
    }
  }
  return null;
}

export type Planned2017Bead = { beadId: string; size: string; file: string; sha256: string; sidecar: Sidecar; source: string };

/**
 * The 2017 photos to add: a round-rocaille number at a library size (`131S`, `148R` are not), not yet in
 * the library, not an old number of a current bead, with a metadata donor, and the photo on disk as the
 * list recorded it (`photoProblem` names what is wrong with it).
 */
export function plan2017Beads(
  rows: ReadonlyArray<Record<string, string>>,
  library: {
    inLibrary: (beadId: string, size: string) => boolean;
    renumberedTo: (beadId: string) => string | null;
    sidecar: (size: string, beadId: string) => Sidecar | null;
    photoProblem: (file: string, sha256: string) => string | null;
  },
): { planned: Planned2017Bead[]; notRoundRocaille: string[]; aliases: string[]; noMetadata: string[]; badPhotos: string[] } {
  const planned: Planned2017Bead[] = [];
  const notRoundRocaille: string[] = [];
  const aliases: string[] = [];
  const noMetadata: string[] = [];
  const badPhotos: string[] = [];
  for (const row of rows) {
    const parsed = parse2017Photo(row.file);
    if (!parsed) continue;
    if (!isRoundRocailleId(parsed.beadId) || !isRoundRocailleSize(parsed.size)) { notRoundRocaille.push(row.file); continue; }
    if (library.inLibrary(parsed.beadId, parsed.size)) continue;
    const unified = library.renumberedTo(parsed.beadId);
    if (unified) { aliases.push(`${parsed.beadId}@${parsed.size} → ${unified}`); continue; }
    const donor = donorFor(parsed.beadId, parsed.size, library.sidecar);
    if (!donor) { noMetadata.push(`${parsed.beadId}@${parsed.size}`); continue; }
    const problem = library.photoProblem(row.file, row.sha256);
    if (problem) { badPhotos.push(`${parsed.beadId}@${parsed.size} (${problem})`); continue; }
    const sidecar = buildRoundRocailleSidecar(parsed.size, donor.sidecar, { squareHole: parsed.beadId.endsWith('SH'), colorAccuracy: 'photo', keepColorGroup: false });
    planned.push({ ...parsed, file: row.file, sha256: row.sha256, sidecar, source: donor.source });
  }
  return { planned, notRoundRocaille, aliases, noMetadata, badPhotos };
}

export function directory2017RegistryRow(entry: Planned2017Bead, addedOn = todayIso()): RegistryRow {
  return {
    beadId: entry.beadId,
    size: entry.size,
    listingSource: 'directory-historical',
    imageSource: 'directory-historical',
    sizeSource: 'directory-historical',
    colorAccuracy: 'photo',
    sourceRef: `Miyuki's 2017 directory image archive Round-Rocailles.zip, "${entry.file}" (sha256 ${entry.sha256.slice(0, 16)}…); metadata: ${entry.source}`,
    addedOn,
  };
}

/** What is wrong with a listed photo on disk (missing, or other bytes than the list recorded), or null. */
function photoProblem(file: string, sha256: string): string | null {
  const photo = path.join(PHOTOS, file);
  if (!fs.existsSync(photo)) return `no ${path.relative(ASSET_REPO_ROOT, photo)}; unpack Round-Rocailles.zip there`;
  const actual = createHash('sha256').update(fs.readFileSync(photo)).digest('hex');
  return actual === sha256 ? null : `sha256 ${actual.slice(0, 16)}… is not the listed ${sha256.slice(0, 16)}…`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const registry = new Map(readRegistry(BEAD_TYPE).map((row) => [registryKey(row.beadId, row.size), row]));
  const rows = parseCsv(fs.readFileSync(LIST, 'utf-8')).filter((row) => row.type === 'round_rocailles');
  const { planned, notRoundRocaille, aliases, noMetadata, badPhotos } = plan2017Beads(rows, {
    inLibrary: (beadId, size) => isInLibrary(BEAD_TYPE, size, beadId, registry),
    renumberedTo: renumbering(readColorChangeTsv()),
    sidecar: (size, beadId) => readSidecar(BEAD_TYPE, size, beadId),
    photoProblem,
  });
  console.log(`2017 directory photos without a bead: ${planned.length + notRoundRocaille.length + aliases.length + noMetadata.length + badPhotos.length}`);
  if (notRoundRocaille.length) console.log(`  not a round-rocaille number at a library size (not added): ${notRoundRocaille.join(', ')}`);
  console.log(`  old numbers of current beads (alias tables, not added): ${aliases.join(', ') || 'none'}`);
  console.log(`  no metadata source (not added): ${noMetadata.join(', ') || 'none'}`);
  if (badPhotos.length) console.log(`  photo missing or not the listed file (not added): ${badPhotos.join(', ')}`);
  console.log(`  to add${dryRun ? ' (dry run)' : ''}: ${planned.map((a) => `${a.beadId}@${a.size} (${a.source})`).join(', ') || 'none'}`);
  if (dryRun || planned.length === 0) return;
  const added = await writeBeadsAndRegistry(BEAD_TYPE, planned, (entry) => {
    const target = originalPath(BEAD_TYPE, entry.size, entry.beadId);
    prepareOriginalTarget(target);
    fs.copyFileSync(path.join(PHOTOS, entry.file), target);
    writeSidecar(BEAD_TYPE, entry.size, entry.beadId, entry.sidecar);
    return directory2017RegistryRow(entry);
  });
  console.log(`  wrote ${planned.length} originals + sidecars, ${added} registry rows`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nadd-directory-2017 failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
