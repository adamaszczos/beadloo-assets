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
import {
  GENERATED_DATA_DIR,
  discoverGeneratedMetadataFiles,
  getBeadTypeDirectory,
  getGeneratedMetadataDataPath,
  getGeneratedMetadataImportPath,
} from './lib/paths.js';

// ============================================================================
// Types
// ============================================================================

interface BeadMetadata {
  beadId?: string;
  shape: string;
  size: string;
  colorGroup?: string;
  glassGroup: string;
  finish?: string;
  dyed: string;
  galvanized: string;
  plating: string;
  additionalArticleNumber?: string;
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
  'preciosa-rocailles': ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '31', '32', '33', '34'],
  'toho-round': ['3', '6', '8', '11', '15'],
};

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function walkFilesRecursive(directory: string): Array<{ filePath: string; relativePath: string }> {
  const discovered: Array<{ filePath: string; relativePath: string }> = [];

  function walk(currentDirectory: string): void {
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true }).sort((left, right) => {
      return left.name.localeCompare(right.name);
    });

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      discovered.push({
        filePath: entryPath,
        relativePath: normalizeRelativePath(path.relative(directory, entryPath)),
      });
    }
  }

  walk(directory);

  return discovered;
}

function getMetadataKey(relativePath: string, metadata: BeadMetadata): string {
  return (metadata.beadId || relativePath.replace(/\.metadata\.json$/, '')).toUpperCase();
}

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

  const metadataFiles = walkFilesRecursive(directory).filter((file) => file.relativePath.endsWith('.metadata.json'));
  
  if (options.verbose) {
    console.log(`  Processing size ${size}: found ${metadataFiles.length} metadata files`);
  }
  
  for (const metadataFile of metadataFiles) {
    try {
      const content = fs.readFileSync(metadataFile.filePath, 'utf-8');
      const beadMetadata: BeadMetadata = JSON.parse(content);

      // Store with uppercase bead ID for consistency
      metadata[getMetadataKey(metadataFile.relativePath, beadMetadata)] = beadMetadata;

    } catch (error) {
      console.error(`  [ERROR] Error reading ${metadataFile.relativePath}:`, error);
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

interface DiscoveredBeadType {
  beadType: string;
  sizes: string[];
}

/**
 * Discover all *-metadata.json files in the output directory and group by bead type.
 */
function discoverMetadataFiles(outputDir: string): DiscoveredBeadType[] {
  const byType = new Map<string, string[]>();

  for (const { beadType, size } of discoverGeneratedMetadataFiles(outputDir)) {
    if (!byType.has(beadType)) byType.set(beadType, []);
    byType.get(beadType)!.push(size);
  }

  // Sort sizes numerically within each type, sort types alphabetically
  return Array.from(byType.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([beadType, sizes]) => ({
      beadType,
      sizes: sizes.sort((a, b) => Number(a) - Number(b)),
    }));
}

/**
 * Generate a unified TypeScript loader covering all discovered bead types.
 */
function generateUnifiedTypeScriptLoader(beadTypes: DiscoveredBeadType[]): string {
  const beadTypeUnion = beadTypes.map(bt => `"${bt.beadType}"`).join(' | ');

  const beadTypeSizesEntries = beadTypes
    .map(bt => `  "${bt.beadType}": ${bt.sizes.map(s => `"${s}"`).join(' | ')};`)
    .join('\n');

  const switchCases = beadTypes
    .flatMap(bt =>
      bt.sizes.map(
        size =>
          `    case "${bt.beadType}-${size}":\n      data = (await import('${getGeneratedMetadataImportPath(bt.beadType, size)}')).default;\n      break;`
      )
    )
    .join('\n');

  return `/**
 * Bead metadata loader with dynamic JSON imports
 * Auto-generated — covers all bead types
 * Generated on: ${new Date().toISOString()}
 *
 * This module loads bead metadata from JSON files instead of bundling
 * all metadata inline. This significantly reduces serverless function
 * bundle sizes.
 */

export interface BeadMetadata {
  beadId?: string;
  shape: string;
  size: string;
  colorGroup?: string;
  glassGroup: string;
  finish?: string;
  dyed: string;
  galvanized: string;
  plating: string;
  additionalArticleNumber?: string;
}

export type BeadType = ${beadTypeUnion};

export interface BeadTypeSizes {
${beadTypeSizesEntries}
}

// Cache keyed by "\${beadType}-\${size}"
const metadataCache: Record<string, Record<string, BeadMetadata>> = {};

/**
 * Dynamically load metadata for a specific bead type and size
 */
async function loadMetadata<T extends BeadType>(
  beadType: T,
  size: BeadTypeSizes[T]
): Promise<Record<string, BeadMetadata>> {
  const key = \`\${beadType}-\${size}\`;
  if (metadataCache[key]) {
    return metadataCache[key];
  }

  let data: Record<string, BeadMetadata>;

  switch (key) {
${switchCases}
    default:
      throw new Error(\`Unknown bead type/size: \${key}\`);
  }

  metadataCache[key] = data;
  return data;
}

/**
 * Synchronously get cached metadata for a bead type and size
 */
function getCachedMetadata<T extends BeadType>(
  beadType: T,
  size: BeadTypeSizes[T]
): Record<string, BeadMetadata> {
  return metadataCache[\`\${beadType}-\${size}\`] || {};
}

/**
 * Get metadata for a specific bead (sync — must preload first)
 */
export function getBeadMetadata<T extends BeadType>(
  beadId: string,
  beadType: T,
  size: BeadTypeSizes[T]
): BeadMetadata | null {
  return getCachedMetadata(beadType, size)[beadId] || null;
}

/**
 * Async version that ensures data is loaded
 */
export async function getBeadMetadataAsync<T extends BeadType>(
  beadId: string,
  beadType: T,
  size: BeadTypeSizes[T]
): Promise<BeadMetadata | null> {
  const metadata = await loadMetadata(beadType, size);
  return metadata[beadId] || null;
}

/**
 * Preload metadata for specific bead type + sizes
 */
export async function preloadMetadata<T extends BeadType>(
  beadType: T,
  sizes: BeadTypeSizes[T][]
): Promise<void> {
  await Promise.all(sizes.map(size => loadMetadata(beadType, size)));
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
export function getBeadsByColorGroup<T extends BeadType>(
  colorGroup: string,
  beadType: T,
  size: BeadTypeSizes[T]
): string[] {
  return Object.entries(getCachedMetadata(beadType, size))
    .filter(([, meta]) => meta.colorGroup === colorGroup)
    .map(([id]) => id);
}

/**
 * Get all beads for a specific glass group
 */
export function getBeadsByGlassGroup<T extends BeadType>(
  glassGroup: string,
  beadType: T,
  size: BeadTypeSizes[T]
): string[] {
  return Object.entries(getCachedMetadata(beadType, size))
    .filter(([, meta]) => meta.glassGroup === glassGroup)
    .map(([id]) => id);
}

/**
 * Async version of getBeadsByColorGroup
 */
export async function getBeadsByColorGroupAsync<T extends BeadType>(
  colorGroup: string,
  beadType: T,
  size: BeadTypeSizes[T]
): Promise<string[]> {
  const sizeMetadata = await loadMetadata(beadType, size);

  return Object.entries(sizeMetadata)
    .filter(([, meta]) => meta.colorGroup === colorGroup)
    .map(([id]) => id);
}

/**
 * Async version of getBeadsByGlassGroup
 */
export async function getBeadsByGlassGroupAsync<T extends BeadType>(
  glassGroup: string,
  beadType: T,
  size: BeadTypeSizes[T]
): Promise<string[]> {
  const sizeMetadata = await loadMetadata(beadType, size);

  return Object.entries(sizeMetadata)
    .filter(([, meta]) => meta.glassGroup === glassGroup)
    .map(([id]) => id);
}
`;
}

// ============================================================================
// Unified Loader Regeneration
// ============================================================================

/**
 * Regenerate the unified bead-metadata.ts covering ALL bead types
 * discovered in the output directory.
 *
 * Call this from any sync script after writing per-size JSON files.
 */
export function regenerateUnifiedLoader(outputDir?: string): void {
  const dir = outputDir || GENERATED_DATA_DIR;
  const beadTypes = discoverMetadataFiles(dir);

  if (beadTypes.length === 0) {
    console.warn('[WARN] No *-metadata.json files found — skipping bead-metadata.ts generation');
    return;
  }

  const content = generateUnifiedTypeScriptLoader(beadTypes);
  const outputFile = path.join(dir, 'bead-metadata.ts');
  fs.writeFileSync(outputFile, content);

  const allTypes = beadTypes.map(bt => `${bt.beadType} (${bt.sizes.join(', ')})`).join(', ');
  console.log(`  [OK] bead-metadata.ts updated: ${allTypes}`);
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
      const jsonPath = getGeneratedMetadataDataPath(options.beadType, size, outputDir);
      fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
      fs.writeFileSync(jsonPath, `${JSON.stringify(sizeData, null, 2)}\n`);
      const stats = fs.statSync(jsonPath);
      console.log(`   [OK] ${path.relative(outputDir, jsonPath)} (${(stats.size / 1024).toFixed(1)} KB)`);
    }
    
    // Generate TypeScript loader file covering all bead types
    regenerateUnifiedLoader(outputDir);
    
    console.log(`\n[SUCCESS] Success!`);
    console.log(`   Total beads: ${totalBeads}`);
    console.log(`   Size breakdown:`);
    for (const [size, count] of Object.entries(sizeBreakdown)) {
      console.log(`     Size ${size}: ${count} beads`);
    }
    console.log(`   JSON files: ${Object.keys(metadata).length} files`);
    
    return {
      success: true,
      beadType: options.beadType,
      totalBeads,
      sizeBreakdown,
      outputFile: path.join(outputDir, 'bead-metadata.ts'),
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
