#!/usr/bin/env tsx

import dotenv from 'dotenv';
import {
  calculateBlobDiff,
  reportBlobDiff,
  uploadBlobAssets,
} from '../../common/lib/blob.js';
import {
  PRECIOSA_ROCAILLES_SIZES,
  type PreciosaRocaillesSize,
  normalizePreciosaRocaillesSize,
} from './lib/config.js';

dotenv.config();

const BEAD_TYPE = 'preciosa-rocailles';

function parseArgs(argv: string[]) {
  const sizesArgIndex = argv.indexOf('--sizes');
  const sizes =
    sizesArgIndex >= 0 && argv[sizesArgIndex + 1]
      ? Array.from(
          new Set(
            argv[sizesArgIndex + 1]
              .split(',')
              .map((value) => normalizePreciosaRocaillesSize(value.trim()))
              .filter((value): value is PreciosaRocaillesSize => Boolean(value))
          )
        )
      : [...PRECIOSA_ROCAILLES_SIZES];

  return {
    sizes,
    upload: argv.includes('--upload'),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(`Usage: tsx scripts/beads/preciosa/rocailles/blob.ts [options]

Options:
  --upload        Upload new/changed original images to Vercel Blob
  --sizes 10,11   Limit to specific sizes (default: all supported sizes)
`);
    return;
  }

  const options = parseArgs(argv);

  console.log('\nPreciosa Rocailles blob diff...');
  const diff = await calculateBlobDiff(BEAD_TYPE, options.sizes);
  reportBlobDiff(diff);

  if (options.upload) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error('BLOB_READ_WRITE_TOKEN is required for --upload');
    }
    console.log('\nUploading new/changed Preciosa Rocailles assets to Vercel Blob...');
    await uploadBlobAssets(diff, BEAD_TYPE);
    console.log('Upload complete.');
  } else {
    console.log('  upload skipped (pass --upload to transfer assets)');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nPreciosa Rocailles blob failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}