#!/usr/bin/env tsx
/**
 * TOHO Round Blob Upload
 *
 * Compares local original bead images against Vercel Blob storage and uploads
 * new or changed files. Uses a SHA-256 manifest for efficient diffing.
 *
 * Usage:
 *   pnpm beads:toho:round:blob                Report diff only
 *   pnpm beads:toho:round:blob --upload        Upload new/changed assets
 *   pnpm beads:toho:round:blob --sizes 11,15   Limit to specific sizes
 */

import dotenv from 'dotenv';
import {
  calculateBlobDiff,
  reportBlobDiff,
  uploadBlobAssets,
} from '../../common/lib/blob.js';
import { TOHO_ROUND_SIZES, type TohoRoundSize } from './lib/config.js';

dotenv.config();

const BEAD_TYPE = 'toho-round';

function parseArgs(argv: string[]) {
  const sizesArgIndex = argv.indexOf('--sizes');
  const sizes =
    sizesArgIndex >= 0 && argv[sizesArgIndex + 1]
      ? argv[sizesArgIndex + 1]
          .split(',')
          .map((v) => v.trim())
          .filter((v): v is TohoRoundSize => TOHO_ROUND_SIZES.includes(v as TohoRoundSize))
      : [...TOHO_ROUND_SIZES];

  return {
    sizes,
    upload: argv.includes('--upload'),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(`Usage: tsx scripts/beads/toho/round/blob.ts [options]

Options:
  --upload        Upload new/changed original images to Vercel Blob
  --sizes 3,6     Limit to specific sizes (default: all)
`);
    return;
  }

  const options = parseArgs(argv);

  console.log('\nTOHO Round blob diff...');
  const diff = await calculateBlobDiff(BEAD_TYPE, options.sizes);
  reportBlobDiff(diff);

  if (options.upload) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error('BLOB_READ_WRITE_TOKEN is required for --upload');
    }
    console.log('\nUploading new/changed TOHO Round assets to Vercel Blob...');
    await uploadBlobAssets(diff, BEAD_TYPE);
    console.log('Upload complete.');
  } else {
    console.log('  upload skipped (pass --upload to transfer assets)');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nTOHO Round blob failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
