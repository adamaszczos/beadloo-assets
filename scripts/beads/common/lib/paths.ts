import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ASSET_REPO_ROOT = path.resolve(__dirname, '../../../..');
export const BEADS_ROOT = path.join(ASSET_REPO_ROOT, 'beads');
export const DOWNLOADED_ROOT = path.join(ASSET_REPO_ROOT, 'downloaded');
export const GENERATED_ROOT = path.join(ASSET_REPO_ROOT, 'generated');
export const GENERATED_DATA_DIR = process.env.BEAD_ASSETS_DATA_DIR
  ? path.resolve(ASSET_REPO_ROOT, process.env.BEAD_ASSETS_DATA_DIR)
  : path.join(GENERATED_ROOT, 'data');
export const ASSET_OUTPUTS_DIR = process.env.BEAD_ASSETS_OUTPUTS_DIR
  ? path.resolve(ASSET_REPO_ROOT, process.env.BEAD_ASSETS_OUTPUTS_DIR)
  : path.join(ASSET_REPO_ROOT, 'outputs');

const KNOWN_BEAD_TYPE_SEGMENTS: Record<string, string[]> = {
  'miyuki-delica': ['miyuki', 'delica'],
  'toho-round': ['toho', 'round'],
};

export function getBeadTypeSegments(beadType: string): string[] {
  return KNOWN_BEAD_TYPE_SEGMENTS[beadType] ?? beadType.split('-').filter(Boolean);
}

export function getBeadTypePublicPath(beadType: string): string {
  return getBeadTypeSegments(beadType).join('/');
}

export function getBeadTypeDirectory(beadType: string, ...segments: string[]): string {
  return path.join(BEADS_ROOT, ...getBeadTypeSegments(beadType), ...segments);
}

export function getDownloadedBeadTypeDirectory(beadType: string, ...segments: string[]): string {
  return path.join(DOWNLOADED_ROOT, ...getBeadTypeSegments(beadType), ...segments);
}

export function discoverBeadTypesOnDisk(): string[] {
  if (!fs.existsSync(BEADS_ROOT)) {
    return [];
  }

  const discovered = new Set<string>();

  for (const companyEntry of fs.readdirSync(BEADS_ROOT, { withFileTypes: true })) {
    if (!companyEntry.isDirectory()) {
      continue;
    }

    const companyDir = path.join(BEADS_ROOT, companyEntry.name);
    for (const typeEntry of fs.readdirSync(companyDir, { withFileTypes: true })) {
      if (typeEntry.isDirectory()) {
        discovered.add(`${companyEntry.name}-${typeEntry.name}`);
      }
    }
  }

  return Array.from(discovered).sort();
}
