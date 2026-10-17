#!/usr/bin/env tsx
/**
 * Marks the Delica colours Miyuki's official list flags as discontinued (issue #203 Phase 3,
 * decision 10): `status: "Discontinued"` in the sidecar of every flagged colour on disk at 11/0.
 * Idempotent; never removes a bead. Run the sync afterwards so the metadata JSON follows.
 *
 * Usage: pnpm beads:miyuki:delica:mark-discontinued [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';
import { getBeadTypeDirectory } from '../../common/lib/paths.js';
import { readDurabilityTsv } from '../common/official-lists.js';

const BEAD_TYPE = 'miyuki-delica' as const;
const SIZE = '11';

export function withDiscontinuedStatus(sidecar: Record<string, unknown>): { sidecar: Record<string, unknown>; changed: boolean } {
  if (sidecar.status === 'Discontinued') return { sidecar, changed: false };
  const { colorAccuracy, formerly, ...rest } = sidecar;
  // Keep the issue #203 fields at the end in a stable order: status, colorAccuracy, formerly.
  const next: Record<string, unknown> = { ...rest, status: 'Discontinued' };
  if (colorAccuracy !== undefined) next.colorAccuracy = colorAccuracy;
  if (formerly !== undefined) next.formerly = formerly;
  return { sidecar: next, changed: true };
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const beadDir = getBeadTypeDirectory(BEAD_TYPE, SIZE);
  const flagged = readDurabilityTsv().filter((row) => row.discontinued);
  let marked = 0;
  const missing: string[] = [];
  for (const row of flagged) {
    const file = path.join(beadDir, `${row.beadId}.metadata.json`);
    if (!fs.existsSync(file)) {
      missing.push(row.beadId);
      continue;
    }
    const { sidecar, changed } = withDiscontinuedStatus(JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>);
    if (!changed) continue;
    if (!dryRun) fs.writeFileSync(file, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf-8');
    marked += 1;
  }
  console.log(`Discontinued per durability.tsv: ${flagged.length}; newly marked${dryRun ? ' (dry run)' : ''}: ${marked}; not on disk: ${missing.length}${missing.length ? ` (${missing.join(' ')})` : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
