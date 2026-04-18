#!/usr/bin/env tsx
/**
 * Miyuki Metadata Scraper
 * 
 * Scrapes bead metadata from the official Miyuki website directory.
 * 
 * URL Pattern: https://www.miyuki-beads.co.jp/directory/{beadId-lowercase}-delica-beads-{size}/
 * Example: DB2271 → https://www.miyuki-beads.co.jp/directory/db2271-delica-beads-11-0/
 * 
 * Extracts metadata from "Additional information" table:
 * - Shape, Size, Color Group, Glass Group, Finish, Dyed, Galvanized, Plating
 * - Some Miyuki pages omit Color Group, so that field is treated as optional
 * 
 * Usage:
 *   tsx scripts/beads/miyuki/common/scrape-metadata.ts DB2271 11
 *   tsx scripts/beads/miyuki/common/scrape-metadata.ts --size 11 --output-dir beads/miyuki/delica/11
 */

import * as fs from 'fs';
import * as path from 'path';
import { getBeadTypeDirectory } from '../../common/lib/paths.js';

// ============================================================================
// Types
// ============================================================================

interface BeadMetadata {
  shape: string;
  size: string;
  colorGroup?: string;
  glassGroup: string;
  finish: string;
  dyed: string;
  galvanized: string;
  plating: string;
}

