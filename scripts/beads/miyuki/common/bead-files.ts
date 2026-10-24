/**
 * A Miyuki bead's files, shared by the adders: its sidecar (`beads/miyuki/<type>/<size>/<id>.metadata.json`)
 * and its original (`downloaded/miyuki/<type>/<size>/<id>.jpg`), and when a bead counts as already in
 * the library.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT, getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from '../../common/lib/paths.js';
import type { MiyukiBeadType } from './directory-products.js';
import { isMiyukiPhotoRow, registryKey, type RegistryRow } from './registry.js';

export type Sidecar = Record<string, string>;

/**
 * Whether the same colour's original at `donorSize` may stand in for it at `size`: another size, Miyuki's
 * own photo there (registry row), and the file on disk.
 */
export function isPhotoDonor(
  beadId: string,
  donorSize: string,
  size: string,
  registry: ReadonlyMap<string, RegistryRow>,
  originalExists: (size: string, beadId: string) => boolean,
): boolean {
  return donorSize !== size && isMiyukiPhotoRow(registry.get(registryKey(beadId, donorSize))) && originalExists(donorSize, beadId);
}

// ============================================================================
// Files
// ============================================================================

export function sidecarPath(beadType: MiyukiBeadType, size: string, beadId: string): string {
  return path.join(getBeadTypeDirectory(beadType, size), `${beadId}.metadata.json`);
}

export function originalPath(beadType: MiyukiBeadType, size: string, beadId: string): string {
  return path.join(getDownloadedBeadTypeDirectory(beadType, size), `${beadId}.jpg`);
}

export function readSidecar(beadType: MiyukiBeadType, size: string, beadId: string): Sidecar | null {
  const file = sidecarPath(beadType, size, beadId);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf-8')) as Sidecar) : null;
}

export function writeSidecar(beadType: MiyukiBeadType, size: string, beadId: string, sidecar: Readonly<Record<string, unknown>>): void {
  const file = sidecarPath(beadType, size, beadId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf-8');
}

/**
 * A bead is in the library once it has both its sidecar and its registry row. One with only one of
 * them was left by a run that stopped half way, and the adder that planned it writes it again.
 */
export function isInLibrary(beadType: MiyukiBeadType, size: string, beadId: string, registry: ReadonlyMap<string, RegistryRow>): boolean {
  return registry.has(registryKey(beadId, size)) && fs.existsSync(sidecarPath(beadType, size, beadId));
}

/** Makes room for an original: its folder, and a line when it replaces a file already there (never silently). */
export function prepareOriginalTarget(target: string): void {
  if (fs.existsSync(target)) console.log(`    replacing the original already at ${path.relative(ASSET_REPO_ROOT, target)}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
}
