#!/usr/bin/env tsx
/**
 * Miyuki Round Rocailles Bead Sync Script
 *
 * Full local pipeline:
 * 1. Scrape bead listings from the official Miyuki directory
 * 2. Download missing bead images
 * 3. Scrape metadata for beads missing .metadata.json sidecars
 * 4. Generate 16×16 (with SVG overlay) and 48×48 thumbnails
 * 5. Extract dominant colors and rebuild color datasets
 * 6. Generate consolidated metadata
 * 7. Validate output files
 *
 * Usage:
 *   pnpm beads:miyuki:round_rocailles:sync               Full pipeline (scrape + download + build)
 *   pnpm beads:miyuki:round_rocailles:sync --local-only   Skip scraping/downloading, rebuild local data only
 *   pnpm beads:miyuki:round_rocailles:sync --dry-run      Report what would change without writing files
 *   pnpm beads:miyuki:round_rocailles:sync --force         Force-regenerate thumbnails
 *   pnpm beads:miyuki:round_rocailles:sync --sizes 11,15   Limit to specific sizes
 *   pnpm beads:miyuki:round_rocailles:sync --verbose        Detailed output
 */

import * as fs from 'fs';
import * as path from 'path';
import { GENERATED_DATA_DIR, getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from '../../common/lib/paths.js';
import { extractColors } from '../../common/extract-colors.js';
import { generateMetadata } from '../../common/generate-metadata.js';
import { validateBeadType } from '../../common/validate-bead-type.js';
import { findBeadsWithoutMetadata, scrapeMultipleBeads } from '../common/scrape-metadata.js';
import { generateDerivatives, type MiyukiOverlayInfo } from '../../common/lib/thumbnails.js';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// Types
// ============================================================================

interface BeadListing {
  beadId: string;
  size: string;
  name: string;
  imageUrl?: string;
}

type SyncOptions = {
  sizes: string[];
  dryRun: boolean;
  verbose: boolean;
  localOnly: boolean;
  force: boolean;
};

type SyncSummary = {
  scraped: number;
  downloaded: number;
  metadataScraped: number;
  derivativesGenerated: number;
  colorsRebuilt: number;
};

// ============================================================================
// Configuration
// ============================================================================

const MIYUKI_BASE_URL = 'https://www.miyuki-beads.co.jp';
const DIRECTORY_URL = `${MIYUKI_BASE_URL}/directory/shop/`;
const REQUEST_DELAY_MS = 1500;

const RR_DIR = getBeadTypeDirectory('miyuki-round_rocailles');
const RR_DOWNLOADED_DIR = getDownloadedBeadTypeDirectory('miyuki-round_rocailles');
const BEAD_TYPE = 'miyuki-round_rocailles';

const SIZE_CONFIG = [
  { size: '2', filter: '2-0' },
  { size: '5', filter: '5-0' },
  { size: '6', filter: '6-0' },
  { size: '8', filter: '8-0' },
  { size: '11', filter: '11-0' },
  { size: '15', filter: '15-0' },
];

const VALID_SIZES = SIZE_CONFIG.map((c) => c.size);

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;

// ============================================================================
// Helper Functions
// ============================================================================

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError && (error as Error).message === 'fetch failed') return true;
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('ECONNRESET') || msg.includes('UND_ERR_SOCKET') || msg.includes('other side closed');
}

/**
 * Parses a Round Rocailles product name into bead ID and size.
 * Examples:
 *   "#1 Round Rocailles 15/0"   → { beadId: "1", size: "15" }
 *   "#1F Round Rocailles 15/0"  → { beadId: "1F", size: "15" }
 *   "#3201 Round Rocailles 2/0" → { beadId: "3201", size: "2" }
 *   "#5D Round Rocailles 15/0"  → { beadId: "5D", size: "15" }
 */
export function parseBeadName(name: string): { beadId: string; size: string } | null {
  const match = name.match(/^#(\d+[A-Z]*)\s+Round\s+Rocailles\s+(\d+)\/0/i);
  if (!match) {
    return null;
  }
  const beadId = match[1].toUpperCase();
  const size = match[2];
  return { beadId, size };
}

export async function fetchHtml(url: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (response.status === 404) {
        return ''; // treat 404 as empty page (end of pagination)
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.text();
    } catch (error) {
      if (attempt < MAX_RETRIES && isTransientError(error)) {
        const backoff = RETRY_BASE_DELAY_MS * attempt;
        console.warn(`    Transient error, retrying in ${backoff}ms (attempt ${attempt}/${MAX_RETRIES})...`);
        await delay(backoff);
        continue;
      }
      throw error;
    }
  }
  return ''; // unreachable, but satisfies TS
}

