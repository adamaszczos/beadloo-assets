import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from './lib/paths.js';

const DELICA_DOWNLOADED = getDownloadedBeadTypeDirectory('miyuki-delica');
const DELICA_BEADS = getBeadTypeDirectory('miyuki-delica');

async function main(): Promise<void> {
  const sizes = fs.readdirSync(DELICA_DOWNLOADED).filter((s) =>
    fs.statSync(path.join(DELICA_DOWNLOADED, s)).isDirectory()
  );

  const smallImages: Array<{
    size: string;
    file: string;
    beadId: string;
    dimensions: string;
    finish?: string;
    glassGroup?: string;
    colorGroup?: string;
  }> = [];

  for (const size of sizes) {
    const downloadedSizeDir = path.join(DELICA_DOWNLOADED, size);
    const beadsSizeDir = path.join(DELICA_BEADS, size);

    const files = fs.readdirSync(downloadedSizeDir).filter(
      (f) => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp')
    );

    for (const file of files) {
      const fullPath = path.join(downloadedSizeDir, file);
      const meta = await sharp(fullPath).metadata();

      if ((meta.width ?? 0) <= 100 && (meta.height ?? 0) <= 100) {
        const beadId = path.basename(file, path.extname(file));
        const sidecarPath = path.join(beadsSizeDir, `${beadId}.metadata.json`);
        let sidecar: Record<string, string> | null = null;
        if (fs.existsSync(sidecarPath)) {
          sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
        }
        smallImages.push({
          size,
          file,
          beadId,
          dimensions: `${meta.width}x${meta.height}`,
          finish: sidecar?.finish,
          glassGroup: sidecar?.glassGroup,
          colorGroup: sidecar?.colorGroup,
        });
      }
    }
  }

  console.log(`Found ${smallImages.length} undersized images (<=100px) in downloaded/miyuki/delica:\n`);
  console.log(JSON.stringify(smallImages, null, 2));
}

main().catch(console.error);
