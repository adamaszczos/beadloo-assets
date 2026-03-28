import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { list, put } from '@vercel/blob';
import { getBeadTypeDirectory, getBeadTypePublicPath, ASSET_OUTPUTS_DIR } from './paths.js';

// ============================================================================
// Types
// ============================================================================

export type BlobAssetRecord = {
  pathname: string;
  localPath: string;
  sha256: string;
  size: number;
};

export type BlobManifest = Record<string, { sha256: string; size: number }>;

export type BlobDiff = {
  newAssets: BlobAssetRecord[];
  changedAssets: BlobAssetRecord[];
  unchangedAssets: BlobAssetRecord[];
};

// ============================================================================
// Helpers
// ============================================================================

export function isOriginalBlobAssetFile(fileName: string): boolean {
  const normalized = fileName.toLowerCase();
  return (
    normalized.endsWith('.jpg') &&
    !normalized.endsWith('_16x16.jpg') &&
    !normalized.endsWith('_48x48.jpg')
  );
}

export function getBlobPrefix(beadType: string): string {
  return `beads/${getBeadTypePublicPath(beadType)}`;
}

export function getManifestPath(beadType: string): string {
  return path.join(ASSET_OUTPUTS_DIR, `${beadType}-blob-manifest.json`);
}

export function readBlobManifest(manifestPath: string): BlobManifest {
  if (!fs.existsSync(manifestPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as BlobManifest;
}

export function writeBlobManifest(manifestPath: string, records: BlobAssetRecord[]): void {
  const manifest: BlobManifest = Object.fromEntries(
    records.map((record) => [record.pathname, { sha256: record.sha256, size: record.size }])
  );
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

// ============================================================================
// Collection & Diff
// ============================================================================

export function collectLocalBlobAssets(beadType: string, sizes: string[]): BlobAssetRecord[] {
  const assets: BlobAssetRecord[] = [];
  const blobPrefix = getBlobPrefix(beadType);

  for (const size of sizes) {
    const sizeDir = getBeadTypeDirectory(beadType, size);
    if (!fs.existsSync(sizeDir)) {
      continue;
    }

    for (const file of fs.readdirSync(sizeDir)) {
      if (!isOriginalBlobAssetFile(file)) {
        continue;
      }

      const localPath = path.join(sizeDir, file);
      const content = fs.readFileSync(localPath);
      const relativePath = path.posix.join(blobPrefix, size, file);

      assets.push({
        pathname: relativePath,
        localPath,
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
        size: content.length,
      });
    }
  }

  return assets.sort((a, b) => a.pathname.localeCompare(b.pathname));
}

async function fetchRemoteBlobSizes(prefix: string): Promise<Map<string, number>> {
  const remote = new Map<string, number>();
  let cursor: string | undefined;

  do {
    const response = await list({
      prefix,
      cursor,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    for (const blob of response.blobs) {
      remote.set(blob.pathname, blob.size);
    }

    cursor = response.cursor;
  } while (cursor);

  return remote;
}

export async function calculateBlobDiff(beadType: string, sizes: string[]): Promise<BlobDiff> {
  const blobPrefix = getBlobPrefix(beadType);
  const manifestPath = getManifestPath(beadType);
  const localAssets = collectLocalBlobAssets(beadType, sizes);
  const manifest = readBlobManifest(manifestPath);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      newAssets: localAssets,
      changedAssets: [],
      unchangedAssets: [],
    };
  }

  const remoteSizes = await fetchRemoteBlobSizes(blobPrefix);
  const newAssets: BlobAssetRecord[] = [];
  const changedAssets: BlobAssetRecord[] = [];
  const unchangedAssets: BlobAssetRecord[] = [];

  for (const asset of localAssets) {
    const remoteSize = remoteSizes.get(asset.pathname);
    const manifestEntry = manifest[asset.pathname];

    if (remoteSize === undefined) {
      newAssets.push(asset);
      continue;
    }

    const sizeChanged = remoteSize !== asset.size;
    const hashChanged = manifestEntry ? manifestEntry.sha256 !== asset.sha256 : sizeChanged;

    if (sizeChanged || hashChanged) {
      changedAssets.push(asset);
    } else {
      unchangedAssets.push(asset);
    }
  }

  return { newAssets, changedAssets, unchangedAssets };
}

// ============================================================================
// Upload
// ============================================================================

export async function uploadBlobAssets(diff: BlobDiff, beadType: string): Promise<void> {
  const manifestPath = getManifestPath(beadType);
  const uploadQueue = [...diff.newAssets, ...diff.changedAssets];

  for (const asset of uploadQueue) {
    const content = fs.readFileSync(asset.localPath);
    await put(asset.pathname, content, {
      access: 'public',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    console.log(`  uploaded ${asset.pathname}`);
  }

  writeBlobManifest(manifestPath, [...diff.newAssets, ...diff.changedAssets, ...diff.unchangedAssets]);
}

// ============================================================================
// Reporting
// ============================================================================

export function reportBlobDiff(diff: BlobDiff): void {
  console.log(`\nBlob diff`);
  console.log(`  new assets:       ${diff.newAssets.length}`);
  console.log(`  changed assets:   ${diff.changedAssets.length}`);
  console.log(`  unchanged assets: ${diff.unchangedAssets.length}`);
}