async function downloadImage(url: string, outputPath: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.from(buffer));
      return;
    } catch (error) {
      if (attempt < MAX_RETRIES && isTransientError(error)) {
        const backoff = RETRY_BASE_DELAY_MS * attempt;
        console.warn(`    Transient error downloading, retrying in ${backoff}ms (attempt ${attempt}/${MAX_RETRIES})...`);
        await delay(backoff);
        continue;
      }
      throw error;
    }
  }
}

// ============================================================================
// Directory Scraping
// ============================================================================

export async function scrapePage(
  pageNum: number,
  sizeConfig: (typeof SIZE_CONFIG)[0]
): Promise<BeadListing[]> {
  const url =
    pageNum === 1
      ? `${DIRECTORY_URL}?filter_shape=rr&filter_size=${sizeConfig.filter}`
      : `${DIRECTORY_URL}page/${pageNum}/?filter_shape=rr&filter_size=${sizeConfig.filter}`;

  console.log(`  [Size ${sizeConfig.size}] Fetching page ${pageNum}...`);

  try {
    const html = await fetchHtml(url);
    const beads: BeadListing[] = [];

    const productRegex =
      /<a[^>]*class="[^"]*woocommerce-LoopProduct-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    while ((match = productRegex.exec(html)) !== null) {
      const productHtml = match[1];

      const nameMatch = productHtml.match(
        /<h[23][^>]*class="[^"]*woocommerce-loop-product__title[^"]*"[^>]*>([^<]+)<\/h[23]>/i
      );
      if (!nameMatch) continue;

      const name = nameMatch[1].trim();
      const parsed = parseBeadName(name);
      if (!parsed) continue;

      if (parsed.size !== sizeConfig.size) {
        console.warn(
          `  [Size ${sizeConfig.size}] Unexpected size ${parsed.size} for bead #${parsed.beadId}`
        );
        continue;
      }

      let imageUrl: string | undefined;

      const srcsetMatch = productHtml.match(/srcset="([^"]+)"/i);
      if (srcsetMatch) {
        const srcsetParts = srcsetMatch[1].split(',');
        for (const part of srcsetParts) {
          const trimmed = part.trim();
          if (trimmed.match(new RegExp(`${sizeConfig.size}-\\d+[A-Z]*\\.jpg`, 'i'))) {
            imageUrl = trimmed.split(' ')[0];
            break;
          }
        }
      }

      if (!imageUrl) {
        const imgMatch = productHtml.match(/<img[^>]*src="([^"]+)"/i);
        imageUrl = imgMatch ? imgMatch[1] : undefined;
      }

      beads.push({ beadId: parsed.beadId, size: parsed.size, name, imageUrl });
    }

    return beads;
  } catch (error) {
    console.error(`  [Size ${sizeConfig.size}] Failed to scrape page ${pageNum}:`, error);
    return [];
  }
}

