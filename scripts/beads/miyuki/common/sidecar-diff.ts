#!/usr/bin/env tsx
/**
 * Proof that the Store API attributes reproduce the metadata sidecars the old product-page scraper
 * wrote: for every sidecar under `beads/miyuki/**`, rebuild it from the dump and compare byte for byte.
 *
 * Usage:
 *   tsx scripts/beads/miyuki/common/sidecar-diff.ts             Compare and report (exit 1 on any difference)
 *   tsx scripts/beads/miyuki/common/sidecar-diff.ts --write <dir>   Also write the rebuilt sidecars under <dir>
 *   tsx scripts/beads/miyuki/common/sidecar-diff.ts --apply         Rewrite every differing sidecar with the official values
 *   tsx scripts/beads/miyuki/common/sidecar-diff.ts --all           List every difference (default: the first 40)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getBeadTypeDirectory } from '../../common/lib/paths.js';
import { readDirectoryDump } from './directory-catalog.js';
import { classifyDirectoryProducts, sidecarFromAttributes, type DirectoryListing, type MiyukiBeadType } from './directory-products.js';
import { listingKey } from './sync-pipeline.js';

export type SidecarDiffResult = {
  identical: number;
  differing: Array<{ beadType: MiyukiBeadType; size: string; beadId: string; fields: string[] }>;
  noListing: Array<{ beadType: MiyukiBeadType; size: string; beadId: string }>;
  incomplete: Array<{ beadType: MiyukiBeadType; size: string; beadId: string; missing: string[] }>;
};

/** Field-level differences between two flat sidecar objects, including key order. */
export function diffSidecarFields(existing: Record<string, unknown>, rebuilt: Record<string, unknown>): string[] {
  const fields: string[] = [];
  const keys = new Set([...Object.keys(existing), ...Object.keys(rebuilt)]);
  for (const key of keys) {
    if (existing[key] !== rebuilt[key]) fields.push(`${key}: ${JSON.stringify(existing[key])} → ${JSON.stringify(rebuilt[key])}`);
  }
  if (fields.length === 0 && Object.keys(existing).join(',') !== Object.keys(rebuilt).join(',')) {
    fields.push(`key order: ${Object.keys(existing).join(',')} → ${Object.keys(rebuilt).join(',')}`);
  }
  return fields;
}

export function compareSidecars(listings: DirectoryListing[], writeDir?: string, apply = false): SidecarDiffResult {
  const byKey = new Map(listings.map((listing) => [listingKey(listing), listing]));
  const result: SidecarDiffResult = { identical: 0, differing: [], noListing: [], incomplete: [] };

  for (const beadType of ['miyuki-delica', 'miyuki-round_rocailles'] as const) {
    const typeDir = getBeadTypeDirectory(beadType);
    for (const size of fs.readdirSync(typeDir).filter((entry) => fs.statSync(path.join(typeDir, entry)).isDirectory())) {
      const sizeDir = path.join(typeDir, size);
      for (const file of fs.readdirSync(sizeDir).filter((name) => name.endsWith('.metadata.json'))) {
        const beadId = file.slice(0, -'.metadata.json'.length);
        const listing = byKey.get(`${size}:${beadId.toUpperCase()}`);
        if (!listing) {
          result.noListing.push({ beadType, size, beadId });
          continue;
        }
        const rebuilt = sidecarFromAttributes(listing);
        if (!rebuilt.ok) {
          result.incomplete.push({ beadType, size, beadId, missing: rebuilt.missing });
          continue;
        }
        if (writeDir) {
          const out = path.join(writeDir, beadType, size, file);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, `${JSON.stringify(rebuilt.sidecar, null, 2)}\n`, 'utf-8');
        }
        const existing = JSON.parse(fs.readFileSync(path.join(sizeDir, file), 'utf-8')) as Record<string, unknown>;
        const fields = diffSidecarFields(existing, rebuilt.sidecar as unknown as Record<string, unknown>);
        if (fields.length === 0) {
          result.identical += 1;
        } else {
          result.differing.push({ beadType, size, beadId, fields });
          if (apply) fs.writeFileSync(path.join(sizeDir, file), `${JSON.stringify(rebuilt.sidecar, null, 2)}\n`, 'utf-8');
        }
      }
    }
  }
  return result;
}

function main(): void {
  const argv = process.argv.slice(2);
  const writeIndex = argv.indexOf('--write');
  const writeDir = writeIndex >= 0 ? argv[writeIndex + 1] : undefined;
  const apply = argv.includes('--apply');
  const limit = argv.includes('--all') ? Number.POSITIVE_INFINITY : 40;
  const dump = readDirectoryDump();
  const { listings, unparsed } = classifyDirectoryProducts(dump.products);
  const result = compareSidecars(listings, writeDir, apply);

  console.log(`\nSidecar diff against the directory dump (${dump.fetchedAt})`);
  console.log(`  identical:   ${result.identical}`);
  console.log(`  differing:   ${result.differing.length}`);
  console.log(`  no listing:  ${result.noListing.length}`);
  console.log(`  incomplete:  ${result.incomplete.length}`);
  console.log(`  unparsed products in the dump: ${unparsed.length}`);
  for (const entry of result.differing.slice(0, limit)) {
    console.log(`    ${entry.beadType} ${entry.size}/0 ${entry.beadId}: ${entry.fields.join('; ')}`);
  }
  if (result.differing.length > limit) console.log(`    … ${result.differing.length - limit} more (pass --all)`);
  if (apply && result.differing.length > 0) console.log(`  rewrote ${result.differing.length} sidecar(s) with the official values`);
  for (const entry of result.noListing.slice(0, 20)) {
    console.log(`    no listing: ${entry.beadType} ${entry.size}/0 ${entry.beadId}`);
  }
  if (result.noListing.length > 20) console.log(`    … ${result.noListing.length - 20} more without a listing`);
  for (const entry of result.incomplete.slice(0, 20)) {
    console.log(`    incomplete: ${entry.beadType} ${entry.size}/0 ${entry.beadId}: missing ${entry.missing.join(', ')}`);
  }
  if ((result.differing.length > 0 && !apply) || result.incomplete.length > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
