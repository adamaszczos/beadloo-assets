#!/usr/bin/env tsx
/**
 * Generic Color Extraction Script
 * 
 * Extracts dominant colors from bead images for any bead type.
 * Can be used as a standalone script or imported as a module.
 * 
 * Usage:
 *   tsx scripts/beads/common/extract-colors.ts --type miyuki-delica --size 11
 *   tsx scripts/beads/common/extract-colors.ts --help
 */

import * as fs from 'fs';
import * as path from 'path';
import { GENERATED_DATA_DIR, getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from './lib/paths.js';

// ============================================================================
// Types
// ============================================================================

interface ColorMapping {
  beadIds: Record<string, string[]>;
  colorMappings: Record<string, string>;
}

interface ExtractionOptions {
  beadType: string;
  size?: string;
  inputDir?: string;
  originalDir?: string;
  outputDir?: string;
  verbose?: boolean;
}

interface ExtractionResult {
  success: boolean;
  beadType: string;
  size: string;
  totalBeads: number;
  uniqueColors: number;
  outputFile: string;
  errors: string[];
}

// ============================================================================
// Constants
// ============================================================================

const IMAGE_FILE_REGEX = /\.(jpg|jpeg|png)$/i;
const THUMBNAIL_FILE_REGEX = /^(.*)_(16x16|48x48)\.(jpg|jpeg|png)$/i;

export interface BeadColorSource {
  beadId: string;
  imagePath: string | null;
  source: 'original' | 'thumbnail-48' | 'thumbnail-16' | 'fallback';
}


// ============================================================================
// Color Extraction Core
// ============================================================================

/**
 * Convert RGB to HEX
 */
function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Extract dominant color from image using Sharp
 * Uses perceptual weighting for accurate visual representation
 */
async function extractDominantColor(imagePath: string): Promise<string> {
  try {
    const sharp = (await import('sharp')).default;
    
    const { data } = await sharp(imagePath)
      .resize(24, 24, { 
        fit: 'cover',
        position: 'center'
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    let weightedR = 0, weightedG = 0, weightedB = 0, totalWeight = 0;
    
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      const brightness = (r + g + b) / 3;
      if (brightness < 15 || brightness > 245) continue;
      
      const pixelIndex = Math.floor(i / 3);
      const x = pixelIndex % 24;
      const y = Math.floor(pixelIndex / 24);
      const centerX = 12, centerY = 12;
      const distanceFromCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
      
      const brightnessWeight = Math.pow(brightness / 255, 0.5);
      const centerWeight = Math.max(0.1, 1 - distanceFromCenter / 12);
      const weight = brightnessWeight * centerWeight;
      
      weightedR += r * weight;
      weightedG += g * weight;
      weightedB += b * weight;
      totalWeight += weight;
    }
    
    if (totalWeight === 0) {
      throw new Error('No valid pixels found');
    }
    
    const avgR = Math.round(weightedR / totalWeight);
    const avgG = Math.round(weightedG / totalWeight);
    const avgB = Math.round(weightedB / totalWeight);
    
    return rgbToHex(avgR, avgG, avgB);
    
  } catch (error) {
    throw new Error(`Color extraction failed: ${error}`);
  }
}

/**
 * Generate deterministic fallback color from bead ID
 */
function generateFallbackColor(beadId: string): string {
  const match = beadId.match(/(\d+)/);
  const number = match ? parseInt(match[1]) : 0;
  
  const hue = (number * 137.508) % 360;
  const saturation = 0.7;
  const lightness = 0.5;
  
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  
  let r = 0, g = 0, b = 0;
  
  if (hue >= 0 && hue < 60) {
    r = c; g = x; b = 0;
  } else if (hue >= 60 && hue < 120) {
    r = x; g = c; b = 0;
  } else if (hue >= 120 && hue < 180) {
    r = 0; g = c; b = x;
  } else if (hue >= 180 && hue < 240) {
    r = 0; g = x; b = c;
  } else if (hue >= 240 && hue < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  
  return rgbToHex(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  );
}

function getColorSourcePriority(source: BeadColorSource['source']): number {
  switch (source) {
    case 'original':
      return 3;
    case 'thumbnail-48':
      return 2;
    case 'thumbnail-16':
      return 1;
    case 'fallback':
      return 0;
  }
}

function getThumbnailSource(file: string): BeadColorSource | null {
  const match = file.match(THUMBNAIL_FILE_REGEX);
  if (!match) {
    return null;
  }

  const beadId = match[1];
  const thumbnailSize = match[2];

  return {
    beadId,
    imagePath: file,
    source: thumbnailSize === '48x48' ? 'thumbnail-48' : 'thumbnail-16',
  };
}

export function collectBeadColorSources(directory: string, originalDir?: string): BeadColorSource[] {
  if (!fs.existsSync(directory) && !(originalDir && fs.existsSync(originalDir))) {
    return [];
  }

  const sources = new Map<string, BeadColorSource>();

  const registerSource = (source: BeadColorSource): void => {
    const existing = sources.get(source.beadId);
    if (!existing || getColorSourcePriority(source.source) > getColorSourcePriority(existing.source)) {
      sources.set(source.beadId, source);
    }
  };

  if (fs.existsSync(directory)) {
    const files = fs.readdirSync(directory).sort();

    for (const file of files) {
      if (!file.endsWith('.metadata.json')) {
        continue;
      }

      const beadId = file.replace('.metadata.json', '');
      registerSource({
        beadId,
        imagePath: null,
        source: 'fallback',
      });
    }

    for (const file of files) {
      if (!IMAGE_FILE_REGEX.test(file)) {
        continue;
      }

      const thumbnailSource = getThumbnailSource(file);
      if (thumbnailSource) {
        registerSource({
          ...thumbnailSource,
          imagePath: path.join(directory, file),
        });
        continue;
      }

      registerSource({
        beadId: path.basename(file, path.extname(file)),
        imagePath: path.join(directory, file),
        source: 'original',
      });
    }
  }

  if (originalDir && fs.existsSync(originalDir)) {
    for (const file of fs.readdirSync(originalDir).sort()) {
      if (!IMAGE_FILE_REGEX.test(file) || getThumbnailSource(file)) {
        continue;
      }

      registerSource({
        beadId: path.basename(file, path.extname(file)),
        imagePath: path.join(originalDir, file),
        source: 'original',
      });
    }
  }

  return Array.from(sources.values()).sort((left, right) => left.beadId.localeCompare(right.beadId));
}

// ============================================================================
// Processing Functions
// ============================================================================

/**
 * Adjust color slightly to make it unique
 * Modifies the blue channel first, then green, then red
 */
function adjustColorForUniqueness(
  baseColor: string, 
  usedColors: Set<string>
): string {
  if (!usedColors.has(baseColor)) {
    return baseColor;
  }
  
  // Parse hex color
  const r = parseInt(baseColor.slice(1, 3), 16);
  const g = parseInt(baseColor.slice(3, 5), 16);
  const b = parseInt(baseColor.slice(5, 7), 16);
  
  // Try adjusting blue channel first (least perceptible)
  for (let delta = 1; delta <= 255; delta++) {
    // Try adding
    if (b + delta <= 255) {
      const adjusted = rgbToHex(r, g, b + delta);
      if (!usedColors.has(adjusted)) {
        return adjusted;
      }
    }
    // Try subtracting
    if (b - delta >= 0) {
      const adjusted = rgbToHex(r, g, b - delta);
      if (!usedColors.has(adjusted)) {
        return adjusted;
      }
    }
  }
  
  // If blue exhausted, try green
  for (let delta = 1; delta <= 255; delta++) {
    if (g + delta <= 255) {
      const adjusted = rgbToHex(r, g + delta, b);
      if (!usedColors.has(adjusted)) {
        return adjusted;
      }
    }
    if (g - delta >= 0) {
      const adjusted = rgbToHex(r, g - delta, b);
      if (!usedColors.has(adjusted)) {
        return adjusted;
      }
    }
  }
  
  // If green exhausted, try red
  for (let delta = 1; delta <= 255; delta++) {
    if (r + delta <= 255) {
      const adjusted = rgbToHex(r + delta, g, b);
      if (!usedColors.has(adjusted)) {
        return adjusted;
      }
    }
    if (r - delta >= 0) {
      const adjusted = rgbToHex(r - delta, g, b);
      if (!usedColors.has(adjusted)) {
        return adjusted;
      }
    }
  }
  
  // This should never happen with RGB space, but fallback
  throw new Error(`Could not find unique color for ${baseColor}`);
}

/**
 * Process all images in a directory
 */
async function processDirectory(
  directory: string,
  options: ExtractionOptions
): Promise<ColorMapping> {
  const beadIds: Record<string, string[]> = {};
  const colorMappings: Record<string, string> = {};
  const usedColors = new Set<string>();
  
  if (!fs.existsSync(directory)) {
    throw new Error(`Directory not found: ${directory}`);
  }

  const beadSources = collectBeadColorSources(directory, options.originalDir);

  if (options.verbose) {
    console.log(`  Found ${beadSources.length} bead color sources`);
  }

  for (const beadSource of beadSources) {
    const { beadId, imagePath, source } = beadSource;

    try {
      if (!imagePath) {
        throw new Error('No image asset available');
      }

      let dominantColor = await extractDominantColor(imagePath);

      // Ensure color is unique
      const originalColor = dominantColor;
      dominantColor = adjustColorForUniqueness(dominantColor, usedColors);

      if (originalColor !== dominantColor && options.verbose) {
        console.log(`  ⚠ Adjusted ${beadId}: ${originalColor} → ${dominantColor} (collision)`);
      }

      colorMappings[beadId] = dominantColor;
      usedColors.add(dominantColor);

      if (!beadIds[dominantColor]) {
        beadIds[dominantColor] = [];
      }
      beadIds[dominantColor].push(beadId);

      if (options.verbose) {
        const sourceLabel = source === 'original' ? '' : ` [${source}]`;
        console.log(`  ${beadId}: ${dominantColor}${sourceLabel}`);
      }

    } catch (error) {
      if (imagePath) {
        console.warn(`  ⚠ Failed to extract color from ${path.basename(imagePath)}, using fallback`);
      } else {
        console.warn(`  ⚠ No image asset available for ${beadId}, using fallback color`);
      }

      let fallbackColor = generateFallbackColor(beadId);
      fallbackColor = adjustColorForUniqueness(fallbackColor, usedColors);

      colorMappings[beadId] = fallbackColor;
      usedColors.add(fallbackColor);
      if (!beadIds[fallbackColor]) {
        beadIds[fallbackColor] = [];
      }
      beadIds[fallbackColor].push(beadId);
    }
  }
  
  return { beadIds, colorMappings };
}

/**
 * Extract colors for a specific bead type and size
 */
export async function extractColors(
  options: ExtractionOptions
): Promise<ExtractionResult> {
  const errors: string[] = [];
  
  try {
    // Determine directories
    const inputDir = options.inputDir || getBeadTypeDirectory(options.beadType, options.size || '');
    const originalDir = options.originalDir || getDownloadedBeadTypeDirectory(options.beadType, options.size || '');
    const outputDir = options.outputDir || GENERATED_DATA_DIR;
    const resolvedOptions: ExtractionOptions = {
      ...options,
      inputDir,
      originalDir,
      outputDir,
    };
    
    if (options.verbose) {
      console.log(`\n📂 Input directory: ${inputDir}`);
      console.log(`📂 Original directory: ${originalDir}`);
      console.log(`📂 Output directory: ${outputDir}`);
    }
    
    // Process images
    console.log(`\n🎨 Extracting colors for ${options.beadType}${options.size ? ` (size ${options.size})` : ''}...`);
    const colorData = await processDirectory(inputDir, resolvedOptions);
    
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Determine output filename
    const outputFilename = options.size
      ? `${options.beadType}-${options.size}-colors.json`
      : `${options.beadType}-colors.json`;
    
    const outputFile = path.join(outputDir, outputFilename);
    
    // Write output
    fs.writeFileSync(outputFile, JSON.stringify(colorData, null, 2));
    
    const totalBeads = Object.keys(colorData.colorMappings).length;
    const uniqueColors = Object.keys(colorData.beadIds).length;
    
    console.log(`\n✅ Success!`);
    console.log(`   Total beads: ${totalBeads}`);
    console.log(`   Unique colors: ${uniqueColors}`);
    console.log(`   Output: ${outputFilename}`);
    
    return {
      success: true,
      beadType: options.beadType,
      size: options.size || 'all',
      totalBeads,
      uniqueColors,
      outputFile,
      errors
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(errorMessage);
    
    return {
      success: false,
      beadType: options.beadType,
      size: options.size || 'all',
      totalBeads: 0,
      uniqueColors: 0,
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
Usage: tsx scripts/beads/common/extract-colors.ts [options]

Options:
  --type <type>       Bead type (e.g., miyuki-delica, toho-round)
  --size <size>       Specific size to process (e.g., 8, 10, 11, 15)
  --input <dir>       Custom input directory (overrides default)
  --original-dir <dir>
                     Preferred directory of original bead images
  --output <dir>      Custom output directory (overrides default)
  --verbose, -v       Enable verbose logging
  --help, -h          Show this help message

Examples:
  # Extract colors for Miyuki Delica size 11
  tsx scripts/beads/common/extract-colors.ts --type miyuki-delica --size 11

  # Extract with verbose output
  tsx scripts/beads/common/extract-colors.ts --type miyuki-delica --size 11 --verbose

  # Custom directories
  tsx scripts/beads/common/extract-colors.ts --type toho-round --size 8 \\
    --input ./images/toho/8 --output ./output
  `);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }
  
  const options: ExtractionOptions = {
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
      case '--size':
        options.size = args[++i];
        break;
      case '--input':
        options.inputDir = args[++i];
        break;
      case '--original-dir':
        options.originalDir = args[++i];
        break;
      case '--output':
        options.outputDir = args[++i];
        break;
    }
  }
  
  // Validate required options
  if (!options.beadType) {
    console.error('❌ Error: --type is required\n');
    printUsage();
    process.exit(1);
  }
  
  // Run extraction
  const result = await extractColors(options);
  
  if (!result.success) {
    console.error('\n❌ Extraction failed:');
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
