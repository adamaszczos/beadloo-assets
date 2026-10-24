#!/usr/bin/env tsx
/**
 * Applies the reviewed glass-and-finish decisions (`sources/miyuki/round-rocaille-attributes.csv`) to
 * the round-rocaille sidecars on disk, at every size a decided colour number has (issue #203).
 *
 * The same colour number names the same glass and finish at every size, so a decision rewrites them
 * all and the registry row of each notes it. A number Miyuki's directory lists at any size never takes
 * a decision: the run stops and names it. Idempotent; run it after the adders and before the
 * `--local-only` sync so the metadata JSON follows.
 *
 * Usage: pnpm beads:miyuki:round_rocailles:apply-attribute-decisions [--dry-run]
 */
import * as fs from 'fs';
import { readRegistry, registryKey, writeRegistry, type RegistryRow } from '../common/registry.js';
import { ATTRIBUTE_DECISIONS_PATH, parseAttributeDecisions, withDecidedAttributes, withDecisionNote, type AttributeDecision } from '../common/attribute-decisions.js';
import { readSidecar, writeSidecar } from '../common/bead-files.js';
import { ROUND_ROCAILLE_SIZES } from '../common/round-rocaille-ids.js';

const BEAD_TYPE = 'miyuki-round_rocailles' as const;

/** Decided numbers the directory lists somewhere: a decision must not override the directory. */
export function decisionsOverDirectory(decisions: ReadonlyMap<string, AttributeDecision>, registry: ReadonlyArray<RegistryRow>): string[] {
  const listed = new Set(registry.filter((row) => row.listingSource === 'directory').map((row) => row.beadId.toUpperCase()));
  return Array.from(decisions.keys()).filter((colourNo) => listed.has(colourNo)).sort();
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const decisions = parseAttributeDecisions(fs.readFileSync(ATTRIBUTE_DECISIONS_PATH, 'utf-8'));
  const registry = readRegistry(BEAD_TYPE);
  const conflicts = decisionsOverDirectory(decisions, registry);
  if (conflicts.length) throw new Error(`the directory lists ${conflicts.join(', ')}: drop their decisions`);
  const rows = new Map(registry.map((row) => [registryKey(row.beadId, row.size), row]));
  const rewritten: string[] = [];
  let notesAdded = 0;
  let notOnDisk = 0;
  for (const decision of decisions.values()) {
    let found = false;
    for (const size of ROUND_ROCAILLE_SIZES) {
      const onDisk = readSidecar(BEAD_TYPE, size, decision.colourNo);
      if (!onDisk) continue;
      found = true;
      const { sidecar, changed } = withDecidedAttributes(onDisk, decision);
      if (changed) {
        rewritten.push(`${decision.colourNo}@${size}`);
        if (!dryRun) writeSidecar(BEAD_TYPE, size, decision.colourNo, sidecar);
      }
      const row = rows.get(registryKey(decision.colourNo, size));
      if (row && withDecisionNote(row.sourceRef, decision) !== row.sourceRef) {
        row.sourceRef = withDecisionNote(row.sourceRef, decision);
        notesAdded += 1;
      }
    }
    if (!found) notOnDisk += 1;
  }
  if (!dryRun) writeRegistry(BEAD_TYPE, Array.from(rows.values()));
  console.log(`Decisions: ${decisions.size} colour numbers (${notOnDisk} not on disk yet: the sample-card adder reads them)`);
  console.log(`Sidecars rewritten${dryRun ? ' (dry run)' : ''}: ${rewritten.length} ${rewritten.join(' ')}`);
  console.log(`Registry notes added${dryRun ? ' (dry run)' : ''}: ${notesAdded}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
