#!/usr/bin/env tsx
/**
 * Miyuki Delica Blob Upload
 *
 * Compares local original bead images against Vercel Blob storage and uploads
 * new or changed files. Uses a SHA-256 manifest for efficient diffing.
 *
 * Usage:
 *   pnpm beads:miyuki:delica:blob                Report diff only
 *   pnpm beads:miyuki:delica:blob --upload        Upload new/changed assets
 *   pnpm beads:miyuki:delica:blob --sizes 11,15   Limit to specific sizes
 */

import dotenv from 'dotenv';
import {
  calculateBlobDiff,
  reportBlobDiff,
  uploadBlobAssets,
} from '../../common/lib/blob.js';

dotenv.config();

const BEAD_TYPE = 'miyuki-delica';
const ALL_SIZES = ['8', '10', '11', '15'];

function parseArgs(argv: string[]) {
  const sizesArgIndex = argv.indexOf('--sizes');
  const sizes =
    sizesArgIndex >= 0 && argv[sizesArgIndex + 1]
      ? argv[sizesArgIndex + 1]
          .split(',')
          .map((v) => v.trim())
          .filter((v) => ALL_SIZES.includes(v))
      : [...ALL_SIZES];

  return {
    sizes,
    upload: argv.includes('--upload'),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(`Usage: tsx scripts/beads/miyuki/delica/blob.ts [options]

Options:
  --upload        Upload new/changed original images to Vercel Blob
  --sizes 11,15   Limit to specific sizes (default: all)
`);
    return;
  }

  const options = parseArgs(argv);

  console.log('\nMiyuki Delica blob diff...');
  const diff = await calculateBlobDiff(BEAD_TYPE, options.sizes);
  reportBlobDiff(diff);

  if (options.upload) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error('BLOB_READ_WRITE_TOKEN is required for --upload');
    }
    console.log('\nUploading new/changed Miyuki Delica assets to Vercel Blob...');
    await uploadBlobAssets(diff, BEAD_TYPE);
    console.log('Upload complete.');
  } else {
    console.log('  upload skipped (pass --upload to transfer assets)');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nMiyuki Delica blob failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
