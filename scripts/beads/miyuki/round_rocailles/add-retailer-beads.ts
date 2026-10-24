#!/usr/bin/env tsx
/**
 * Adds round rocailles that shops sell as Miyuki beads at a size no Miyuki document names, from the
 * reviewed `sources/miyuki/retailer/round-rocailles.csv` (issue #203; the survey behind it is
 * `sources/miyuki/retailer/survey-2026-10-23.md`). Such a bead carries `confirmation: "Retailer"`,
 * which the app shows as "Not confirmed by Miyuki", and `colorAccuracy: "approximate"`.
 *
 * A row is taken only with at least three shops and three independent photos (one photo set shared by
 * several shops counts once); `common/retailer-evidence.ts` holds the rule. Its image is never a shop's photo:
 * - `miyuki-<size>`: Miyuki's own photo of the same colour number at another size, already in the
 *   library (its registry row says `photo` from a Miyuki source);
 * - `rendered`: a bead drawn by the thumbnail renderer in the row's colour (measured from the shops'
 *   photos), calibrated until the colour sampler reads that colour back from the original.
 *
 * Every image is made before the first bead is written, so a row that cannot be done stops the run
 * with nothing written.
 *
 * Usage: pnpm beads:miyuki:round_rocailles:add-retailer [--dry-run]
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { readRegistry, registryKey, todayIso, writeBeadsAndRegistry, type RegistryRow } from '../common/registry.js';
import { isInLibrary, isPhotoDonor, originalPath, prepareOriginalTarget, writeSidecar } from '../common/bead-files.js';
import { readRetailerEvidence, retailerImage, retailerRowProblem, type RetailerImage, type RetailerRow } from '../common/retailer-evidence.js';
import { classifyBead, renderBead, RENDER_SUPERSAMPLE, type BeadSample } from '../../common/lib/beadRender.js';
import { colorHintsFromInfo, oklabToRgb255, rgb255ToOklab, sampleBaseColor, type RGB } from '../../common/lib/colorSampler.js';

const BEAD_TYPE = 'miyuki-round_rocailles' as const;
const GRID = { columns: 3, rows: 2 };
/** How dark the gaps between rendered beads are, as a share of the bead's colour. */
const GAP_SHADE = 0.75;
/** Share of each measured miss corrected per pass: a full step overshoots on the sampler's trimmed mean. */
const CALIBRATION_STEP = 0.7;
/** Render-and-measure passes before the calibration settles for its closest one. */
const CALIBRATION_PASSES = 8;
/** OKLab distance at which the sampler's reading counts as the row's colour, ending the calibration. */
const CALIBRATION_TOLERANCE = 0.004;
/**
 * The largest OKLab miss written at all; a worse one stops the run. One and a half just-noticeable
 * differences (~0.02): saturated colours settle a little above one (2045's pink at 0.023 on 2026-10-24),
 * while a calibration that went wrong (the sampler reading the gaps) misses by far more.
 */
const CALIBRATION_MAX_MISS = 0.03;
/** Channel spread (0-255) above which a pixel counts as coloured: a bead is, a grey shadow is not. */
const COLOURED_SPREAD = 30;
/** Share of a row's pixels that must be coloured, at the strand's densest row, for the photo to have a bead band. */
const BAND_MIN_PEAK = 0.8;
/** A row belongs to the band when its coloured share reaches this fraction of the densest row's. */
const BAND_EDGE = 0.6;

/**
 * The rows of a card strand photo where coloured pixels dominate: the beads, without the grey shadow
 * band a sample card's lighting casts under the strand, which the colour sampler would otherwise read
 * as the bead. Only for a strongly coloured strand; null when there is no such band.
 */
export function colouredRowBand(pixels: Uint8Array, width: number, height: number, channels: number): { top: number; bottom: number } | null {
  const coverage: number[] = [];
  for (let y = 0; y < height; y++) {
    let coloured = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      // A one-channel (grey) photo has no colour to find: its spread is zero.
      const spread = channels >= 3 ? Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) : 0;
      if (spread > COLOURED_SPREAD) coloured++;
    }
    coverage.push(coloured / width);
  }
  const peak = Math.max(...coverage);
  if (peak < BAND_MIN_PEAK) return null;
  const top = coverage.findIndex((c) => c >= peak * BAND_EDGE);
  const bottom = height - [...coverage].reverse().findIndex((c) => c >= peak * BAND_EDGE);
  return { top, bottom };
}

