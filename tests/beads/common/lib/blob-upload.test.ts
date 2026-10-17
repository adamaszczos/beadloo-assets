import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ASSET_OUTPUTS_DIR is resolved when paths.ts loads, so the override must exist before the import
// below is evaluated; otherwise the manifest written by uploadBlobAssets lands in the real outputs/.
const { outputsDir, putCalls } = vi.hoisted(() => {
  const outputsDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'blob-outputs-'));
  process.env.BEAD_ASSETS_OUTPUTS_DIR = outputsDir;
  return { outputsDir, putCalls: [] as string[] };
});
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (pathname: string) => {
    putCalls.push(pathname);
    return { url: `https://blob/${pathname}` };
  }),
  list: vi.fn(async () => ({ blobs: [], cursor: undefined })),
}));

import { manifestRecordsAfterUpload, readBlobManifest, uploadBlobAssets, type BlobAssetRecord, type BlobDiff } from '../../../../scripts/beads/common/lib/blob.js';

function asset(name: string, dir: string): BlobAssetRecord {
  const localPath = path.join(dir, name);
  fs.writeFileSync(localPath, name);
  return { pathname: `beads/miyuki/round_rocailles/6/${name}`, localPath, sha256: `sha-${name}`, size: name.length };
}

describe('uploadBlobAssets', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-upload-'));
    putCalls.length = 0;
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outputsDir, { recursive: true, force: true });
    delete process.env.BEAD_ASSETS_OUTPUTS_DIR;
  });

  it('writes its manifest under the overridden outputs directory, never the repo outputs/', async () => {
    await uploadBlobAssets({ newAssets: [asset('1.jpg', dir)], changedAssets: [], unchangedAssets: [] }, 'miyuki-round_rocailles', { newOnly: true });
    expect(fs.existsSync(path.join(outputsDir, 'miyuki-round_rocailles-blob-manifest.json'))).toBe(true);
  });

  it('with newOnly uploads only assets the store lacks and leaves changed originals alone', async () => {
    const diff: BlobDiff = {
      newAssets: [asset('1.jpg', dir)],
      changedAssets: [asset('29.jpg', dir)],
      unchangedAssets: [asset('2422.jpg', dir)],
    };
    await uploadBlobAssets(diff, 'miyuki-round_rocailles', { newOnly: true });
    expect(putCalls).toEqual(['beads/miyuki/round_rocailles/6/1.jpg']);
  });

  it('without newOnly uploads new and changed assets', async () => {
    const diff: BlobDiff = {
      newAssets: [asset('1.jpg', dir)],
      changedAssets: [asset('29.jpg', dir)],
      unchangedAssets: [],
    };
    await uploadBlobAssets(diff, 'miyuki-round_rocailles');
    expect(putCalls).toEqual(['beads/miyuki/round_rocailles/6/1.jpg', 'beads/miyuki/round_rocailles/6/29.jpg']);
  });
});

describe('manifestRecordsAfterUpload', () => {
  const record = (name: string, sha256: string, size: number): BlobAssetRecord => ({ pathname: `beads/x/6/${name}`, localPath: `/tmp/${name}`, sha256, size });
  const diff: BlobDiff = {
    newAssets: [record('1.jpg', 'new', 10)],
    changedAssets: [record('29.jpg', 'local-edit', 20), record('30.jpg', 'local-edit', 30)],
    unchangedAssets: [record('2422.jpg', 'same', 40)],
  };

  it('keeps the stored hash of a changed original a new-only run skipped, so the next diff still sees the change', () => {
    const previous = { 'beads/x/6/29.jpg': { sha256: 'in-the-store', size: 20 } };
    expect(manifestRecordsAfterUpload(diff, previous, true).map((r) => [r.pathname, r.sha256])).toEqual([
      ['beads/x/6/1.jpg', 'new'],
      ['beads/x/6/29.jpg', 'in-the-store'],
      ['beads/x/6/2422.jpg', 'same'],
    ]);
  });

  it('records every uploaded asset when changed originals were uploaded too', () => {
    expect(manifestRecordsAfterUpload(diff, {}, false).map((r) => r.sha256)).toEqual(['new', 'local-edit', 'local-edit', 'same']);
  });
});

describe('readBlobManifest', () => {
  it('returns an empty manifest when the file does not exist', () => {
    expect(readBlobManifest(path.join(os.tmpdir(), 'does-not-exist.json'))).toEqual({});
  });
});
