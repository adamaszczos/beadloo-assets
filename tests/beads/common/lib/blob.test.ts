import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectLocalBlobAssets } from '../../../../scripts/beads/common/lib/blob.js';
import {
  getBeadTypeDirectory,
  getDownloadedBeadTypeDirectory,
} from '../../../../scripts/beads/common/lib/paths.js';

const TEST_BEAD_TYPE = 'vitest-blob-assets';

function cleanupTestDirectories(): void {
  fs.rmSync(getDownloadedBeadTypeDirectory(TEST_BEAD_TYPE), { recursive: true, force: true });
  fs.rmSync(getBeadTypeDirectory(TEST_BEAD_TYPE), { recursive: true, force: true });
}

describe('collectLocalBlobAssets', () => {
  beforeEach(() => {
    cleanupTestDirectories();
  });

  afterEach(() => {
    cleanupTestDirectories();
  });

  it('reads original JPGs from downloaded directories and keeps beads-prefixed blob paths', () => {
    const downloadedSizeDir = getDownloadedBeadTypeDirectory(TEST_BEAD_TYPE, '11');
    const beadSizeDir = getBeadTypeDirectory(TEST_BEAD_TYPE, '11');

    fs.mkdirSync(downloadedSizeDir, { recursive: true });
    fs.mkdirSync(beadSizeDir, { recursive: true });

    const originalContent = Buffer.from('original-image-content');
    const originalPath = path.join(downloadedSizeDir, 'DB0001.jpg');

    fs.writeFileSync(originalPath, originalContent);
    fs.writeFileSync(path.join(downloadedSizeDir, 'DB0001_16x16.jpg'), Buffer.from('thumb-16'));
    fs.writeFileSync(path.join(downloadedSizeDir, 'DB0001_48x48.jpg'), Buffer.from('thumb-48'));
    fs.writeFileSync(path.join(downloadedSizeDir, 'DB0001.png'), Buffer.from('not-a-jpg'));
    fs.writeFileSync(path.join(beadSizeDir, 'DB9999.jpg'), Buffer.from('wrong-source'));

    expect(collectLocalBlobAssets(TEST_BEAD_TYPE, ['11', '15'])).toEqual([
      {
        pathname: 'beads/vitest/blob/assets/11/DB0001.jpg',
        localPath: originalPath,
        sha256: crypto.createHash('sha256').update(originalContent).digest('hex'),
        size: originalContent.length,
      },
    ]);
  });
});