export function retailerSidecar(row: RetailerRow): Record<string, string> {
  return {
    shape: 'Round Rocailles',
    size: `${row.size}/0`,
    glassGroup: row.glassGroup,
    finish: row.finish,
    dyed: row.dyed,
    galvanized: row.galvanized,
    plating: row.plating,
    colorAccuracy: 'approximate',
    confirmation: 'Retailer',
  };
}

export function retailerRegistryRow(row: RetailerRow, addedOn = todayIso()): RegistryRow {
  const source = retailerImage(row);
  const image = source?.kind === 'miyuki'
    ? `Miyuki photo of ${row.colour_no} at ${source.size}/0 (${row.colour_from})${source.band ? ', cropped to the bead rows' : ''}`
    : `rendered bead in ${row.colour}, the ${row.colour_from}`;
  return {
    beadId: row.colour_no,
    size: row.size,
    listingSource: 'retailer',
    imageSource: source?.kind === 'miyuki' ? 'same-colour-other-size' : 'rendered',
    sizeSource: 'retailer',
    colorAccuracy: 'approximate',
    sourceRef: `not in any Miyuki document at ${row.size}/0; sold as Miyuki ${row.size}/0 round rocaille ${row.colour_no} "${row.name}" by ${row.shops} shops with ${row.independent_photos} independent photos (sources/miyuki/retailer/survey-2026-10-23.md), e.g. ${row.listings.split(' ').join(', ')}; image: ${image}; metadata: ${row.metadata_evidence}`,
    addedOn,
  };
}

export type PlannedRetailerBead = { row: RetailerRow; image: RetailerImage };

/**
 * The rows to add: the evidence meets the rule, the bead is not yet in the library, and a borrowed image
 * is Miyuki's photo of the colour at another size (`isPhotoDonor`). The rest are reported with the reason.
 */
export function planRetailerBeads(
  rows: ReadonlyArray<RetailerRow>,
  library: { inLibrary: (beadId: string, size: string) => boolean; photoDonor: (beadId: string, donorSize: string, size: string) => boolean },
): { planned: PlannedRetailerBead[]; notTaken: string[] } {
  const planned: PlannedRetailerBead[] = [];
  const notTaken: string[] = [];
  for (const row of rows) {
    const label = `${row.colour_no}@${row.size}`;
    const problem = retailerRowProblem(row);
    const image = retailerImage(row);
    if (problem || !image) { notTaken.push(`${label}: ${problem}`); continue; }
    if (library.inLibrary(row.colour_no, row.size)) continue;
    if (image.kind === 'miyuki' && !library.photoDonor(row.colour_no, image.size, row.size)) {
      notTaken.push(`${label}: no Miyuki photo of ${row.colour_no} at ${image.size}/0 in the library to borrow`);
      continue;
    }
    planned.push({ row, image });
  }
  return { planned, notTaken };
}

// ============================================================================
// Images
// ============================================================================

function hexToRgb(hex: string): RGB {
  return { r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16) };
}

/** Miyuki's photo at another size as the original, cut to its bead rows for `-band`. */
async function miyukiPhotoOriginal(beadId: string, image: Extract<RetailerImage, { kind: 'miyuki' }>): Promise<Buffer> {
  const source = originalPath(BEAD_TYPE, image.size, beadId);
  if (!image.band) return fs.readFileSync(source);
  const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rows = colouredRowBand(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, info.channels);
  if (!rows) throw new Error(`${source}: no coloured band to keep`);
  return sharp(source).extract({ left: 0, top: rows.top, width: info.width, height: rows.bottom - rows.top }).jpeg({ quality: 95 }).toBuffer();
}

/**
 * A small heap of identical rendered beads. The gaps between the round silhouettes are the bead's own
 * colour in shadow: a neutral background there is read by the sampler's centre crop and pulls the
 * measured colour (and so the calibration) towards grey.
 */
