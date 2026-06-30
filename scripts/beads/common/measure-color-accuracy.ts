#!/usr/bin/env tsx
/**
 * Read-only colour-accuracy measurement + visual contact sheet.
 *
 * Quantifies how far the bead colours are from the true bead-body colour, with no writes to the
 * asset tree (only an optional PNG contact sheet under `outputs/`). Run it BEFORE a regeneration to
 * baseline how many beads were "not close enough", and AFTER to prove the fix.
 *
 * For every bead it compares three things, all in CIEDE2000 ΔE:
 *   • stored  — the hex currently in `<size>-colors.json` (what the Beadloo app consumes today)
 *   • fresh   — re-running the current shared sampler on the original photo
 *   • render  — the 16x16 thumbnail's coverage-weighted area-average
 *
 *   ΔE(stored, fresh)  → before regen: how much each bead WILL change (i.e. how wrong it was);
 *                        after regen: should be ~0 (confirms the new code actually wrote the data).
 *   ΔE(render, fresh)  → the 16x16 render is calibrated to the sampled colour; should be ≤ ~3.
 *
 * Ground truth is ultimately the human eye: the contact sheet places a magnified patch of the real
 * beads next to the stored and fresh swatches and the 16x16 render, sorted worst-first, so the
 * biggest movers can be eyeballed ("is the gold actually gold?").
 *
 * Usage:
 *   tsx scripts/beads/common/measure-color-accuracy.ts [--type miyuki-delica] [--no-montage] [--limit N]
 */

import * as fs from 'fs';
import * as path from 'path';
import { differenceCiede2000, converter } from 'culori';
import sharp from 'sharp';
import {
  GENERATED_DATA_DIR,
  ASSET_OUTPUTS_DIR,
  getBeadTypeDirectory,
  getDownloadedBeadTypeDirectory,
} from './lib/paths.js';
import { collectBeadColorSources } from './extract-colors.js';
import { classifyBead } from './lib/beadRender.js';
import { sampleBaseColorHex, colorHintsFromInfo, rgb255ToOklab, oklabToRgb255, rgbToHex } from './lib/colorSampler.js';

const toRgb = converter('rgb');
const ciede2000 = differenceCiede2000();
function deltaE(a: string, b: string): number {
  return ciede2000(toRgb(a), toRgb(b));
}

interface BeadRecord {
  beadType: string;
  size: string;
  beadId: string;
  imagePath: string;
  metadata: Record<string, unknown> | undefined;
  multiColor: boolean;
  stored: string | null;
  fresh: string;
  render: string | null;
  deStoredFresh: number | null;
  deRenderFresh: number | null;
}

// ----------------------------------------------------------------------------
// discovery
// ----------------------------------------------------------------------------

function findColorFiles(root: string): Array<{ beadType: string; size: string; filePath: string }> {
  const out: Array<{ beadType: string; size: string; filePath: string }> = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      const m = entry.name.match(/^(.+)-colors\.json$/);
      if (!m) continue;
      const rel = path.relative(root, path.dirname(p));
      const segments = rel === '' ? [] : rel.split(path.sep).filter(Boolean);
      if (segments.length === 0) continue;
      out.push({ beadType: segments.join('-'), size: m[1], filePath: p });
    }
  };
  walk(root);
  return out.sort((l, r) => (l.beadType !== r.beadType ? l.beadType.localeCompare(r.beadType) : Number(l.size) - Number(r.size)));
}

// ----------------------------------------------------------------------------
// 16x16 render coverage-weighted average
// ----------------------------------------------------------------------------

