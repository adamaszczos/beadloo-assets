#!/usr/bin/env tsx
/**
 * Generic Metadata Generation Script
 * 
 * Extracts metadata from .metadata.json files for any bead type.
 * Can be used as a standalone script or imported as a module.
 * 
 * Usage:
 *   tsx scripts/beads/common/generate-metadata.ts --type miyuki-delica
 *   tsx scripts/beads/common/generate-metadata.ts --help
 */

import * as fs from 'fs';
import * as path from 'path';
import { GENERATED_DATA_DIR, getBeadTypeDirectory } from './lib/paths.js';

// ============================================================================
// Types
// ============================================================================

interface BeadMetadata {
  shape: string;
  size: string;
  colorGroup: string;
  glassGroup: string;
  finish?: string;
  dyed: string;
  galvanized: string;
  plating: string;
  [key: string]: string | undefined;
}

interface SizeMetadataMap {
  [beadId: string]: BeadMetadata;
}

interface AllSizesMetadata {
  [size: string]: SizeMetadataMap;
}

interface GenerationOptions {
  beadType: string;
  sizes?: string[];
  inputDir?: string;
  outputDir?: string;
  outputFile?: string;
  verbose?: boolean;
}

interface GenerationResult {
  success: boolean;
  beadType: string;
  totalBeads: number;
  sizeBreakdown: Record<string, number>;
  outputFile: string;
  errors: string[];
}

// ============================================================================
// Constants
// ============================================================================


// Default sizes for common bead types
const DEFAULT_SIZES: Record<string, string[]> = {
  'miyuki-delica': ['8', '10', '11', '15'],
  'toho-round': ['3', '6', '8', '11', '15'],
};

// ============================================================================
// Metadata Extraction
// ============================================================================

/**
 * Extract metadata from a single directory
 */
function extractMetadataFromDirectory(
  directory: string,
  size: string,
  options: GenerationOptions
): SizeMetadataMap {
  const metadata: SizeMetadataMap = {};
  
  if (!fs.existsSync(directory)) {
    if (options.verbose) {
      console.warn(`  [WARN] Directory not found: ${directory}`);
    }
    return metadata;
  }
  
  const files = fs.readdirSync(directory);
  const metadataFiles = files.filter(file => file.endsWith('.metadata.json'));
  
  if (options.verbose) {
    console.log(`  Processing size ${size}: found ${metadataFiles.length} metadata files`);
  }
  
  for (const file of metadataFiles) {
    const beadId = file.replace('.metadata.json', '');
    const filePath = path.join(directory, file);
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const beadMetadata: BeadMetadata = JSON.parse(content);
      
      // Store with uppercase bead ID for consistency
      metadata[beadId.toUpperCase()] = beadMetadata;
      
    } catch (error) {
      console.error(`  [ERROR] Error reading ${file}:`, error);
    }
  }
  
  if (options.verbose) {
    console.log(`  [OK] Loaded ${Object.keys(metadata).length} beads for size ${size}`);
  }
  
  return metadata;
}

/**
 * Extract metadata for all sizes
 */
function extractAllMetadata(options: GenerationOptions): AllSizesMetadata {
  const allMetadata: AllSizesMetadata = {};
  
  // Determine sizes to process
  const sizes = options.sizes || DEFAULT_SIZES[options.beadType] || [];
  
  if (sizes.length === 0) {
    console.warn('[WARN] No sizes specified and no defaults found for this bead type');
    return allMetadata;
  }
  
  // Determine base directory
  const baseDir = options.inputDir || getBeadTypeDirectory(options.beadType);
  
  if (options.verbose) {
    console.log(`\n Base directory: ${baseDir}`);
    console.log(` Processing sizes: ${sizes.join(', ')}`);
  }
  
  // Process each size
  for (const size of sizes) {
    const sizeDir = path.join(baseDir, size);
    allMetadata[size] = extractMetadataFromDirectory(sizeDir, size, options);
  }
  
  return allMetadata;
}

