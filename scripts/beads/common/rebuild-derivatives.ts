#!/usr/bin/env tsx
/**
 * Offline derivative rebuilder.
 *
 * Re-renders the published 16x16 single-bead thumbnails (and 48x48 centre crops) for every locally
 * downloaded original, with no network access. This exists because a *code* change to the renderer
 * or the colour sampler does not bump any source file's mtime, so the per-brand `sync --local-only`
 * paths won't pick it up (and some of them skip derivative regeneration entirely when offline). Run
 * this after changing `beadRender.ts` / `colorSampler.ts` to roll the change across all assets:
 *
 *   tsx scripts/beads/common/rebuild-derivatives.ts                 # every brand/type/size
 *   tsx scripts/beads/common/rebuild-derivatives.ts --type toho-round --sizes 11,15
 *
 * It always forces regeneration (that is the whole point) and reads each bead's metadata sidecar
 * from the published `beads/**` tree, exactly like the brand syncs do.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DOWNLOADED_ROOT,
  getBeadTypeSegments,
  getBeadTypeDirectory,
  getDownloadedBeadTypeDirectory,
} from './lib/paths.js';
import { generateDerivatives } from './lib/thumbnails.js';

interface Target { beadType: string; size: string; downloadedDir: string; outputDir: string }

function discoverTargets(typeFilter?: string, sizeFilter?: Set<string>): Target[] {
  const targets: Target[] = [];
  if (!fs.existsSync(DOWNLOADED_ROOT)) return targets;

  for (const brand of fs.readdirSync(DOWNLOADED_ROOT, { withFileTypes: true })) {
    if (!brand.isDirectory()) continue;
    const brandDir = path.join(DOWNLOADED_ROOT, brand.name);
    for (const type of fs.readdirSync(brandDir, { withFileTypes: true })) {
      if (!type.isDirectory()) continue;
      const beadType = `${brand.name}-${type.name}`;
      if (typeFilter && beadType !== typeFilter) continue;
      const typeDir = path.join(brandDir, type.name);
      for (const sizeEntry of fs.readdirSync(typeDir, { withFileTypes: true })) {
        if (!sizeEntry.isDirectory()) continue;
        if (sizeFilter && !sizeFilter.has(sizeEntry.name)) continue;
        targets.push({
          beadType,
          size: sizeEntry.name,
          downloadedDir: getDownloadedBeadTypeDirectory(beadType, sizeEntry.name),
          outputDir: getBeadTypeDirectory(beadType, sizeEntry.name),
        });
      }
    }
  }
  return targets.sort((l, r) => (l.beadType !== r.beadType ? l.beadType.localeCompare(r.beadType) : Number(l.size) - Number(r.size)));
}

function isOriginal(file: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(file) && !/_(?:16x16|48x48)\./i.test(file);
}

async function rebuildTarget(target: Target, verbose: boolean): Promise<{ rendered16: number; total: number }> {
  fs.mkdirSync(target.outputDir, { recursive: true });
  const files = fs.readdirSync(target.downloadedDir).filter(isOriginal).sort();
  let rendered16 = 0;
  for (const file of files) {
    const sourcePath = path.join(target.downloadedDir, file);
    try {
      const result = await generateDerivatives(sourcePath, { force: true, outputDir: target.outputDir });
      if (result.generated16) rendered16 += 1;
    } catch (error) {
      console.warn(`  ! ${target.beadType} ${file}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (verbose) console.log(`  ${target.beadType} ${target.size}/0 — ${rendered16}/${files.length} thumbnails re-rendered`);
  return { rendered16, total: files.length };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const typeFilter = argv.includes('--type') ? argv[argv.indexOf('--type') + 1] : undefined;
  const sizeFilter = argv.includes('--sizes')
    ? new Set(argv[argv.indexOf('--sizes') + 1].split(',').map((s) => s.trim()).filter(Boolean))
    : undefined;
  const verbose = !argv.includes('--quiet');

  if (typeFilter) {
    // Validate the type resolves to a real segment pair so a typo fails loudly.
    getBeadTypeSegments(typeFilter);
  }

  const targets = discoverTargets(typeFilter, sizeFilter);
  if (targets.length === 0) {
    console.error(`No downloaded originals found${typeFilter ? ` for type ${typeFilter}` : ''} under ${DOWNLOADED_ROOT}`);
    process.exit(1);
  }

  console.log(`\nRebuilding derivatives for ${targets.length} type/size dataset(s)...\n`);
  let rendered = 0, total = 0;
  for (const target of targets) {
    const r = await rebuildTarget(target, verbose);
    rendered += r.rendered16; total += r.total;
  }
  console.log(`\nDone — re-rendered ${rendered}/${total} 16x16 thumbnails.`);
}

main().catch((error) => {
  console.error('rebuild-derivatives failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
