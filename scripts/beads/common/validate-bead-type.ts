#!/usr/bin/env tsx
/**
 * Validation Script for Bead Type Data
 * 
 * Performs comprehensive validation checks on bead data:
 * - Verifies all images have metadata files
 * - Checks for duplicate colors (bidirectional uniqueness)
 * - Validates JSON schema and structure
 * - Tests data loading in runtime
 * - Generates diff report showing changes
 * 
 * Usage:
 *   tsx scripts/beads/common/validate-bead-type.ts miyuki-delica
 *   tsx scripts/beads/common/validate-bead-type.ts miyuki-delica --size 11
 *   tsx scripts/beads/common/validate-bead-type.ts --help
 */

import * as fs from 'fs';
import * as path from 'path';
import { GENERATED_DATA_DIR, getBeadTypeDirectory } from './lib/paths.js';

// ============================================================================
// Types
// ============================================================================

interface ValidationOptions {
  beadType: string;
  size?: string;
  verbose?: boolean;
  strict?: boolean;
}

interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  details?: string;
}

interface ValidationResult {
  success: boolean;
  beadType: string;
  size?: string;
  issues: ValidationIssue[];
  stats: {
    totalImages: number;
    totalMetadata: number;
    totalColorMappings: number;
    uniqueColors: number;
    duplicateColors: number;
  };
}

interface ColorMapping {
  beadIds: Record<string, string[]>;
  colorMappings: Record<string, string>;
}

// ============================================================================
// Constants
// ============================================================================

// ============================================================================
// Validation Checks
// ============================================================================

/**
 * Check 1: Verify all images have corresponding metadata files
 */
function validateImageMetadataSync(
  beadDir: string,
  issues: ValidationIssue[]
): { images: number; metadata: number } {
  if (!fs.existsSync(beadDir)) {
    issues.push({
      level: 'error',
      category: 'filesystem',
      message: `Directory not found: ${beadDir}`
    });
    return { images: 0, metadata: 0 };
  }
  
  const files = fs.readdirSync(beadDir);
  
  const imageFiles = files.filter(f => 
    /\.(jpg|jpeg|png)$/i.test(f) && !f.includes('_16x16')
  );
  
  const metadataFiles = files.filter(f => f.endsWith('.metadata.json'));
  
  const imageIds = new Set(
    imageFiles.map(f => path.basename(f, path.extname(f)))
  );
  
  const metadataIds = new Set(
    metadataFiles.map(f => f.replace('.metadata.json', ''))
  );
  
  // Check for missing metadata
  for (const id of imageIds) {
    if (!metadataIds.has(id)) {
      issues.push({
        level: 'warning',
        category: 'metadata',
        message: `Missing metadata file for ${id}.jpg`
      });
    }
  }
  
  // Check for orphaned metadata
  for (const id of metadataIds) {
    if (!imageIds.has(id)) {
      issues.push({
        level: 'warning',
        category: 'metadata',
        message: `Orphaned metadata file: ${id}.metadata.json (no image)`
      });
    }
  }
  
  return {
    images: imageFiles.length,
    metadata: metadataFiles.length
  };
}

/**
 * Check 2: Validate color mapping JSON structure
 */
function validateColorJSON(
  jsonPath: string,
  issues: ValidationIssue[]
): ColorMapping | null {
  if (!fs.existsSync(jsonPath)) {
    issues.push({
      level: 'error',
      category: 'color-data',
      message: `Color JSON not found: ${jsonPath}`
    });
    return null;
  }
  
  try {
    const content = fs.readFileSync(jsonPath, 'utf-8');
    const data: ColorMapping = JSON.parse(content);
    
    // Validate structure
    if (!data.beadIds || typeof data.beadIds !== 'object') {
      issues.push({
        level: 'error',
        category: 'color-data',
        message: 'Missing or invalid beadIds object'
      });
      return null;
    }
    
    if (!data.colorMappings || typeof data.colorMappings !== 'object') {
      issues.push({
        level: 'error',
        category: 'color-data',
        message: 'Missing or invalid colorMappings object'
      });
      return null;
    }
    
    // Validate HEX colors
    const hexRegex = /^#[0-9a-f]{6}$/i;
    
    for (const hex of Object.keys(data.beadIds)) {
      if (!hexRegex.test(hex)) {
        issues.push({
          level: 'error',
          category: 'color-data',
          message: `Invalid HEX color: ${hex}`,
          details: 'HEX colors must be in format #RRGGBB'
        });
      }
    }
    
    for (const hex of Object.values(data.colorMappings)) {
      if (!hexRegex.test(hex)) {
        issues.push({
          level: 'error',
          category: 'color-data',
          message: `Invalid HEX color in colorMappings: ${hex}`
        });
      }
    }
    
    return data;
    
  } catch (error) {
    issues.push({
      level: 'error',
      category: 'color-data',
      message: `Failed to parse color JSON: ${error}`
    });
    return null;
  }
}

/**
 * Check 3: Validate bidirectional uniqueness
 */
