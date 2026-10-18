#!/usr/bin/env tsx
/**
 * Miyuki Delica Bead Sync Script
 *
 * Full local pipeline:
 * 1. Read the committed directory dump (`pnpm beads:miyuki:directory -- --fetch` refreshes it) and
 *    download the originals of listings Beadloo does not have yet, from the image URL the Store API
 *    gave for the product (nothing is guessed)
 * 2. Write the metadata sidecar of every bead that lacks one, from the product's attribute terms
 * 3. Record each added bead in `sources/miyuki/registry/delica.csv`
 * 4. Generate 16×16 (single-bead render) and 48×48 thumbnails
 * 5. Extract dominant colors and rebuild color datasets
 * 6. Generate consolidated metadata
 * 7. Validate output files
 *
 * Matte and lined finishes (`*F`, `*L`) sometimes come back as a 48×48 placeholder instead of the
 * original; such a download is discarded and reported, never kept as an original.
 *
 * Usage:
 *   pnpm beads:miyuki:delica:sync                      Full pipeline (dump + download + build)
 *   pnpm beads:miyuki:delica:sync -- --local-only      Skip downloading, rebuild local data only
 *   pnpm beads:miyuki:delica:sync -- --dry-run         Report what would change without writing files
 *   pnpm beads:miyuki:delica:sync -- --force           Force-regenerate thumbnails
 *   pnpm beads:miyuki:delica:sync -- --sizes 11,15     Limit to specific sizes
 *   pnpm beads:miyuki:delica:sync -- --dump <path>     Use another dump file
 *   pnpm beads:miyuki:delica:sync -- --verbose         Detailed output
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from '../../common/lib/paths.js';
import { extractColors } from '../../common/extract-colors.js';
import { generateMetadata } from '../../common/generate-metadata.js';
import { validateBeadType } from '../../common/validate-bead-type.js';
import { generateDerivatives, type MiyukiOverlayInfo } from '../../common/lib/thumbnails.js';
import { loadDirectoryListings } from '../common/directory-catalog.js';
import { generateAliasFiles } from '../common/aliases.js';
import type { DirectoryListing } from '../common/directory-products.js';
import {
  REQUEST_DELAY_MS,
  delay,
  describeListings,
  downloadImage,
  findNewListings,
  getKnownBeadIds,
  hasSidecar,
  isOriginalImageFile,
  recordDirectoryListings,
  writeSidecarFromListing,
} from '../common/sync-pipeline.js';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// Types
// ============================================================================

export type SyncOptions = {
  sizes: string[];
  dryRun: boolean;
  verbose: boolean;
  localOnly: boolean;
  force: boolean;
  dumpPath?: string;
};

type SyncSummary = {
  listed: number;
  downloaded: number;
  discardedPlaceholders: number;
  sidecarsWritten: number;
  registryRowsAdded: number;
  conflicts: number;
  derivativesGenerated: number;
  colorsRebuilt: number;
};

// ============================================================================
// Configuration
// ============================================================================

const BEAD_TYPE = 'miyuki-delica' as const;
const DELICA_DIR = getBeadTypeDirectory(BEAD_TYPE);
const DELICA_DOWNLOADED_DIR = getDownloadedBeadTypeDirectory(BEAD_TYPE);
export const VALID_SIZES = ['8', '10', '11', '15'];
/** A real original is far larger than the 48×48 placeholder the directory serves for some matte finishes. */
const MIN_ORIGINAL_BYTES = 5000;

// ============================================================================
// Helpers
// ============================================================================

export async function isUndersizedOriginal(imagePath: string): Promise<boolean> {
  try {
    const metadata = await sharp(imagePath).metadata();
    return (metadata.width ?? 0) <= 100 && (metadata.height ?? 0) <= 100;
  } catch {
    return false;
  }
}

// ============================================================================
// Step 1: directory dump → downloads, sidecars, registry
// ============================================================================

