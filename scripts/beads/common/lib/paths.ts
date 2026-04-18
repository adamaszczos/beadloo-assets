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

export interface GeneratedMetadataFile {
  beadType: string;
  size: string;
  filePath: string;
}

const KNOWN_BEAD_TYPE_SEGMENTS: Record<string, string[]> = {
  'miyuki-delica': ['miyuki', 'delica'],
  'miyuki-round_rocailles': ['miyuki', 'round_rocailles'],
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

export function getGeneratedBeadTypeDataDirectory(
  beadType: string,
  dataRoot: string = GENERATED_DATA_DIR,
  ...segments: string[]
): string {
  return path.join(dataRoot, ...getBeadTypeSegments(beadType), ...segments);
}

export function getGeneratedColorDataPath(
  beadType: string,
  size: string,
  dataRoot: string = GENERATED_DATA_DIR
): string {
  return getGeneratedBeadTypeDataDirectory(beadType, dataRoot, `${size}-colors.json`);
}

export function getGeneratedMetadataDataPath(
  beadType: string,
  size: string,
  dataRoot: string = GENERATED_DATA_DIR
): string {
  return getGeneratedBeadTypeDataDirectory(beadType, dataRoot, `${size}-metadata.json`);
}

export function getGeneratedMetadataImportPath(beadType: string, size: string): string {
  return `./${getBeadTypePublicPath(beadType)}/${size}-metadata.json`;
}

export function discoverGeneratedMetadataFiles(
  dataRoot: string = GENERATED_DATA_DIR
): GeneratedMetadataFile[] {
  const discovered: GeneratedMetadataFile[] = [];

  if (!fs.existsSync(dataRoot)) {
    return discovered;
  }

  function walk(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      const match = entry.name.match(/^(.+)-metadata\.json$/);
      if (!match) {
        continue;
      }

      const relativeDirectory = path.relative(dataRoot, path.dirname(entryPath));
      const segments = relativeDirectory === '' ? [] : relativeDirectory.split(path.sep).filter(Boolean);

      if (segments.length === 0) {
        continue;
      }

      discovered.push({
        beadType: segments.join('-'),
        size: match[1],
        filePath: entryPath,
      });
    }
  }

  walk(dataRoot);

  return discovered.sort((left, right) => {
    if (left.beadType !== right.beadType) {
      return left.beadType.localeCompare(right.beadType);
    }

    return Number(left.size) - Number(right.size);
  });
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
