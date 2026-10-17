#!/usr/bin/env tsx
/**
 * One-time migration (2026-10-17, beadloo-assets PR #2): Miyuki's `-1` colours become beads of their
 * own instead of the old numbers' new names.
 *
 * Phases 3 and 4 had renamed each old bead to its `-1` number (`DB0106` → `DB0106-1`, `366` → `366-1`)
 * with `formerly` in the sidecar and an alias. Miyuki's own data says the `-1` is a different product:
 * the official Delica list gives it a Glass Enamel finish where Miyuki's directory still sells the old
 * number as Glazed Luster, and the Delica sample card photographs a visibly different strand. So:
 *
 * - Delica (51, at 11/0): the old number comes back as the directory's bead, with the directory photo
 *   it always had (the bytes now stored under the `-1` name), its sidecar without `formerly`, and the
 *   registry row moved back. The `-1` bead is then rebuilt from card N-2 by
 *   `pnpm beads:miyuki:sample-cards:add-delica`.
 * - Round rocailles (15 file sets): the `-1` file sets are renamed back to the plain numbers the
 *   directory, the catalogue and the cards print. The `-1` seed numbers have no official size, so they
 *   are held (`pnpm beads:miyuki:audit -- --write-hold-out`).
 *
 * Usage: tsx scripts/beads/miyuki/migrations/separate-renumbered-beads.ts [--dry-run]
 */
import * as fs from 'fs';
import * as path from 'path';
import { getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from '../../common/lib/paths.js';
import type { MiyukiBeadType } from '../common/directory-products.js';
import { readDurabilityTsv } from '../common/official-lists.js';
import { readRegistry, writeRegistry, type RegistryRow } from '../common/registry.js';

const DERIVATIVES = ['_16x16.jpg', '_48x48.jpg'];

type Sidecar = Record<string, unknown>;

function withoutFormerly(sidecar: Sidecar): Sidecar {
  const { formerly: _formerly, ...rest } = sidecar;
  return rest;
}

function restoredSourceRef(sourceRef: string, minusOne: string, plain: string): string {
  return sourceRef
    .replace(/; renumbered from [^;]+ per durability\.tsv( Seed#)?/g, '')
    .replace(new RegExp(`(^|[^0-9A-Z])${minusOne.replace(/[-]/g, '\\-')}(?![0-9])`, 'g'), `$1${plain}`);
}

function moveRegistryRow(rows: RegistryRow[], size: string, minusOne: string, plain: string): RegistryRow[] {
  return rows.map((row) =>
    row.size === size && row.beadId.toUpperCase() === minusOne
      ? { ...row, beadId: plain, sourceRef: restoredSourceRef(row.sourceRef, minusOne, plain) }
      : row,
  );
}

function transferFiles(beadType: MiyukiBeadType, size: string, from: string, to: string, mode: 'copy' | 'move', dryRun: boolean): void {
  const beadDir = getBeadTypeDirectory(beadType, size);
  const downloadedDir = getDownloadedBeadTypeDirectory(beadType, size);
  const pairs: Array<[string, string]> = [
    ...DERIVATIVES.map((suffix): [string, string] => [path.join(beadDir, `${from}${suffix}`), path.join(beadDir, `${to}${suffix}`)]),
    [path.join(downloadedDir, `${from}.jpg`), path.join(downloadedDir, `${to}.jpg`)],
  ];
  const sidecarFrom = path.join(beadDir, `${from}.metadata.json`);
  const sidecarTo = path.join(beadDir, `${to}.metadata.json`);
  if (!fs.existsSync(sidecarFrom)) throw new Error(`no sidecar ${sidecarFrom}`);
  if (fs.existsSync(sidecarTo)) throw new Error(`refusing to overwrite ${sidecarTo}`);
  const sidecar = JSON.parse(fs.readFileSync(sidecarFrom, 'utf-8')) as Sidecar;
  if (sidecar.formerly !== to) throw new Error(`${from} at ${size}/0 records formerly=${String(sidecar.formerly)}, expected ${to}`);
  if (dryRun) return;
  for (const [a, b] of pairs) {
    if (!fs.existsSync(a)) continue;
    if (fs.existsSync(b)) throw new Error(`refusing to overwrite ${b}`);
    if (mode === 'copy') fs.copyFileSync(a, b);
    else fs.renameSync(a, b);
  }
  fs.writeFileSync(sidecarTo, `${JSON.stringify(withoutFormerly(sidecar), null, 2)}\n`, 'utf-8');
  if (mode === 'move') fs.unlinkSync(sidecarFrom);
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');

  // Delica: copy back the old number; the -1 stays to be rebuilt from the card.
  let delicaRows = readRegistry('miyuki-delica');
  const delica = readDurabilityTsv().filter((row) => row.renumbered).map((row) => row.beadId);
  for (const minusOne of delica) {
    const plain = minusOne.replace(/-1$/, '');
    transferFiles('miyuki-delica', '11', minusOne, plain, 'copy', dryRun);
    delicaRows = moveRegistryRow(delicaRows, '11', minusOne, plain);
  }
  console.log(`Delica: ${delica.length} old numbers restored beside their -1 colours${dryRun ? ' (dry run)' : ''}`);

  // Round rocailles: every -1 file set goes back to its plain number.
  let roundRows = readRegistry('miyuki-round_rocailles');
  const typeDir = getBeadTypeDirectory('miyuki-round_rocailles');
  const moved: string[] = [];
  for (const size of fs.readdirSync(typeDir).filter((entry) => fs.statSync(path.join(typeDir, entry)).isDirectory())) {
    for (const file of fs.readdirSync(path.join(typeDir, size)).filter((f) => /-1\.metadata\.json$/.test(f))) {
      const minusOne = file.slice(0, -'.metadata.json'.length).toUpperCase();
      const plain = minusOne.replace(/-1$/, '');
      transferFiles('miyuki-round_rocailles', size, minusOne, plain, 'move', dryRun);
      roundRows = moveRegistryRow(roundRows, size, minusOne, plain);
      moved.push(`${minusOne}→${plain}@${size}`);
    }
  }
  // Donor names in other rows (`directory photo of 2023-1 at 11/0`) follow the renamed beads.
  const renamed = new Set(moved.map((m) => m.split('→')[0]));
  roundRows = roundRows.map((row) => {
    let sourceRef = row.sourceRef;
    for (const minusOne of renamed) sourceRef = restoredSourceRef(sourceRef, minusOne, minusOne.replace(/-1$/, ''));
    return sourceRef === row.sourceRef ? row : { ...row, sourceRef };
  });
  console.log(`Round rocailles: ${moved.length} file sets back to the plain number${dryRun ? ' (dry run)' : ''}: ${moved.join(' ')}`);

  if (dryRun) return;
  writeRegistry('miyuki-delica', delicaRows);
  writeRegistry('miyuki-round_rocailles', roundRows);
  console.log('\nNext: pnpm beads:miyuki:sample-cards:add-delica, then the --local-only syncs and pnpm beads:miyuki:audit -- --write-hold-out');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
