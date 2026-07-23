#!/usr/bin/env tsx
import { syncMissingFromBeadloo } from './sync-missing-from-beadloo.js';

const dryRun = process.argv.includes('--dry-run');

console.log(`\nSyncing missing downloaded originals from ../beadloo ${dryRun ? '(DRY RUN)' : ''}...\n`);

const delicaResult = syncMissingFromBeadloo('miyuki', 'delica', { dryRun });
console.log(`Miyuki Delica: missing=${delicaResult.totalMissing}, copied=${delicaResult.copied}`);

const tohoResult = syncMissingFromBeadloo('toho', 'round', { dryRun });
console.log(`TOHO Round: missing=${tohoResult.totalMissing}, copied=${tohoResult.copied}`);

const preciosaResult = syncMissingFromBeadloo('preciosa', 'rocailles', { dryRun });
console.log(`Preciosa Rocailles: missing=${preciosaResult.totalMissing}, copied=${preciosaResult.copied}`);

console.log('\nDone!\n');
