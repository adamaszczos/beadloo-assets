import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT, BEADS_ROOT, DOWNLOADED_ROOT } from './lib/paths.js';

export interface SyncFromBeadlooResult {
  brand: string;
  type: string;
  totalMissing: number;
  copied: number;
}

export function syncMissingFromBeadloo(
  brand: string,
  type: string,
  options: { dryRun?: boolean; beadlooDir?: string } = {}
): SyncFromBeadlooResult {
  const dryRun = options.dryRun ?? false;
  const beadlooAppDir =
    options.beadlooDir || process.env.BEADLOO_DIR || path.resolve(ASSET_REPO_ROOT, '..', 'beadloo');

  const beadsDir = path.join(BEADS_ROOT, brand, type);
  const downloadedDir = path.join(DOWNLOADED_ROOT, brand, type);
  const beadlooPublicBeadsDir = path.join(beadlooAppDir, 'public', 'beads', brand, type);

  if (!fs.existsSync(beadsDir)) {
    return { brand, type, totalMissing: 0, copied: 0 };
  }

  const sizes = fs.readdirSync(beadsDir).filter((entry) =>
    fs.statSync(path.join(beadsDir, entry)).isDirectory()
  );

  let totalMissing = 0;
  let copied = 0;

  for (const size of sizes) {
    const sizeBeadsDir = path.join(beadsDir, size);
    const sizeDownloadedDir = path.join(downloadedDir, size);
    const sizeBeadlooDir = path.join(beadlooPublicBeadsDir, size);

    function walk(directory: string, relativePath = ''): void {
      const entries = fs.readdirSync(directory, { withFileTypes: true });

      for (const entry of entries) {
        const itemRelativePath = path.join(relativePath, entry.name);

        if (entry.isDirectory()) {
          walk(path.join(directory, entry.name), itemRelativePath);
          continue;
        }

        if (!entry.name.endsWith('.metadata.json')) {
          continue;
        }

        const stem = itemRelativePath.slice(0, -'.metadata.json'.length);

        let foundOriginal = false;
        for (const ext of ['.jpg', '.webp', '.png', '.jpeg']) {
          if (fs.existsSync(path.join(sizeDownloadedDir, `${stem}${ext}`))) {
            foundOriginal = true;
            break;
          }
        }

        if (foundOriginal) {
          continue;
        }

        totalMissing += 1;

        const candidateSourcePaths = [
          path.join(sizeBeadlooDir, `${stem}_48x48.jpg`),
          path.join(sizeBeadlooDir, `${stem}.jpg`),
          path.join(sizeBeadlooDir, `${stem}.webp`),
          path.join(sizeBeadlooDir, `${stem}_16x16.jpg`),
          path.join(sizeBeadsDir, `${stem}_48x48.jpg`),
          path.join(sizeBeadsDir, `${stem}_16x16.jpg`),
        ];

        const sourceFile = candidateSourcePaths.find((candidate) => fs.existsSync(candidate));

        if (!sourceFile) {
          console.warn(`[SYNC-BEADLOO] No miniature source found for ${brand}/${type}/${size}/${stem}`);
          continue;
        }

        const ext = sourceFile.endsWith('.webp') ? '.webp' : '.jpg';
        const destinationFile = path.join(sizeDownloadedDir, `${stem}${ext}`);

        if (dryRun) {
          console.log(`[DRY RUN] Would copy ${sourceFile} -> ${destinationFile}`);
        } else {
          fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
          fs.copyFileSync(sourceFile, destinationFile);
          console.log(`[SYNC-BEADLOO] Copied ${sourceFile} -> ${destinationFile}`);
        }

        copied += 1;
      }
    }

    walk(sizeBeadsDir);
  }

  return { brand, type, totalMissing, copied };
}