async function render16AverageHex(thumb16Path: string): Promise<string | null> {
  if (!fs.existsSync(thumb16Path)) return null;
  // The shipped JPEG has no alpha, so reconstruct a coverage mask by discounting the known dark
  // background. This is a proxy (it can't perfectly recover anti-aliased edges) but is good enough
  // to flag a render whose colour drifts from the sampled hex.
  const { data } = await sharp(thumb16Path).resize(16, 16).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bg = rgb255ToOklab(13, 13, 13);
  let L = 0, a = 0, b = 0, w = 0;
  for (let i = 0; i + 2 < data.length; i += 3) {
    const c = rgb255ToOklab(data[i], data[i + 1], data[i + 2]);
    const dist = Math.hypot(c.L - bg.L, c.a - bg.a, c.b - bg.b);
    const weight = Math.min(1, dist / 0.08); // ~0 at background, 1 well away from it
    L += c.L * weight; a += c.a * weight; b += c.b * weight; w += weight;
  }
  if (w <= 0) return null;
  const rgb = oklabToRgb255({ L: L / w, a: a / w, b: b / w });
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

// ----------------------------------------------------------------------------
// measurement
// ----------------------------------------------------------------------------

function isMultiColor(metadata: Record<string, unknown> | undefined): boolean {
  const info = classifyBead(metadata ?? {});
  return info.iris || info.picasso || info.silk;
}

async function measureType(beadType: string, size: string, colorsFile: string): Promise<BeadRecord[]> {
  const stored = JSON.parse(fs.readFileSync(colorsFile, 'utf-8')).colorMappings as Record<string, string>;
  const beadsDir = getBeadTypeDirectory(beadType, size);
  const originalDir = getDownloadedBeadTypeDirectory(beadType, size);
  const sources = collectBeadColorSources(beadsDir, originalDir).filter((s) => s.imagePath);

  const records: BeadRecord[] = [];
  for (const s of sources) {
    const metadata = s.metadata as Record<string, unknown> | undefined;
    const fresh = await sampleBaseColorHex(s.imagePath as string, colorHintsFromInfo(classifyBead(metadata ?? {})));
    const thumb16 = path.join(beadsDir, `${s.beadId}_16x16.jpg`);
    const render = await render16AverageHex(thumb16);
    const storedHex = stored[s.beadId] ?? null;
    records.push({
      beadType, size, beadId: s.beadId, imagePath: s.imagePath as string, metadata,
      multiColor: isMultiColor(metadata),
      stored: storedHex, fresh, render,
      deStoredFresh: storedHex ? deltaE(storedHex, fresh) : null,
      deRenderFresh: render ? deltaE(render, fresh) : null,
    });
  }
  return records;
}

// ----------------------------------------------------------------------------
// reporting
// ----------------------------------------------------------------------------

function bucketize(values: number[]): string {
  const b = { '<=1': 0, '<=2': 0, '<=3': 0, '<=5': 0, '>5': 0 };
  for (const v of values) {
    if (v <= 1) b['<=1']++; else if (v <= 2) b['<=2']++; else if (v <= 3) b['<=3']++; else if (v <= 5) b['<=5']++; else b['>5']++;
  }
  const n = Math.max(1, values.length);
  const pct = (x: number): string => `${((x / n) * 100).toFixed(1)}%`;
  return `≤1 ${b['<=1']} (${pct(b['<=1'])})  ≤2 ${b['<=2']} (${pct(b['<=2'])})  ≤3 ${b['<=3']} (${pct(b['<=3'])})  ≤5 ${b['<=5']} (${pct(b['<=5'])})  >5 ${b['>5']} (${pct(b['>5'])})`;
}

function summarize(label: string, values: number[]): void {
  if (values.length === 0) { console.log(`  ${label}: (none)`); return; }
  const sorted = values.slice().sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const p = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  console.log(`  ${label}: n=${values.length} mean=${mean.toFixed(2)} median=${p(0.5).toFixed(2)} p90=${p(0.9).toFixed(2)} max=${sorted[sorted.length - 1].toFixed(2)}`);
  console.log(`     buckets: ${bucketize(values)}`);
}

// ----------------------------------------------------------------------------
// contact sheet (PNG under outputs/)
// ----------------------------------------------------------------------------

async function swatch(hex: string, w: number, h: number): Promise<Buffer> {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();
}

async function buildContactSheet(records: BeadRecord[], outPath: string, limit: number): Promise<void> {
  const movers = records.filter((r) => r.deStoredFresh !== null).sort((a, b) => (b.deStoredFresh ?? 0) - (a.deStoredFresh ?? 0));
  const worst = movers.slice(0, limit);
  const cell = 64, cols = 4; // [real patch][stored][fresh][render16]
  const rowH = cell, rowW = cell * cols;
  const rows: Buffer[] = [];
  for (const r of worst) {
    const m = await sharp(r.imagePath).metadata();
    const W = m.width ?? 0, H = m.height ?? 0, side = 48;
    const left = Math.max(0, Math.floor((W - side) / 2)), top = Math.max(0, Math.floor((H - side) / 2));
    const patch = await sharp(r.imagePath).extract({ left, top, width: Math.min(side, W), height: Math.min(side, H) }).resize(cell, cell, { kernel: 'nearest' }).png().toBuffer();
    const comps: Array<{ input: Buffer; left: number; top: number }> = [{ input: patch, left: 0, top: 0 }];
    comps.push({ input: await swatch(r.stored ?? '#000000', cell, cell), left: cell, top: 0 });
    comps.push({ input: await swatch(r.fresh, cell, cell), left: cell * 2, top: 0 });
    const thumb16 = path.join(getBeadTypeDirectory(r.beadType, r.size), `${r.beadId}_16x16.jpg`);
    if (fs.existsSync(thumb16)) comps.push({ input: await sharp(thumb16).resize(cell, cell, { kernel: 'nearest' }).png().toBuffer(), left: cell * 3, top: 0 });
    rows.push(await sharp({ create: { width: rowW, height: rowH, channels: 3, background: { r: 15, g: 15, b: 15 } } }).composite(comps).png().toBuffer());
  }
  if (rows.length === 0) return;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp({ create: { width: rowW, height: rowH * rows.length, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(rows.map((b, i) => ({ input: b, left: 0, top: i * rowH })))
    .png().toFile(outPath);
  console.log(`\nContact sheet (worst ${rows.length} movers): ${outPath}`);
  console.log('  columns: [real beads] [stored hex] [fresh hex] [16x16 render]');
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const typeFilter = argv.includes('--type') ? argv[argv.indexOf('--type') + 1] : undefined;
  const montage = !argv.includes('--no-montage');
  const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 80;

  const colorFiles = findColorFiles(GENERATED_DATA_DIR).filter((c) => !typeFilter || c.beadType === typeFilter);
  if (colorFiles.length === 0) {
    console.error(`No *-colors.json found under ${GENERATED_DATA_DIR}${typeFilter ? ` for type ${typeFilter}` : ''}`);
    process.exit(1);
  }

  console.log(`\nMeasuring colour accuracy across ${colorFiles.length} type/size datasets...\n`);
  const all: BeadRecord[] = [];
  for (const cf of colorFiles) {
    const recs = await measureType(cf.beadType, cf.size, cf.filePath);
    all.push(...recs);
    const changed = recs.map((r) => r.deStoredFresh).filter((v): v is number => v !== null);
    const over3 = changed.filter((v) => v > 3).length;
    console.log(`${cf.beadType} ${cf.size}/0 — ${recs.length} beads, ${over3} with ΔE(stored,fresh)>3`);
  }

  const single = all.filter((r) => !r.multiColor);
  const multi = all.filter((r) => r.multiColor);

  console.log('\n================ ΔE(stored hex → fresh sample) — how wrong the data is ================');
  summarize('all', all.map((r) => r.deStoredFresh).filter((v): v is number => v !== null));
  summarize('single-colour (hard gate)', single.map((r) => r.deStoredFresh).filter((v): v is number => v !== null));
  summarize('multi-colour (iris/picasso/silk, reported only)', multi.map((r) => r.deStoredFresh).filter((v): v is number => v !== null));

  console.log('\n================ ΔE(16x16 render avg → fresh sample) — render consistency ============');
  summarize('all', all.map((r) => r.deRenderFresh).filter((v): v is number => v !== null));

  // Worst offenders
  const worst = all.filter((r) => r.deStoredFresh !== null).sort((a, b) => (b.deStoredFresh ?? 0) - (a.deStoredFresh ?? 0)).slice(0, 25);
  console.log('\n================ 25 biggest stored→fresh movers ================');
  for (const r of worst) {
    console.log(`  ${`${r.beadType} ${r.beadId}`.padEnd(40)} ${r.stored} → ${r.fresh}  ΔE=${(r.deStoredFresh ?? 0).toFixed(1)}${r.multiColor ? '  [multi]' : ''}`);
  }

  if (montage) {
    await buildContactSheet(all, path.join(ASSET_OUTPUTS_DIR, 'color-accuracy-contact-sheet.png'), limit);
  }

  console.log('');
}

main().catch((error) => {
  console.error('measure-color-accuracy failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