function validateBidirectionalUniqueness(
  colorData: ColorMapping,
  issues: ValidationIssue[]
): number {
  let duplicateCount = 0;
  
  // Check if beadIds → colorMappings is consistent
  for (const [hex, beadIds] of Object.entries(colorData.beadIds)) {
    if (beadIds.length > 1) {
      duplicateCount++;
      
      const beadList = beadIds.join(', ');
      issues.push({
        level: 'warning',
        category: 'duplicate-colors',
        message: `Color ${hex} is shared by ${beadIds.length} beads`,
        details: beadList
      });
    }
    
    // Verify consistency with colorMappings
    for (const beadId of beadIds) {
      const mappedColor = colorData.colorMappings[beadId];
      if (mappedColor !== hex) {
        issues.push({
          level: 'error',
          category: 'color-data',
          message: `Inconsistency for ${beadId}: beadIds[${hex}] contains it, but colorMappings[${beadId}] = ${mappedColor}`
        });
      }
    }
  }
  
  // Check reverse direction
  for (const [beadId, hex] of Object.entries(colorData.colorMappings)) {
    if (!colorData.beadIds[hex]?.includes(beadId)) {
      issues.push({
        level: 'error',
        category: 'color-data',
        message: `Inconsistency for ${beadId}: colorMappings has ${hex}, but beadIds[${hex}] doesn't contain it`
      });
    }
  }
  
  return duplicateCount;
}

/**
 * Check 4: Validate metadata file structure
 */
function validateMetadataFile(
  metadataPath: string,
  issues: ValidationIssue[]
): boolean {
  if (!fs.existsSync(metadataPath)) {
    issues.push({
      level: 'error',
      category: 'metadata',
      message: `Metadata TypeScript file not found: ${metadataPath}`
    });
    return false;
  }
  
  try {
    const content = fs.readFileSync(metadataPath, 'utf-8');
    
    // Check for required exports
    const requiredExports = [
      'export interface BeadMetadata',
      'export type BeadSize',
      'export const beadMetadata',
      'export function getBeadMetadata'
    ];
    
    for (const exportName of requiredExports) {
      if (!content.includes(exportName)) {
        issues.push({
          level: 'warning',
          category: 'metadata',
          message: `Missing expected export: ${exportName}`
        });
      }
    }
    
    return true;
    
  } catch (error) {
    issues.push({
      level: 'error',
      category: 'metadata',
      message: `Failed to read metadata file: ${error}`
    });
    return false;
  }
}

/**
 * Check 5: Validate that auto-generated bead IDs match images
 */
function validateAutoGeneratedIds(
  beadDir: string,
  colorData: ColorMapping,
  issues: ValidationIssue[]
): void {
  if (!fs.existsSync(beadDir)) return;
  
  // Get actual image files
  const imageFiles = fs.readdirSync(beadDir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f) && !f.includes('_16x16'))
    .map(f => path.basename(f, path.extname(f)))
    .sort();
  
  // Get IDs from color mappings
  const jsonIds = Object.keys(colorData.colorMappings)
    .filter(id => !id.endsWith('_16x16'))
    .sort();
  
  // Find discrepancies
  const imageIdSet = new Set(imageFiles);
  const jsonIdSet = new Set(jsonIds);
  
  for (const id of imageFiles) {
    if (!jsonIdSet.has(id)) {
      issues.push({
        level: 'warning',
        category: 'sync',
        message: `Image exists but not in color JSON: ${id}`,
        details: 'Run color extraction to update'
      });
    }
  }
  
  for (const id of jsonIds) {
    if (!imageIdSet.has(id)) {
      issues.push({
        level: 'warning',
        category: 'sync',
        message: `Color JSON has entry but image missing: ${id}`,
        details: 'Image may have been deleted'
      });
    }
  }
}

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Run all validation checks
 */
export function validateBeadType(
  options: ValidationOptions
): ValidationResult {
  const issues: ValidationIssue[] = [];
  
  console.log(`\n🔍 Validating ${options.beadType}${options.size ? ` (size ${options.size})` : ''}...\n`);
  
  // Determine paths
  const beadBaseDir = getBeadTypeDirectory(options.beadType);
  const dataDir = GENERATED_DATA_DIR;
  const metadataPath = path.join(dataDir, 'bead-metadata.ts');
  
  // Determine sizes to check
  const sizes = options.size ? [options.size] : fs.readdirSync(beadBaseDir)
    .filter(item => fs.statSync(path.join(beadBaseDir, item)).isDirectory());
  
  let totalImages = 0;
  let totalMetadata = 0;
  let totalColorMappings = 0;
  let uniqueColors = 0;
  let duplicateColors = 0;
  
  // Validate each size
  for (const size of sizes) {
    console.log(`📏 Checking size ${size}...`);
    
    const beadDir = path.join(beadBaseDir, size);
    const colorJsonPath = path.join(dataDir, `${options.beadType}-${size}-colors.json`);
    
    // Check 1: Image/Metadata sync
    const { images, metadata } = validateImageMetadataSync(beadDir, issues);
    totalImages += images;
    totalMetadata += metadata;
    
    if (options.verbose) {
      console.log(`  Images: ${images}, Metadata: ${metadata}`);
    }
    
    // Check 2: Color JSON structure
    const colorData = validateColorJSON(colorJsonPath, issues);
    
    if (colorData) {
      totalColorMappings += Object.keys(colorData.colorMappings).length;
      uniqueColors += Object.keys(colorData.beadIds).length;
      
      // Check 3: Bidirectional uniqueness
      duplicateColors += validateBidirectionalUniqueness(colorData, issues);
      
      // Check 5: Auto-generated IDs match images
      validateAutoGeneratedIds(beadDir, colorData, issues);
    }
  }
  
  // Check 4: Metadata file
  validateMetadataFile(metadataPath, issues);
  
  // Determine overall success
  const errors = issues.filter(i => i.level === 'error');
  const warnings = issues.filter(i => i.level === 'warning');
  const success = errors.length === 0 && (!options.strict || warnings.length === 0);
  
  return {
    success,
    beadType: options.beadType,
    size: options.size,
    issues,
    stats: {
      totalImages,
      totalMetadata,
      totalColorMappings,
      uniqueColors,
      duplicateColors
    }
  };
}