interface ScrapingResult {
  beadId: string;
  url: string;
  success: boolean;
  metadata?: BeadMetadata;
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

export type MiyukiShape = 'delica' | 'round-rocailles';

const SHAPE_SLUG: Record<MiyukiShape, string> = {
  'delica': 'delica-beads',
  'round-rocailles': 'round-rocailles',
};

const BASE_URL = 'https://www.miyuki-beads.co.jp/directory';
const REQUEST_DELAY_MS = 1000; // Be respectful to the server

// ============================================================================
// URL Construction
// ============================================================================

/**
 * Constructs Miyuki directory URL for a bead
 * DB2271 + size 11 + delica      → db2271-delica-beads-11-0
 * DB0987 + size 11 + delica      → db987-delica-beads-11-0 (leading zero stripped)
 * 1F     + size 15 + round-rocailles → 1f-round-rocailles-15-0
 */
function constructMiyukiUrl(beadId: string, size: string, shape: MiyukiShape = 'delica'): string {
  const lowerBeadId = beadId.toLowerCase();
  const sizeSlug = `${size}-0`;
  const slug = SHAPE_SLUG[shape];
  return `${BASE_URL}/${lowerBeadId}-${slug}-${sizeSlug}/`;
}

/**
 * Constructs alternative URL by stripping leading zero after DB prefix
 * DB0987 → db987-delica-beads-11-0
 * Only applicable to Delica beads.
 */
function constructAlternativeUrl(beadId: string, size: string, shape: MiyukiShape = 'delica'): string | null {
  if (shape !== 'delica') return null;
  // Only applies to beads like DB0xxx (4 digits starting with 0)
  if (beadId.match(/^DB0\d{3}$/i)) {
    const withoutLeadingZero = beadId.replace(/^DB0/i, 'DB');
    const lowerBeadId = withoutLeadingZero.toLowerCase();
    const sizeSlug = `${size}-0`;
    return `${BASE_URL}/${lowerBeadId}-delica-beads-${sizeSlug}/`;
  }
  return null;
}

/**
 * Constructs simple fallback URL without size suffix
 * DB0990 → db990/ (for edge cases with non-standard URLs)
 * Only applicable to Delica beads.
 */
function constructSimpleFallbackUrl(beadId: string, shape: MiyukiShape = 'delica'): string | null {
  if (shape !== 'delica') return null;
  // Strip leading zero if present (DB0xxx → DBxxx)
  const withoutLeadingZero = beadId.replace(/^DB0/i, 'DB');
  const lowerBeadId = withoutLeadingZero.toLowerCase();
  return `${BASE_URL}/${lowerBeadId}/`;
}

// ============================================================================
// HTML Parsing
// ============================================================================

/**
 * Parses HTML to extract metadata from "Additional information" table
 */
export function parseMetadataFromHtml(html: string): BeadMetadata | null {
  try {
    // Find the "Additional information" section
    const additionalInfoRegex = /<h2[^>]*>Additional information<\/h2>/i;
    const match = html.match(additionalInfoRegex);
    
    if (!match) {
      console.warn('Could not find "Additional information" section');
      return null;
    }

    // Extract the section after the header
    const sectionStart = match.index! + match[0].length;
    const sectionHtml = html.substring(sectionStart, sectionStart + 5000);

    // Parse table rows - format is like:
    // <tr><th>Shape</th><td><p>Delica</p></td></tr>
    const metadata: Partial<BeadMetadata> = {};
    
    const parseField = (fieldName: string, propertyName: keyof BeadMetadata) => {
      // Match: <th>FieldName</th><td><p>Value</p></td>
      const regex = new RegExp(
        `<th[^>]*>${fieldName}<\\/th>\\s*<td[^>]*>(?:<p[^>]*>)?([^<]+)(?:<\\/p>)?`,
        'i'
      );
      const fieldMatch = sectionHtml.match(regex);
      if (fieldMatch && fieldMatch[1]) {
        metadata[propertyName] = fieldMatch[1].trim();
      }
    };

    // Parse all fields
    parseField('Shape', 'shape');
    parseField('Size', 'size');
    parseField('Color Group', 'colorGroup');
    parseField('Glass Group', 'glassGroup');
    parseField('Finish', 'finish');
    parseField('Dyed', 'dyed');
    parseField('Galvanized', 'galvanized');
    parseField('Plating', 'plating');

    // Validate we got all required fields. Finish and Color Group are optional
    const requiredFields: (keyof BeadMetadata)[] = [
      'shape', 'size', 'glassGroup', 'dyed', 'galvanized', 'plating'
    ];
    
    const missingFields = requiredFields.filter(field => !metadata[field]);
    if (missingFields.length > 0) {
      console.warn(`Missing required fields: ${missingFields.join(', ')}`);
      return null;
    }

    // Default Finish to "Not Specified" if missing
    if (!metadata.finish) {
      metadata.finish = 'Not Specified';
    }

    return metadata as BeadMetadata;
  } catch (error) {
    console.error('Error parsing HTML:', error);
    return null;
  }
}

// ============================================================================
// Web Scraping
// ============================================================================

/**
 * Fetches and parses metadata for a single bead
 * Tries multiple URL patterns if the primary URL fails
 */
async function scrapeBeadMetadata(beadId: string, size: string, shape: MiyukiShape = 'delica'): Promise<ScrapingResult> {
  const url = constructMiyukiUrl(beadId, size, shape);
  
  console.log(`Fetching metadata for ${beadId} (size ${size})...`);
  console.log(`URL: ${url}`);

  try {
    let response = await fetch(url);
    let attemptedUrl = url;
    
    // If 404, try alternative URL (without leading zero for DB0xxx, Delica only)
    if (!response.ok && response.status === 404) {
      const altUrl = constructAlternativeUrl(beadId, size, shape);
      if (altUrl) {
        console.log(`  Trying alternative URL: ${altUrl}`);
        response = await fetch(altUrl);
        attemptedUrl = altUrl;
      }
    }
    
    // If still 404, try simple fallback URL (edge cases like DB0990, Delica only)
    if (!response.ok && response.status === 404) {
      const fallbackUrl = constructSimpleFallbackUrl(beadId, shape);
      if (fallbackUrl) {
        console.log(`  Trying simple fallback URL: ${fallbackUrl}`);
        response = await fetch(fallbackUrl);
        attemptedUrl = fallbackUrl;
      }
    }
    
    if (!response.ok) {
      console.log(`  ✗ ${beadId}: HTTP ${response.status} ${response.statusText}`);
      return {
        beadId,
        url: attemptedUrl,
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const html = await response.text();
    const metadata = parseMetadataFromHtml(html);

    if (!metadata) {
      console.log(`  ✗ ${beadId}: failed to parse metadata`);
      return {
        beadId,
        url: attemptedUrl,
        success: false,
        error: 'Failed to parse metadata from HTML'
      };
    }

    console.log(`  ✓ ${beadId}: ${metadata.colorGroup ?? 'n/a'} / ${metadata.finish}`);
    return {
      beadId,
      url: attemptedUrl,
      success: true,
      metadata
    };
  } catch (error) {
    console.log(`  ✗ ${beadId}: ${error instanceof Error ? error.message : String(error)}`);
    return {
      beadId,
      url,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Scrapes metadata for multiple beads
 */
async function scrapeMultipleBeads(
  beadIds: string[],
  size: string,
  delayMs: number = REQUEST_DELAY_MS,
  shape: MiyukiShape = 'delica'
): Promise<ScrapingResult[]> {
  const results: ScrapingResult[] = [];

  for (let i = 0; i < beadIds.length; i++) {
    const beadId = beadIds[i];
    const result = await scrapeBeadMetadata(beadId, size, shape);
    results.push(result);

    // Delay between requests (except for the last one)
    if (i < beadIds.length - 1) {
      console.log(`Waiting ${delayMs}ms before next request...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Saves metadata to .metadata.json file
 */
function saveMetadataFile(beadId: string, metadata: BeadMetadata, outputDir: string): boolean {
  try {
    const filePath = path.join(outputDir, `${beadId}.metadata.json`);
    const json = JSON.stringify(metadata, null, 2);
    fs.writeFileSync(filePath, json, 'utf-8');
    console.log(`✅ Saved metadata: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to save metadata for ${beadId}:`, error);
    return false;
  }
}

/**
 * Checks if metadata file already exists
 */
function hasMetadataFile(beadId: string, outputDir: string): boolean {
  const filePath = path.join(outputDir, `${beadId}.metadata.json`);
  return fs.existsSync(filePath);
}

/**
 * Finds all bead images without metadata files.
 * @param imageDir   Directory containing original .jpg images
 * @param metadataDir Directory to check for .metadata.json sidecars (defaults to imageDir)
 */
function findBeadsWithoutMetadata(imageDir: string, metadataDir?: string): string[] {
  if (!fs.existsSync(imageDir)) {
    return [];
  }

  const metaDir = metadataDir ?? imageDir;
  const files = fs.readdirSync(imageDir);
  const beadIds: string[] = [];

  for (const file of files) {
    // Look for main images (not thumbnails)
    if (file.endsWith('.jpg') && !file.includes('_16x16') && !file.includes('_48x48')) {
      const beadId = file.replace('.jpg', '');
      const metadataFile = path.join(metaDir, `${beadId}.metadata.json`);
      
      if (!fs.existsSync(metadataFile)) {
        beadIds.push(beadId);
      }
    }
  }

  return beadIds.sort();
}

// ============================================================================
// CLI Interface
// ============================================================================

interface CliOptions {
  beadIds?: string[];
  size?: string;
  outputDir?: string;
  force?: boolean;
  autoDiscover?: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--size' && i + 1 < args.length) {
      options.size = args[++i];
    } else if (arg === '--output-dir' && i + 1 < args.length) {
      options.outputDir = args[++i];
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--auto-discover') {
      options.autoDiscover = true;
    } else if (!arg.startsWith('--')) {
      // Treat as bead ID
      options.beadIds = options.beadIds || [];
      options.beadIds.push(arg.toUpperCase());
    }
  }
  
  return options;
}

function printUsage() {
  console.log(`
Miyuki Metadata Scraper

Usage:
  # Scrape single bead
  tsx scripts/beads/miyuki/common/scrape-metadata.ts DB2271 --size 11

  # Scrape multiple beads
  tsx scripts/beads/miyuki/common/scrape-metadata.ts DB2271 DB2272 DB2273 --size 11

  # Auto-discover beads without metadata in a directory
  tsx scripts/beads/miyuki/common/scrape-metadata.ts --auto-discover --output-dir beads/miyuki/delica/11

  # Force re-scrape (overwrite existing metadata)
  tsx scripts/beads/miyuki/common/scrape-metadata.ts DB2271 --size 11 --force

Options:
  --size <size>           Bead size (8, 10, 11, or 15)
  --output-dir <dir>      Output directory for metadata files
  --auto-discover         Find beads without metadata in output-dir
  --force                 Overwrite existing metadata files
  --help                  Show this help message
  `);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const options = parseArgs(args);

  // Validate required options
  if (!options.size) {
    console.error('❌ Error: --size is required');
    printUsage();
    process.exit(1);
  }

  // Determine output directory
  const outputDir = options.outputDir || getBeadTypeDirectory('miyuki-delica', options.size);
  
  if (!fs.existsSync(outputDir)) {
    console.error(`❌ Error: Output directory does not exist: ${outputDir}`);
    process.exit(1);
  }

  // Determine which beads to scrape
  let beadIds: string[] = [];
  
  if (options.autoDiscover) {
    console.log(`🔍 Auto-discovering beads without metadata in ${outputDir}...`);
    beadIds = findBeadsWithoutMetadata(outputDir);
    
    if (beadIds.length === 0) {
      console.log('✅ All beads already have metadata!');
      process.exit(0);
    }
    
    console.log(`Found ${beadIds.length} beads without metadata: ${beadIds.join(', ')}`);
  } else if (options.beadIds && options.beadIds.length > 0) {
    beadIds = options.beadIds;
  } else {
    console.error('❌ Error: No bead IDs provided and --auto-discover not set');
    printUsage();
    process.exit(1);
  }

  // Filter out beads that already have metadata (unless --force)
  if (!options.force) {
    const existingBeads = beadIds.filter(id => hasMetadataFile(id, outputDir));
    if (existingBeads.length > 0) {
      console.log(`ℹ️  Skipping ${existingBeads.length} beads with existing metadata (use --force to overwrite)`);
      beadIds = beadIds.filter(id => !hasMetadataFile(id, outputDir));
    }
  }

  if (beadIds.length === 0) {
    console.log('✅ Nothing to scrape!');
    process.exit(0);
  }

  console.log(`
======================================================================
Starting Metadata Scraping
======================================================================

Bead IDs: ${beadIds.join(', ')}
Size: ${options.size}
Output: ${outputDir}
Total: ${beadIds.length} bead(s)

`);

  // Scrape metadata
  const results = await scrapeMultipleBeads(beadIds, options.size);

  // Save successful results
  let successCount = 0;
  let failCount = 0;

  for (const result of results) {
    if (result.success && result.metadata) {
      const saved = saveMetadataFile(result.beadId, result.metadata, outputDir);
      if (saved) {
        successCount++;
      } else {
        failCount++;
      }
    } else {
      console.error(`❌ Failed to scrape ${result.beadId}: ${result.error}`);
      failCount++;
    }
  }

  // Print summary
  console.log(`
======================================================================
Summary
======================================================================

✅ Successfully scraped: ${successCount} bead(s)
❌ Failed: ${failCount} bead(s)

${successCount > 0 ? `Metadata files saved to: ${outputDir}` : ''}
  `);

  process.exit(failCount > 0 ? 1 : 0);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for use in other scripts
export {
  scrapeBeadMetadata,
  scrapeMultipleBeads,
  findBeadsWithoutMetadata,
  constructMiyukiUrl,
  constructAlternativeUrl,
  constructSimpleFallbackUrl
};