async function syncFromDirectory(options: SyncOptions, summary: SyncSummary): Promise<void> {
  const { listings, conflicts } = loadDirectoryListings(BEAD_TYPE, { dumpPath: options.dumpPath });
  summary.listed = listings.length;
  summary.conflicts = conflicts.length;

  console.log(`Directory dump: ${listings.length} Delica listings`);
  for (const listing of conflicts) {
    console.warn(`  skipped (name/prefix conflict): ${listing.name} [${listing.sku}]: ${listing.conflicts.join('; ')}`);
  }

  const added: DirectoryListing[] = [];
  for (const size of options.sizes) {
    const known = getKnownBeadIds(BEAD_TYPE, size, MIN_ORIGINAL_BYTES);
    const fresh = findNewListings(listings, size, known);
    console.log(`  Size ${size}: ${known.size} known, ${listings.filter((l) => l.size === size).length} listed, ${fresh.length} new${fresh.length ? ` (${describeListings(fresh)})` : ''}`);
    if (options.dryRun) continue;

    for (const listing of fresh) {
      if (!listing.imageUrl) {
        console.warn(`    ${listing.beadId}: the directory lists no image; held out`);
        continue;
      }
      const outputPath = path.join(DELICA_DOWNLOADED_DIR, size, `${listing.beadId}.jpg`);
      try {
        await downloadImage(listing.imageUrl, outputPath);
        if (await isUndersizedOriginal(outputPath)) {
          fs.unlinkSync(outputPath);
          summary.discardedPlaceholders += 1;
          console.warn(`    ${listing.beadId}: the directory served a placeholder (≤100 px); discarded, try again later`);
        } else {
          summary.downloaded += 1;
          if (options.verbose) console.log(`    downloaded ${listing.beadId} ← ${listing.imageUrl}`);
          added.push(listing);
        }
      } catch (error) {
        console.warn(`    failed ${listing.beadId}: ${error instanceof Error ? error.message : error}`);
      }
      await delay(REQUEST_DELAY_MS);
    }
  }

  if (options.dryRun) return;

  for (const listing of listings) {
    if (!options.sizes.includes(listing.size)) continue;
    if (hasSidecar(BEAD_TYPE, listing.size, listing.beadId)) continue;
    if (!fs.existsSync(path.join(DELICA_DOWNLOADED_DIR, listing.size, `${listing.beadId}.jpg`))) continue;
    if (writeSidecarFromListing(BEAD_TYPE, listing) === 'written') summary.sidecarsWritten += 1;
  }

  summary.registryRowsAdded = recordDirectoryListings(BEAD_TYPE, added);
}

// ============================================================================
// Build Pipeline (thumbnails, colors, metadata)
// ============================================================================

function readMetadataSidecar(filePath: string): MiyukiOverlayInfo | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MiyukiOverlayInfo;
  } catch {
    return undefined;
  }
}