async function renderOriginal(base: RGB, metadata: Record<string, string>): Promise<Buffer> {
  const bead = renderBead({ base } satisfies BeadSample, classifyBead(metadata));
  const tile = await sharp(bead, { raw: { width: RENDER_SUPERSAMPLE, height: RENDER_SUPERSAMPLE, channels: 4 } }).png().toBuffer();
  const composites = [];
  for (let row = 0; row < GRID.rows; row++) for (let column = 0; column < GRID.columns; column++) composites.push({ input: tile, left: column * RENDER_SUPERSAMPLE, top: row * RENDER_SUPERSAMPLE });
  const shadow = { r: Math.round(base.r * GAP_SHADE), g: Math.round(base.g * GAP_SHADE), b: Math.round(base.b * GAP_SHADE) };
  return sharp({ create: { width: GRID.columns * RENDER_SUPERSAMPLE, height: GRID.rows * RENDER_SUPERSAMPLE, channels: 3, background: shadow } })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Render, measure with the pipeline's sampler (which reads a file, hence `scratch`), shift the base
 * colour by the miss in OKLab, until it reads back. Keeps the closest pass, since a later one can
 * overshoot, and throws when even that misses by more than CALIBRATION_MAX_MISS.
 */
export async function calibratedRenderedOriginal(row: RetailerRow, colour: string, scratch: string): Promise<{ jpeg: Buffer; miss: number }> {
  const { r, g, b } = hexToRgb(colour);
  const goal = rgb255ToOklab(r, g, b);
  const metadata = retailerSidecar(row);
  const hints = colorHintsFromInfo(classifyBead(metadata));
  const probe = path.join(scratch, `${row.colour_no}-${row.size}.jpg`);
  let base = { ...goal };
  let best: { miss: number; jpeg: Buffer | null } = { miss: Infinity, jpeg: null };
  for (let pass = 0; pass < CALIBRATION_PASSES && best.miss > CALIBRATION_TOLERANCE; pass++) {
    const jpeg = await renderOriginal(oklabToRgb255(base), metadata);
    fs.writeFileSync(probe, jpeg);
    const read = await sampleBaseColor(probe, hints);
    const got = rgb255ToOklab(read.r, read.g, read.b);
    const miss = Math.hypot(goal.L - got.L, goal.a - got.a, goal.b - got.b);
    if (miss < best.miss) best = { miss, jpeg };
    base = { L: base.L + (goal.L - got.L) * CALIBRATION_STEP, a: base.a + (goal.a - got.a) * CALIBRATION_STEP, b: base.b + (goal.b - got.b) * CALIBRATION_STEP };
  }
  if (!best.jpeg || best.miss > CALIBRATION_MAX_MISS) {
    throw new Error(`${row.colour_no}@${row.size}: the rendered bead reads back ${best.miss.toFixed(4)} ΔOK from ${colour} after ${CALIBRATION_PASSES} passes; at most ${CALIBRATION_MAX_MISS} is written`);
  }
  return { jpeg: best.jpeg, miss: best.miss };
}

async function makeOriginal(entry: PlannedRetailerBead, scratch: string): Promise<Buffer> {
  if (entry.image.kind === 'miyuki') return miyukiPhotoOriginal(entry.row.colour_no, entry.image);
  const { jpeg, miss } = await calibratedRenderedOriginal(entry.row, entry.image.colour, scratch);
  console.log(`    ${entry.row.colour_no}@${entry.row.size}: calibrated to within ΔOK ${miss.toFixed(4)}`);
  return jpeg;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const registry = new Map(readRegistry(BEAD_TYPE).map((row) => [registryKey(row.beadId, row.size), row]));
  const { planned, notTaken } = planRetailerBeads(readRetailerEvidence(), {
    inLibrary: (beadId, size) => isInLibrary(BEAD_TYPE, size, beadId, registry),
    photoDonor: (beadId, donorSize, size) => isPhotoDonor(beadId, donorSize, size, registry, (s, id) => fs.existsSync(originalPath(BEAD_TYPE, s, id))),
  });
  for (const reason of notTaken) console.log(`  not taken: ${reason}`);
  for (const { row, image } of planned) console.log(`  ${row.colour_no}@${row.size}: ${row.image}${image.kind === 'rendered' ? ` ${image.colour}` : ''}${dryRun ? ' (dry run)' : ''}`);
  if (planned.length === 0) return;

  // Every original is made (and every calibration passes) before the first bead is written.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'beadloo-retailer-'));
  const originals = new Map<PlannedRetailerBead, Buffer>();
  try {
    for (const entry of planned) originals.set(entry, await makeOriginal(entry, scratch));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (dryRun) return;
  const added = await writeBeadsAndRegistry(BEAD_TYPE, planned, (entry) => {
    const target = originalPath(BEAD_TYPE, entry.row.size, entry.row.colour_no);
    prepareOriginalTarget(target);
    fs.writeFileSync(target, originals.get(entry)!);
    writeSidecar(BEAD_TYPE, entry.row.size, entry.row.colour_no, retailerSidecar(entry.row));
    return retailerRegistryRow(entry.row);
  });
  console.log(`  wrote ${planned.length} originals + sidecars, ${added} registry rows`);
  console.log('\nNext: pnpm beads:miyuki:round_rocailles:sync -- --local-only');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nadd-retailer-beads failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
