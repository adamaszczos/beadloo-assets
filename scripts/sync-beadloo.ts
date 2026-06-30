#!/usr/bin/env tsx
/**
 * Sync the freshly-published assets into the sibling Beadloo app.
 *
 * Intended to run right after `npm publish` (wired as the `postpublish` script, and runnable on its
 * own with `pnpm beadloo:sync`). It completes the integration that the npm package alone can't:
 *
 *   1. Bumps Beadloo's `@adamaszczos/beadloo-assets` dependency to this package's version.
 *   2. Copies the per-size `*-colors.json` + `*-metadata.json` from `generated/data/` into Beadloo's
 *      `src/lib/beads/metadata/` — these carry the colorMappings the live preview consumes and are
 *      NOT shipped in the npm package (which only contains `beads/**`).
 *   3. (unless skipped) Runs `pnpm install` in Beadloo to pull the new package version, then its
 *      `copy-bead-assets.mjs` to refresh `public/beads/` with the new thumbnails.
 *
 * It is safe to run when Beadloo is absent (e.g. a CI publish) — it logs and exits 0.
 *
 * Usage:
 *   pnpm beadloo:sync                       # full integration (default ../beadloo)
 *   pnpm beadloo:sync --dir /path/to/beadloo
 *   pnpm beadloo:sync --no-install          # copy files + bump version only (no pnpm install)
 *   pnpm beadloo:sync --no-thumbnails       # skip refreshing public/beads
 *   pnpm beadloo:sync --dry-run             # report what would change, write nothing
 *
 * The target can also be set with BEADLOO_DIR.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ASSET_REPO_ROOT, GENERATED_DATA_DIR } from './beads/common/lib/paths.js';

const PACKAGE_NAME = '@adamaszczos/beadloo-assets';

interface Options {
  dir: string;
  install: boolean;
  thumbnails: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const dirArg = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : undefined;
  const dir = dirArg || process.env.BEADLOO_DIR || path.resolve(ASSET_REPO_ROOT, '..', 'beadloo');
  return {
    dir: path.resolve(dir),
    install: !argv.includes('--no-install'),
    thumbnails: !argv.includes('--no-thumbnails'),
    dryRun: argv.includes('--dry-run'),
  };
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

/** Bump the dependency spec in-place, preserving any range prefix (^, ~, …) and file formatting. */
function bumpDependency(packageJsonPath: string, version: string, dryRun: boolean): 'updated' | 'unchanged' | 'missing' {
  const text = fs.readFileSync(packageJsonPath, 'utf-8');
  const escaped = PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`("${escaped}"\\s*:\\s*")([^"]*)(")`);
  const match = text.match(re);
  if (!match) return 'missing';
  const prefix = (match[2].match(/^[^\d]*/) ?? [''])[0];
  const next = `${prefix}${version}`;
  if (match[2] === next) return 'unchanged';
  if (!dryRun) fs.writeFileSync(packageJsonPath, text.replace(re, `$1${next}$3`));
  return 'updated';
}

/** Mirror every per-size colors/metadata JSON from generated/data into Beadloo's metadata dir. */
function copyMetadataJson(metadataDir: string, dryRun: boolean): { copied: number; changed: number } {
  let copied = 0, changed = 0;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const src = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(src); continue; }
      if (!/-(?:colors|metadata)\.json$/.test(entry.name)) continue; // skip bead-metadata.ts, .DS_Store, …
      const rel = path.relative(GENERATED_DATA_DIR, src);
      const dest = path.join(metadataDir, rel);
      const isChanged = !fs.existsSync(dest) || fs.readFileSync(dest, 'utf-8') !== fs.readFileSync(src, 'utf-8');
      copied++;
      if (isChanged) changed++;
      if (!dryRun) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }
  };
  walk(GENERATED_DATA_DIR);
  return { copied, changed };
}

function run(cmd: string, args: string[], cwd: string): void {
  console.log(`\n$ ${cmd} ${args.join(' ')}   (in ${path.relative(process.cwd(), cwd) || '.'})`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const selfPkg = readJson<{ name: string; version: string }>(path.join(ASSET_REPO_ROOT, 'package.json'));
  const version = selfPkg.version;

  console.log(`\nSyncing ${PACKAGE_NAME}@${version} → Beadloo at ${opts.dir}${opts.dryRun ? '  (dry-run)' : ''}`);

  const beadlooPkgPath = path.join(opts.dir, 'package.json');
  const metadataDir = path.join(opts.dir, 'src', 'lib', 'beads', 'metadata');
  if (!fs.existsSync(beadlooPkgPath) || !fs.existsSync(metadataDir)) {
    console.warn(`\n⚠ Beadloo not found at ${opts.dir} (no package.json / metadata dir). Nothing to do — skipping.`);
    console.warn('  Pass --dir <path> or set BEADLOO_DIR if it lives elsewhere.');
    return; // exit 0 — safe for CI publishes
  }

  // 1) dependency version
  const depResult = bumpDependency(beadlooPkgPath, version, opts.dryRun);
  if (depResult === 'missing') {
    console.warn(`⚠ ${PACKAGE_NAME} is not a dependency in Beadloo's package.json — leaving it as-is.`);
  } else {
    console.log(`• dependency ${PACKAGE_NAME} → ${version} (${depResult})`);
  }

  // 2) colorMappings + metadata JSON
  const { copied, changed } = copyMetadataJson(metadataDir, opts.dryRun);
  console.log(`• metadata JSON: ${copied} files mirrored (${changed} changed) → src/lib/beads/metadata/`);

  if (opts.dryRun) {
    console.log('\nDry-run complete — no files written, no install run.');
    return;
  }

  // 3) install the new package + refresh the served thumbnails. These are non-fatal: the colorMappings
  //    copy + version bump above are what the live preview needs and are already applied, so a failure
  //    here (commonly a brand-new publish hitting pnpm's minimum-release-age supply-chain policy) must
  //    not look like the whole sync failed.
  let installed = true;
  if (opts.install) {
    try {
      run('pnpm', ['install'], opts.dir);
    } catch {
      installed = false;
      console.warn(`\n⚠ \`pnpm install\` in Beadloo failed — the colorMappings/metadata copy and the`);
      console.warn(`  version bump ARE applied (the preview reads those), only pulling the new package +`);
      console.warn(`  refreshing thumbnails is pending. A common cause right after publishing is pnpm's`);
      console.warn(`  minimum-release-age / supply-chain policy rejecting the just-published`);
      console.warn(`  ${PACKAGE_NAME}@${version} as too new. Finish it once it ages past the policy window:`);
      console.warn(`      (cd ${opts.dir} && pnpm install && pnpm run copy-bead-assets --force)`);
    }
  } else {
    console.log('\n• skipped pnpm install (--no-install)');
  }
  if (opts.thumbnails && installed) {
    try {
      run('node', ['scripts/copy-bead-assets.mjs', '--force'], opts.dir);
    } catch {
      console.warn('⚠ thumbnail refresh failed — run `pnpm run copy-bead-assets --force` in Beadloo.');
    }
  } else if (opts.thumbnails && !installed) {
    console.log('• skipped thumbnail refresh (install did not complete)');
  } else {
    console.log('• skipped thumbnail refresh (--no-thumbnails)');
  }

  const fully = (!opts.install || installed) && (!opts.thumbnails || installed);
  console.log(`\n${fully ? '✅' : '◑'} Beadloo metadata synced to ${PACKAGE_NAME}@${version}` +
    `${fully ? '.' : ' (install/thumbnails still pending — see above).'}`);
}

main();