async function generateThumbnailsForSize(size: string, force: boolean, verbose: boolean): Promise<number> {
  const downloadedSizeDir = path.join(DELICA_DOWNLOADED_DIR, size);
  if (!fs.existsSync(downloadedSizeDir)) return 0;

  const outputSizeDir = path.join(DELICA_DIR, size);
  fs.mkdirSync(outputSizeDir, { recursive: true });

  let generated = 0;
  for (const file of fs.readdirSync(downloadedSizeDir).filter(isOriginalImageFile)) {
    const sourcePath = path.join(downloadedSizeDir, file);
    const overlay = readMetadataSidecar(path.join(outputSizeDir, file.replace(/\.jpe?g$/i, '.metadata.json')));
    try {
      const result = await generateDerivatives(sourcePath, { force, overlay, outputDir: outputSizeDir });
      const count = Number(result.generated16) + Number(result.generated48);
      generated += count;
      if (verbose && count > 0) console.log(`    Generated derivatives for ${file}`);
    } catch (error) {
      console.warn(`    Failed derivatives for ${file}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return generated;
}

async function rebuildSizeData(size: string, options: SyncOptions, summary: SyncSummary): Promise<void> {
  if (!options.dryRun) {
    const extractionResult = await extractColors({
      beadType: BEAD_TYPE,
      size,
      inputDir: path.join(DELICA_DIR, size),
      originalDir: path.join(DELICA_DOWNLOADED_DIR, size),
      verbose: options.verbose,
    });
    if (!extractionResult.success) {
      throw new Error(`Color extraction failed for Miyuki Delica ${size}/0`);
    }
  }
  summary.colorsRebuilt += 1;
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function runMiyukiDelicaSync(options: SyncOptions): Promise<SyncSummary> {
  const summary: SyncSummary = {
    listed: 0,
    downloaded: 0,
    discardedPlaceholders: 0,
    sidecarsWritten: 0,
    registryRowsAdded: 0,
    conflicts: 0,
    derivativesGenerated: 0,
    colorsRebuilt: 0,
  };

  if (!options.localOnly) {
    await syncFromDirectory(options, summary);
  }

  console.log('\nGenerating thumbnails...');
  for (const size of options.sizes) {
    const generated = options.dryRun ? 0 : await generateThumbnailsForSize(size, options.force, options.verbose);
    summary.derivativesGenerated += generated;
    console.log(`  Size ${size}: ${generated} derivatives generated`);
  }

  console.log('\nExtracting colors...');
  for (const size of options.sizes) {
    await rebuildSizeData(size, options, summary);
  }

  if (!options.dryRun) {
    console.log('\nGenerating consolidated metadata...');
    const metaResult = await generateMetadata({ beadType: BEAD_TYPE, sizes: options.sizes, inputDir: DELICA_DIR, verbose: options.verbose });
    if (!metaResult.success) throw new Error('Metadata generation failed');

    console.log('\nRegenerating alias files...');
    generateAliasFiles({ verbose: options.verbose });

    console.log('\nValidating output files...');
    const validation = validateBeadType({ beadType: BEAD_TYPE });
    if (!validation.success) console.warn('Validation reported issues — check output above');
  }

  return summary;
}

// ============================================================================
// CLI
// ============================================================================

export function parseArgs(argv: string[]): SyncOptions {
  const sizesArgIndex = argv.indexOf('--sizes');
  const requestedSizes =
    sizesArgIndex >= 0 && argv[sizesArgIndex + 1]
      ? argv[sizesArgIndex + 1].split(',').map((v) => v.trim()).filter((v) => VALID_SIZES.includes(v))
      : [...VALID_SIZES];
  const dumpArgIndex = argv.indexOf('--dump');
  return {
    sizes: requestedSizes,
    dryRun: argv.includes('--dry-run'),
    verbose: argv.includes('--verbose'),
    localOnly: argv.includes('--local-only'),
    force: argv.includes('--force'),
    ...(dumpArgIndex >= 0 && argv[dumpArgIndex + 1] ? { dumpPath: argv[dumpArgIndex + 1] } : {}),
  };
}

function printUsage(): void {
  console.log(`Usage: tsx scripts/beads/miyuki/delica/sync.ts [options]

Options:
  --local-only    Skip the directory dump and downloads, rebuild local data only
  --sizes 11,15   Limit processing to specific sizes (default: all)
  --dry-run       Report what would change without writing files
  --force         Force-regenerate thumbnails even when up to date
  --dump <path>   Read another directory dump (default: sources/miyuki/directory/products.json)
  --verbose       Print detailed progress
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    printUsage();
    return;
  }

  const options = parseArgs(argv);
  console.log('\n' + '='.repeat(70));
  console.log('MIYUKI DELICA SYNC');
  console.log('='.repeat(70));

  const startedAt = Date.now();
  const summary = await runMiyukiDelicaSync(options);

  console.log(`\nMiyuki Delica sync summary`);
  console.log(`  sizes processed:        ${options.sizes.join(', ')}`);
  console.log(`  directory listings:     ${summary.listed}`);
  console.log(`  downloaded images:      ${summary.downloaded}`);
  console.log(`  discarded placeholders: ${summary.discardedPlaceholders}`);
  console.log(`  sidecars written:       ${summary.sidecarsWritten}`);
  console.log(`  registry rows added:    ${summary.registryRowsAdded}`);
  console.log(`  name/prefix conflicts:  ${summary.conflicts}`);
  console.log(`  derivatives generated:  ${summary.derivativesGenerated}`);
  console.log(`  color datasets rebuilt: ${summary.colorsRebuilt}`);
  console.log(`\nCompleted in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nMiyuki Delica sync failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