// ============================================================================
// TypeScript File Generation
// ============================================================================

/**
 * Generate TypeScript loader file (NEW: uses JSON imports)
 */
function generateTypeScriptLoader(
  metadata: AllSizesMetadata,
  beadType: string
): string {
  const sizeTypes = Object.keys(metadata).map(s => `"${s}"`).join(' | ');
  
  return `/**
 * Bead metadata loader with dynamic JSON imports
 * Auto-generated for ${beadType} beads
 * Generated on: ${new Date().toISOString()}
 * 
 * This module loads bead metadata from JSON files instead of bundling
 * all metadata inline. This significantly reduces serverless function
 * bundle sizes.
 */

export interface BeadMetadata {
  shape: string;
  size: string;
  colorGroup: string;
  glassGroup: string;
  finish?: string;
  dyed: string;
  galvanized: string;
  plating: string;
}

export type BeadSize = ${sizeTypes};

// Cache for loaded metadata
const metadataCache: Partial<Record<BeadSize, Record<string, BeadMetadata>>> = {};

/**
 * Dynamically load metadata for a specific bead size
 */
async function loadMetadataForSize(size: BeadSize): Promise<Record<string, BeadMetadata>> {
  if (metadataCache[size]) {
    return metadataCache[size]!;
  }

  let data: Record<string, BeadMetadata>;
  
  switch (size) {
${Object.keys(metadata).map(size => `    case "${size}":
      data = (await import('./${beadType}-${size}-metadata.json')).default;
      break;`).join('\n')}
    default:
      throw new Error(\`Unknown bead size: \${size}\`);
  }

  metadataCache[size] = data;
  return data;
}

/**
 * Synchronously get cached metadata for a size
 */
function getCachedMetadata(size: BeadSize): Record<string, BeadMetadata> {
  return metadataCache[size] || {};
}

/**
 * Get metadata for a specific bead
 */
export function getBeadMetadata(
  beadId: string,
  size: BeadSize
): BeadMetadata | null {
  const sizeMetadata = getCachedMetadata(size);
  return sizeMetadata[beadId] || null;
}

/**
 * Async version that ensures data is loaded
 */
export async function getBeadMetadataAsync(
  beadId: string,
  size: BeadSize
): Promise<BeadMetadata | null> {
  const metadata = await loadMetadataForSize(size);
  return metadata[beadId] || null;
}

/**
 * Preload metadata for specific sizes
 */
export async function preloadMetadata(sizes: BeadSize[]): Promise<void> {
  await Promise.all(sizes.map(size => loadMetadataForSize(size)));
}

/**
 * Check if a bead has metallic finish
 */
export function isMetallicBead(metadata: BeadMetadata): boolean {
  const finish = metadata.finish?.toLowerCase() || '';
  const glassGroup = metadata.glassGroup?.toLowerCase() || '';
  
  return (
    finish.includes('metallic') ||
    finish.includes('plating') ||
    glassGroup.includes('metallic')
  );
}

/**
 * Get all beads for a specific color group
 */
export function getBeadsByColorGroup(
  colorGroup: string,
  size: BeadSize
): string[] {
  const sizeMetadata = getCachedMetadata(size);
  
  return Object.entries(sizeMetadata)
    .filter(([, meta]) => meta.colorGroup === colorGroup)
    .map(([id]) => id);
}

/**
 * Get all beads for a specific glass group
 */
export function getBeadsByGlassGroup(
  glassGroup: string,
  size: BeadSize
): string[] {
  const sizeMetadata = getCachedMetadata(size);
  
  return Object.entries(sizeMetadata)
    .filter(([, meta]) => meta.glassGroup === glassGroup)
    .map(([id]) => id);
}

/**
 * Async version of getBeadsByColorGroup
 */
export async function getBeadsByColorGroupAsync(
  colorGroup: string,
  size: BeadSize
): Promise<string[]> {
  const sizeMetadata = await loadMetadataForSize(size);
  
  return Object.entries(sizeMetadata)
    .filter(([, meta]) => meta.colorGroup === colorGroup)
    .map(([id]) => id);
}

/**
 * Async version of getBeadsByGlassGroup
 */
export async function getBeadsByGlassGroupAsync(
  glassGroup: string,
  size: BeadSize
): Promise<string[]> {
  const sizeMetadata = await loadMetadataForSize(size);
  
  return Object.entries(sizeMetadata)
    .filter(([, meta]) => meta.glassGroup === glassGroup)
    .map(([id]) => id);
}
`;
}