export async function scrapeAllPages(sizes: string[]): Promise<BeadListing[]> {
  console.log('\nScraping Miyuki directory...\n');
  const allBeads: BeadListing[] = [];
  const activeSizeConfigs = SIZE_CONFIG.filter((c) => sizes.includes(c.size));

  for (const sizeConfig of activeSizeConfigs) {
    console.log(`  Processing size ${sizeConfig.size}...`);
    let pageNum = 1;
    let hasMorePages = true;
    let sizeTotal = 0;

    while (hasMorePages) {
      const beads = await scrapePage(pageNum, sizeConfig);
      if (beads.length === 0) {
        hasMorePages = false;
      } else {
        allBeads.push(...beads);
        sizeTotal += beads.length;
        console.log(`    Found ${beads.length} beads on page ${pageNum}`);
        pageNum++;
        if (pageNum > 50) {
          console.warn('    Reached page limit (50), stopping');
          hasMorePages = false;
        }
        if (hasMorePages) {
          await delay(REQUEST_DELAY_MS);
        }
      }
    }

    console.log(`  Size ${sizeConfig.size} complete: ${sizeTotal} beads\n`);
    if (sizeConfig !== activeSizeConfigs[activeSizeConfigs.length - 1]) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  console.log(`  Total beads found across all sizes: ${allBeads.length}\n`);
  return allBeads;
}

// ============================================================================
// Local Bead Detection
// ============================================================================

export function getExistingBeads(size: string): Set<string> {
  const existing = new Set<string>();

  // Only check downloaded/ for originals — thumbnails in beads/ alone are not sufficient
  const downloadedSizeDir = path.join(RR_DOWNLOADED_DIR, size);
  if (fs.existsSync(downloadedSizeDir)) {
    for (const file of fs.readdirSync(downloadedSizeDir)) {
      if (file.endsWith('.jpg') && !file.includes('_16x16') && !file.includes('_48x48')) {
        const beadId = path.basename(file, '.jpg').toUpperCase();
        existing.add(beadId);
      }
    }
  }

  return existing;
}

export function findMissingBeads(
  scrapedBeads: BeadListing[],
  sizes: string[]
): Map<string, BeadListing[]> {
  console.log('Analyzing local bead inventory...\n');
  const missingBySize = new Map<string, BeadListing[]>();
  const activeSizeConfigs = SIZE_CONFIG.filter((c) => sizes.includes(c.size));

  for (const sizeConfig of activeSizeConfigs) {
    const size = sizeConfig.size;
    const existing = getExistingBeads(size);
    const scrapedForSize = scrapedBeads.filter((b) => b.size === size);

    const normalizeBeadId = (id: string): string => id.toUpperCase();

    const normalizedExisting = new Set(Array.from(existing).map(normalizeBeadId));
    const missing = scrapedForSize.filter((bead) => !normalizedExisting.has(normalizeBeadId(bead.beadId)));

    console.log(`  Size ${size}:`);
    console.log(`    Existing: ${existing.size}`);
    console.log(`    Found on website: ${scrapedForSize.length}`);
    console.log(`    Missing: ${missing.length}`);

    if (missing.length > 0) {
      missingBySize.set(size, missing);
      const preview = missing.slice(0, 5).map((b) => b.beadId).join(', ');
      console.log(`    Missing beads: ${preview}${missing.length > 5 ? ', ...' : ''}`);
    }
  }

  console.log('');
  return missingBySize;
}

// ============================================================================
// Image Download
// ============================================================================

/**
 * Constructs the full-resolution image URL for a Round Rocailles bead.
 *
 * Primary pattern:  https://…/uploads/2024/06/<size>-<id>.jpg   (e.g. 15-1.jpg)
 * Fallback pattern: https://…/uploads/2024/06/<id>-RR-<size>.jpg (e.g. 2370-RR-11.jpg)
 */
export function constructImageUrl(beadListing: BeadListing): string {
  if (beadListing.imageUrl) {
    // Try to extract the full-size URL from a (possibly thumbnailed) scraped URL
    const match = beadListing.imageUrl.match(/(https:\/\/[^"'\s]+\/(\d+-\d+[A-Z]*))(?:-\d+x\d+)?\.jpg/i);
    if (match) {
      return `${match[1]}.jpg`;
    }
  }
  // Fallback: construct from bead ID and size
  return `https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/${beadListing.size}-${beadListing.beadId}.jpg`;
}

export function constructFallbackImageUrls(beadListing: BeadListing): string[] {
  return [
    // Pattern 2: <beadId>-RR-<size>.jpg  (e.g. 2370-RR-11.jpg)
    `https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/${beadListing.beadId}-RR-${beadListing.size}.jpg`,
    // Pattern 3: <size>-0_<beadId>.jpg    (e.g. 11-0_4281.jpg)
    `https://www.miyuki-beads.co.jp/directory/wp-content/uploads/2024/06/${beadListing.size}-0_${beadListing.beadId}.jpg`,
  ];
}

async function downloadMissingBeads(
  missingBySize: Map<string, BeadListing[]>,
  options: SyncOptions,
  summary: SyncSummary
): Promise<void> {
  let totalMissing = 0;
  for (const beads of missingBySize.values()) {
    totalMissing += beads.length;
  }

  if (totalMissing === 0) {
    console.log('No missing beads found.\n');
    return;
  }

  if (options.dryRun) {
    console.log('DRY RUN - Would download the following beads:\n');
    for (const [size, beads] of missingBySize.entries()) {
      console.log(`  Size ${size}: ${beads.map((b) => b.beadId).join(', ')}`);
    }
    console.log('');
    return;
  }

  console.log(`Downloading ${totalMissing} missing beads...\n`);

  for (const [size, beads] of missingBySize.entries()) {
    console.log(`  Size ${size} (${beads.length} beads):`);

    for (const bead of beads) {
      const urls = [constructImageUrl(bead), ...constructFallbackImageUrls(bead)];
      // Use <beadId>.jpg as filename so metadata scraper can extract the bead ID
      const filename = `${bead.beadId}.jpg`;
      const outputPath = path.join(RR_DOWNLOADED_DIR, size, filename);

      let downloaded = false;
      for (let i = 0; i < urls.length; i++) {
        try {
          await downloadImage(urls[i], outputPath);
          if (options.verbose) {
            const suffix = i > 0 ? ` (fallback ${i})` : '';
            console.log(`    Downloaded #${bead.beadId} -> ${filename}${suffix}`);
          }
          summary.downloaded += 1;
          downloaded = true;
          break;
        } catch (error) {
          const is404 = error instanceof Error && error.message.includes('HTTP 404');
          if (is404 && i < urls.length - 1) {
            // Try next URL pattern
            continue;
          }
          console.warn(
            `    Failed #${bead.beadId}: ${error instanceof Error ? error.message : error}`
          );
        }
      }
      if (downloaded) {
        await delay(REQUEST_DELAY_MS);
      }
    }
  }

  console.log('');
}

// ============================================================================
// Build Pipeline (metadata, thumbnails, colors)
// ============================================================================

function readMetadataSidecar(filePath: string): MiyukiOverlayInfo | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return raw as MiyukiOverlayInfo;
  } catch {
    return undefined;
  }
}

async function scrapeMetadataForSize(
  size: string,
  verbose: boolean
): Promise<number> {
  const downloadedDir = getDownloadedBeadTypeDirectory(BEAD_TYPE, size);
  const beadDir = getBeadTypeDirectory(BEAD_TYPE, size);
  if (!fs.existsSync(downloadedDir)) return 0;

  const beadsWithoutMetadata = findBeadsWithoutMetadata(downloadedDir, beadDir);
  if (beadsWithoutMetadata.length === 0) {
    if (verbose) console.log(`  All beads in size ${size} already have metadata`);
    return 0;
  }

  console.log(`  Found ${beadsWithoutMetadata.length} beads without metadata in size ${size}`);
  const results = await scrapeMultipleBeads(beadsWithoutMetadata, size, 1000, 'round-rocailles');
  let scraped = 0;

  for (const result of results) {
    if (result.success && result.metadata) {
      const metadataPath = path.join(beadDir, `${result.beadId}.metadata.json`);
      fs.writeFileSync(metadataPath, `${JSON.stringify(result.metadata, null, 2)}\n`, 'utf-8');
      scraped++;
    } else if (verbose) {
      console.warn(`    Skipped ${result.beadId}: ${result.error}`);
    }
  }

  return scraped;
}

async function generateThumbnailsForSize(
  size: string,
  force: boolean,
  verbose: boolean
): Promise<number> {
  const downloadedSizeDir = path.join(RR_DOWNLOADED_DIR, size);
  if (!fs.existsSync(downloadedSizeDir)) return 0;

  const outputSizeDir = path.join(RR_DIR, size);
  fs.mkdirSync(outputSizeDir, { recursive: true });

  let generated = 0;
  const files = fs.readdirSync(downloadedSizeDir).filter(
    (f) => f.endsWith('.jpg') && !f.includes('_16x16') && !f.includes('_48x48')
  );

  for (const file of files) {
    const sourcePath = path.join(downloadedSizeDir, file);
    const metaPath = path.join(outputSizeDir, file.replace('.jpg', '.metadata.json'));
    const overlay = readMetadataSidecar(metaPath);

    try {
      const result = await generateDerivatives(sourcePath, { force, overlay, outputDir: outputSizeDir });
      const count = Number(result.generated16) + Number(result.generated48);
      generated += count;
      if (verbose && count > 0) {
        console.log(`    Generated derivatives for ${file}`);
      }
    } catch (error) {
      console.warn(
        `    Failed derivatives for ${file}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  return generated;
}

async function rebuildSizeData(
  size: string,
  options: SyncOptions,
  summary: SyncSummary
): Promise<void> {
  if (!options.dryRun) {
    const extractionResult = await extractColors({
      beadType: BEAD_TYPE,
      size,
      inputDir: path.join(RR_DOWNLOADED_DIR, size),
      verbose: options.verbose,
    });
    if (!extractionResult.success) {
      throw new Error(`Color extraction failed for Miyuki Round Rocailles ${size}/0`);
    }
  }
  summary.colorsRebuilt += 1;
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function runMiyukiRoundRocaillesSync(options: SyncOptions): Promise<SyncSummary> {
  const summary: SyncSummary = {
    scraped: 0,
    downloaded: 0,
    metadataScraped: 0,
    derivativesGenerated: 0,
    colorsRebuilt: 0,
  };

  // Step 1: Scrape directory & download missing beads
  if (!options.localOnly) {
    const scrapedBeads = await scrapeAllPages(options.sizes);
    summary.scraped = scrapedBeads.length;

    if (scrapedBeads.length === 0) {
      console.error('No beads found on website. Check if the site structure changed.');
      process.exit(1);
    }

    const missingBySize = findMissingBeads(scrapedBeads, options.sizes);
    await downloadMissingBeads(missingBySize, options, summary);
  }

  // Step 2: Scrape metadata for beads without sidecars
  console.log('Scraping metadata for beads without sidecars...');
  for (const size of options.sizes) {
    summary.metadataScraped += await scrapeMetadataForSize(size, options.verbose);
  }

  // Step 3: Generate thumbnails
  console.log('\nGenerating thumbnails...');
  for (const size of options.sizes) {
    const generated = await generateThumbnailsForSize(size, options.force, options.verbose);
    summary.derivativesGenerated += generated;
    console.log(`  Size ${size}: ${generated} derivatives generated`);
  }

  // Step 4: Extract colors per size
  console.log('\nExtracting colors...');
  for (const size of options.sizes) {
    await rebuildSizeData(size, options, summary);
  }

  // Step 5: Generate consolidated metadata
  if (!options.dryRun) {
    console.log('\nGenerating consolidated metadata...');
    const metaResult = await generateMetadata({
      beadType: BEAD_TYPE,
      sizes: options.sizes,
      inputDir: RR_DIR,
      verbose: options.verbose,
    });
    if (!metaResult.success) {
      throw new Error('Metadata generation failed');
    }
  }

  // Step 6: Validate
  if (!options.dryRun) {
    console.log('\nValidating output files...');
    const validation = validateBeadType({ beadType: BEAD_TYPE });
    if (!validation.success) {
      console.warn('Validation reported issues — check output above');
    }
  }

  return summary;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv: string[]): SyncOptions {
  const sizesArgIndex = argv.indexOf('--sizes');
  const requestedSizes =
    sizesArgIndex >= 0 && argv[sizesArgIndex + 1]
      ? argv[sizesArgIndex + 1]
          .split(',')
          .map((v) => v.trim())
          .filter((v) => VALID_SIZES.includes(v))
      : [...VALID_SIZES];

  return {
    sizes: requestedSizes,
    dryRun: argv.includes('--dry-run'),
    verbose: argv.includes('--verbose'),
    localOnly: argv.includes('--local-only'),
    force: argv.includes('--force'),
  };
}

function printUsage(): void {
  console.log(`Usage: tsx scripts/beads/miyuki/round_rocailles/sync.ts [options]

Options:
  --local-only    Skip scraping/downloading, rebuild local data only
  --sizes 11,15   Limit processing to specific sizes (default: all)
  --dry-run       Report what would change without writing files
  --force         Force-regenerate thumbnails even when up to date
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
  console.log('MIYUKI ROUND ROCAILLES SYNC');
  console.log('='.repeat(70));

  const startedAt = Date.now();
  const summary = await runMiyukiRoundRocaillesSync(options);

  console.log(`\nMiyuki Round Rocailles sync summary`);
  console.log(`  sizes processed:      ${options.sizes.join(', ')}`);
  console.log(`  scraped listings:     ${summary.scraped}`);
  console.log(`  downloaded images:    ${summary.downloaded}`);
  console.log(`  metadata scraped:     ${summary.metadataScraped}`);
  console.log(`  derivatives generated: ${summary.derivativesGenerated}`);
  console.log(`  color datasets rebuilt: ${summary.colorsRebuilt}`);
  console.log(`\nCompleted in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nMiyuki Round Rocailles sync failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