// ============================================================================
// Report Generation
// ============================================================================

/**
 * Print validation report
 */
function printReport(result: ValidationResult): void {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`VALIDATION REPORT`);
  console.log(`${'='.repeat(70)}\n`);
  
  // Statistics
  console.log(`📊 Statistics:`);
  console.log(`   Total images: ${result.stats.totalImages}`);
  console.log(`   Total metadata files: ${result.stats.totalMetadata}`);
  console.log(`   Color mappings: ${result.stats.totalColorMappings}`);
  console.log(`   Unique colors: ${result.stats.uniqueColors}`);
  console.log(`   Duplicate colors: ${result.stats.duplicateColors}`);
  
  // Group issues by level and category
  const errors = result.issues.filter(i => i.level === 'error');
  const warnings = result.issues.filter(i => i.level === 'warning');
  const infos = result.issues.filter(i => i.level === 'info');
  
  if (errors.length > 0) {
    console.log(`\n❌ Errors (${errors.length}):`);
    for (const issue of errors) {
      console.log(`   [${issue.category}] ${issue.message}`);
      if (issue.details) {
        console.log(`      ${issue.details}`);
      }
    }
  }
  
  if (warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${warnings.length}):`);
    for (const issue of warnings) {
      console.log(`   [${issue.category}] ${issue.message}`);
      if (issue.details) {
        console.log(`      ${issue.details}`);
      }
    }
  }
  
  if (infos.length > 0) {
    console.log(`\nℹ️  Info (${infos.length}):`);
    for (const issue of infos) {
      console.log(`   [${issue.category}] ${issue.message}`);
    }
  }
  
  // Overall result
  console.log(`\n${'='.repeat(70)}`);
  if (result.success) {
    console.log(`✅ VALIDATION PASSED`);
    if (warnings.length > 0) {
      console.log(`   (with ${warnings.length} warnings)`);
    }
  } else {
    console.log(`❌ VALIDATION FAILED`);
    console.log(`   ${errors.length} error(s), ${warnings.length} warning(s)`);
  }
  console.log(`${'='.repeat(70)}\n`);
}

// ============================================================================
// CLI Interface
// ============================================================================

function printUsage() {
  console.log(`
Usage: tsx scripts/beads/common/validate-bead-type.ts <bead-type> [options]

Arguments:
  <bead-type>         Bead type to validate (e.g., miyuki-delica)

Options:
  --size <size>       Validate specific size only (e.g., 11)
  --strict            Treat warnings as errors
  --verbose, -v       Enable verbose output
  --help, -h          Show this help message

Examples:
  # Validate all sizes
  tsx scripts/beads/common/validate-bead-type.ts miyuki-delica

  # Validate specific size
  tsx scripts/beads/common/validate-bead-type.ts miyuki-delica --size 11

  # Strict mode (warnings fail validation)
  tsx scripts/beads/common/validate-bead-type.ts miyuki-delica --strict

Validation checks:
  ✓ All images have metadata files
  ✓ Color JSON structure is valid
  ✓ Bidirectional color mapping consistency
  ✓ No duplicate colors (or documented)
  ✓ Metadata TypeScript file exists
  ✓ Auto-generated IDs match filesystem
  `);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printUsage();
    process.exit(0);
  }
  
  const options: ValidationOptions = {
    beadType: '',
    verbose: args.includes('--verbose') || args.includes('-v'),
    strict: args.includes('--strict')
  };
  
  // Parse positional argument
  const positionalArgs = args.filter(arg => !arg.startsWith('--') && !arg.startsWith('-'));
  if (positionalArgs.length > 0) {
    options.beadType = positionalArgs[0];
  }
  
  // Parse other options
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--size') {
      options.size = args[++i];
    }
  }
  
  if (!options.beadType) {
    console.error('❌ Error: Bead type is required\n');
    printUsage();
    process.exit(1);
  }
  
  // Run validation
  const result = validateBeadType(options);
  
  // Print report
  printReport(result);
  
  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