/**
 * Generate TypeScript file content (OLD: big inline object)
 * DEPRECATED: Use generateTypeScriptLoader instead
 */
function generateTypeScriptContent(
  metadata: AllSizesMetadata,
  beadType: string
): string {
  const sizeTypes = Object.keys(metadata).map(s => `"${s}"`).join(' | ');
  
  return `/**
 * Auto-generated file containing metadata for ${beadType} beads
 * Generated on: ${new Date().toISOString()}
 * 
 * This file contains metadata extracted from bead image metadata files
 * including properties like finish type, glass group, color group, etc.
 */

export interface BeadMetadata {
  shape: string;
  size: string;
  colorGroup: string;
  glassGroup: string;
  finish?: string;
  dyed: string;
  galvanized: string;
  plating: string;
}

export type BeadSize = ${sizeTypes};

export const beadMetadata: Record<BeadSize, Record<string, BeadMetadata>> = ${JSON.stringify(metadata, null, 2)};

/**
 * Get metadata for a specific bead
 * 
 * @param beadId - Bead identifier (e.g., "DB0001")
 * @param size - Size identifier
 * @returns Bead metadata or null if not found
 */
export function getBeadMetadata(
  beadId: string,
  size: BeadSize
): BeadMetadata | null {
  return beadMetadata[size]?.[beadId] || null;
}

/**
 * Check if a bead has metallic finish
 * 
 * @param metadata - Bead metadata
 * @returns True if bead is metallic
 */
export function isMetallicBead(metadata: BeadMetadata): boolean {
  const finish = metadata.finish?.toLowerCase() || '';
  const glassGroup = metadata.glassGroup?.toLowerCase() || '';
  
  return (
    finish.includes('metallic') ||
    finish.includes('plating') ||
    glassGroup.includes('metallic')
  );
}

/**
 * Get all beads for a specific color group
 * 
 * @param colorGroup - Color group name
 * @param size - Size identifier
 * @returns Array of bead IDs
 */
export function getBeadsByColorGroup(
  colorGroup: string,
  size: BeadSize
): string[] {
  const sizeMetadata = beadMetadata[size];
  if (!sizeMetadata) return [];
  
  return Object.entries(sizeMetadata)
    .filter(([, meta]) => meta.colorGroup === colorGroup)
    .map(([id]) => id);
}

/**
 * Get all beads for a specific glass group
 * 
 * @param glassGroup - Glass group name (e.g., "Opaque", "Transparent")
 * @param size - Size identifier
 * @returns Array of bead IDs
 */
export function getBeadsByGlassGroup(
  glassGroup: string,
  size: BeadSize
): string[] {
  const sizeMetadata = beadMetadata[size];
  if (!sizeMetadata) return [];
  
  return Object.entries(sizeMetadata)
    .filter(([, meta]) => meta.glassGroup === glassGroup)
    .map(([id]) => id);
}
`;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generate metadata TypeScript file
 */
export async function generateMetadata(
  options: GenerationOptions
): Promise<GenerationResult> {
  const errors: string[] = [];
  
  try {
    console.log(`\n Generating metadata for ${options.beadType}...`);
    
    // Extract metadata
    const metadata = extractAllMetadata(options);
    
    // Calculate statistics
    let totalBeads = 0;
    const sizeBreakdown: Record<string, number> = {};
    
    for (const [size, sizeData] of Object.entries(metadata)) {
      const count = Object.keys(sizeData).length;
      sizeBreakdown[size] = count;
      totalBeads += count;
    }
    
    if (totalBeads === 0) {
      throw new Error('No metadata found');
    }
    
    // Determine output directory
    const outputDir = options.outputDir || GENERATED_DATA_DIR;
    
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // NEW: Write separate JSON files for each size
    console.log(`\n Writing JSON files...`);
    for (const [size, sizeData] of Object.entries(metadata)) {
      const jsonFilename = `${options.beadType}-${size}-metadata.json`;
      const jsonPath = path.join(outputDir, jsonFilename);
      fs.writeFileSync(jsonPath, JSON.stringify(sizeData, null, 2));
      const stats = fs.statSync(jsonPath);
      console.log(`   [OK] ${jsonFilename} (${(stats.size / 1024).toFixed(1)} KB)`);
    }
    
    // Generate TypeScript loader file (much smaller)
    const outputFilename = options.outputFile || 'bead-metadata.ts';
    const outputFile = path.join(outputDir, outputFilename);
    const content = generateTypeScriptLoader(metadata, options.beadType);
    fs.writeFileSync(outputFile, content);
    
    console.log(`\n[SUCCESS] Success!`);
    console.log(`   Total beads: ${totalBeads}`);
    console.log(`   Size breakdown:`);
    for (const [size, count] of Object.entries(sizeBreakdown)) {
      console.log(`     Size ${size}: ${count} beads`);
    }
    console.log(`   Output: ${outputFilename} (TypeScript loader)`);
    console.log(`   JSON files: ${Object.keys(metadata).length} files`);
    
    return {
      success: true,
      beadType: options.beadType,
      totalBeads,
      sizeBreakdown,
      outputFile,
      errors
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(errorMessage);
    
    return {
      success: false,
      beadType: options.beadType,
      totalBeads: 0,
      sizeBreakdown: {},
      outputFile: '',
      errors
    };
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

function printUsage() {
  console.log(`
Usage: tsx scripts/beads/common/generate-metadata.ts [options]

Options:
  --type <type>       Bead type (e.g., miyuki-delica, toho-round)
  --sizes <sizes>     Comma-separated sizes (e.g., 8,10,11,15)
  --input <dir>       Custom input directory (overrides default)
  --output <dir>      Custom output directory (overrides default)
  --file <name>       Output filename (default: bead-metadata.ts)
  --verbose, -v       Enable verbose logging
  --help, -h          Show this help message

Examples:
  # Generate metadata for Miyuki Delica (all sizes)
  tsx scripts/beads/common/generate-metadata.ts --type miyuki-delica

  # Generate for specific sizes
  tsx scripts/beads/common/generate-metadata.ts --type miyuki-delica --sizes 11,15

  # Custom directories
  tsx scripts/beads/common/generate-metadata.ts --type toho-round \\
    --input ./images/toho --output ./output
  `);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }
  
  const options: GenerationOptions = {
    beadType: '',
    verbose: args.includes('--verbose') || args.includes('-v')
  };
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--type':
        options.beadType = args[++i];
        break;
      case '--sizes':
        options.sizes = args[++i].split(',');
        break;
      case '--input':
        options.inputDir = args[++i];
        break;
      case '--output':
        options.outputDir = args[++i];
        break;
      case '--file':
        options.outputFile = args[++i];
        break;
    }
  }
  
  // Validate required options
  if (!options.beadType) {
    console.error('[ERROR] Error: --type is required\n');
    printUsage();
    process.exit(1);
  }
  
  // Run generation
  const result = await generateMetadata(options);
  
  if (!result.success) {
    console.error('\n[ERROR] Generation failed:');
    result.errors.forEach(err => console.error(`   ${err}`));
    process.exit(1);
  }
  
  process.exit(0);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
