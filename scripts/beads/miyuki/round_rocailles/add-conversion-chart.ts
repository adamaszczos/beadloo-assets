#!/usr/bin/env tsx
/**
 * Adds the 11/0 round rocailles Miyuki's 2007 Delica↔Round conversion chart names and Beadloo lacks
 * at 11/0, when Beadloo already holds a Miyuki photo of the same colour at another size (issue #203).
 *
 * The chart (`sources/miyuki/official/conversion-chart-2007/`, Miyuki's English site, archived
 * 2007-07-03) pairs each "11/0 RR" colour with its Delica twin, so it states the colour existed at 11/0:
 *
 * - a number printed with a slash is left out: `3300/L` is the `RL` finish (Miyuki's old/new table
 *   writes `155/L(155RL)`, `417L/L(417L-RL)`), `0141D/FR` two finishes at once;
 * - a number Miyuki's old/new colour table renames is an old number of a current bead: reported, never added;
 * - image: the same colour's Miyuki photo at another size (as catalogue decision D1), colour accuracy `photo`;
 * - metadata: that bead's sidecar (colour group kept only from a directory sidecar);
 * - a colour with no Miyuki photo at any size is not added: it is listed, with its Delica twin.
 *
 * Each page must parse to its 830 pairs, or the run stops: a page that reads differently is not the
 * snapshot whose hash `sources/miyuki/README.md` records.
 *
 * Usage: pnpm beads:miyuki:round_rocailles:add-conversion-chart [--dry-run]
 */
import * as fs from 'fs';
import * as path from 'path';
import { readRegistry, registryKey, todayIso, writeBeadsAndRegistry, type RegistryRow } from '../common/registry.js';
import { OFFICIAL_DIR, readColorChangeTsv, renumbering } from '../common/official-lists.js';
import { isInLibrary, isPhotoDonor, originalPath, prepareOriginalTarget, readSidecar, writeSidecar, type Sidecar } from '../common/bead-files.js';
import { isRoundRocailleId } from '../common/round-rocaille-ids.js';
import { DONOR_SIZES, buildRoundRocailleSidecar } from '../catalogue/add-round-rocaille-beads.js';

const BEAD_TYPE = 'miyuki-round_rocailles' as const;
const SIZE = '11';
const CHART_DIR = path.join(OFFICIAL_DIR, 'conversion-chart-2007');
/** Pair rows each page prints under its header: the same 830 pairs, in the two orders. */
export const CHART_ROWS = 830;
const CHARTS = [
  { file: 'round-to-delica_08_02.html', roundFirst: true, url: 'https://web.archive.org/web/20070703105325/http://www.miyuki-beads.co.jp:80/english/seed/08_02.html' },
  { file: 'delica-to-round_08_01.html', roundFirst: false, url: 'https://web.archive.org/web/20070703105219/http://www.miyuki-beads.co.jp:80/english/seed/08_01.html' },
];
/** The cell over each column: `11/0 RR` and `Delica No.`. */
const HEADER_CELL = /^(11\/0\s*RR|Delica\s+No\.?)$/i;

export type ChartPair = { printed: string; roundId: string; delica: string };

/**
 * Beadloo's id for a round number as the chart prints it, zeros dropped; null for a slash form, which
 * names no single bead (the header says why). Text that is neither throws: the page did not read as
 * expected.
 */
export function chartRoundId(printed: string): string | null {
  const text = printed.replace(/\s+/g, '').toUpperCase();
  if (text.includes('/')) return null;
  const id = text.replace(/^0+(?=\d)/, '');
  if (!isRoundRocailleId(id)) throw new Error(`conversion chart: "${printed}" is not a round-rocaille number`);
  return id;
}

/** The chart's two-cell rows below the header, `11/0 RR` and `Delica No.` in the order the page prints them: the pairs read, and the printed numbers left out. */
export function parseConversionChartHtml(html: string, roundFirst: boolean): { pairs: ChartPair[]; leftOut: string[] } {
  const pairs: ChartPair[] = [];
  const leftOut: string[] = [];
  for (const row of html.match(/<TR\b[^>]*>[\s\S]*?<\/TR>/gi) ?? []) {
    const cells = Array.from(row.matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi), (m) => m[1].replace(/<[^>]+>/g, '').trim());
    // The page's layout rows have one or three cells; the table's own rows two.
    if (cells.length !== 2 || cells.every((cell) => HEADER_CELL.test(cell))) continue;
    const [printed, delica] = roundFirst ? cells : [cells[1], cells[0]];
    const roundId = chartRoundId(printed);
    if (roundId) pairs.push({ printed, roundId, delica });
    else leftOut.push(printed);
  }
  return { pairs, leftOut };
}

export type PlannedChartBead = { beadId: string; pair: ChartPair; url: string; donorSize: string; donor: Sidecar; donorSource: string };

/**
 * The chart's colours to add at 11/0, first page first: not yet in the library, not an old number of a
 * current bead, and with Miyuki's photo at another size (`isPhotoDonor`) and that bead's sidecar.
 */
export function planConversionChartBeads(
  charts: ReadonlyArray<{ url: string; pairs: ReadonlyArray<ChartPair> }>,
  library: {
    registry: ReadonlyMap<string, RegistryRow>;
    inLibrary: (beadId: string) => boolean;
    renumberedTo: (beadId: string) => string | null;
    originalExists: (size: string, beadId: string) => boolean;
    sidecar: (size: string, beadId: string) => Sidecar | null;
  },
): { planned: PlannedChartBead[]; colours: number; oldNumbers: string[]; noPhoto: string[] } {
  const seen = new Set<string>();
  const planned: PlannedChartBead[] = [];
  const oldNumbers: string[] = [];
  const noPhoto: string[] = [];
  for (const chart of charts) {
    for (const pair of chart.pairs) {
      if (seen.has(pair.roundId)) continue;
      seen.add(pair.roundId);
      if (library.inLibrary(pair.roundId)) continue;
      const unified = library.renumberedTo(pair.roundId);
      if (unified) { oldNumbers.push(`${pair.roundId} → ${unified}`); continue; }
      const donorSize = DONOR_SIZES.find((size) => isPhotoDonor(pair.roundId, size, SIZE, library.registry, library.originalExists));
      const donor = donorSize ? library.sidecar(donorSize, pair.roundId) : null;
      if (!donorSize || !donor) { noPhoto.push(`${pair.roundId} (DB${pair.delica})`); continue; }
      planned.push({ beadId: pair.roundId, pair, url: chart.url, donorSize, donor, donorSource: library.registry.get(registryKey(pair.roundId, donorSize))!.listingSource });
    }
  }
  return { planned, colours: seen.size, oldNumbers, noPhoto };
}

export function chartRegistryRow(entry: PlannedChartBead, addedOn = todayIso()): RegistryRow {
  return {
    beadId: entry.beadId,
    size: SIZE,
    listingSource: 'conversion-chart-2007',
    imageSource: 'same-colour-other-size',
    sizeSource: 'conversion-chart-2007',
    colorAccuracy: 'photo',
    sourceRef: `Miyuki's conversion chart 11/0 Round to Delica, 2007 (${entry.url}): 11/0 RR "${entry.pair.printed}" = DB${entry.pair.delica}; image: Miyuki photo of ${entry.beadId} at ${entry.donorSize}/0 (${entry.donorSource}); metadata: attributes of ${entry.beadId} at ${entry.donorSize}/0`,
    addedOn,
  };
}

function readChart(chart: (typeof CHARTS)[number]): { url: string; pairs: ChartPair[]; leftOut: string[] } {
  const { pairs, leftOut } = parseConversionChartHtml(fs.readFileSync(path.join(CHART_DIR, chart.file), 'utf-8'), chart.roundFirst);
  if (pairs.length + leftOut.length !== CHART_ROWS) throw new Error(`${chart.file}: ${pairs.length + leftOut.length} pair rows, expected ${CHART_ROWS}`);
  return { url: chart.url, pairs, leftOut };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const registry = new Map(readRegistry(BEAD_TYPE).map((row) => [registryKey(row.beadId, row.size), row]));
  const charts = CHARTS.map(readChart);
  const { planned, colours, oldNumbers, noPhoto } = planConversionChartBeads(charts, {
    registry,
    inLibrary: (beadId) => isInLibrary(BEAD_TYPE, SIZE, beadId, registry),
    renumberedTo: renumbering(readColorChangeTsv()),
    originalExists: (size, beadId) => fs.existsSync(originalPath(BEAD_TYPE, size, beadId)),
    sidecar: (size, beadId) => readSidecar(BEAD_TYPE, size, beadId),
  });
  console.log(`2007 conversion chart: ${colours} round colours (left out, a slash form: ${charts[0].leftOut.join(' ')}); missing at 11/0 with a Miyuki photo at another size: ${planned.length}`);
  console.log(`  old numbers of current beads (not added): ${oldNumbers.length} ${oldNumbers.slice(0, 12).join(', ')}`);
  console.log(`  no Miyuki photo at any size (not added): ${noPhoto.length}`);
  console.log(`  to add${dryRun ? ' (dry run)' : ''}: ${planned.map((p) => `${p.beadId}←${p.donorSize}/0`).join(' ')}`);
  if (dryRun || planned.length === 0) return;
  const added = await writeBeadsAndRegistry(BEAD_TYPE, planned, (entry) => {
    const target = originalPath(BEAD_TYPE, SIZE, entry.beadId);
    prepareOriginalTarget(target);
    fs.copyFileSync(originalPath(BEAD_TYPE, entry.donorSize, entry.beadId), target);
    writeSidecar(BEAD_TYPE, SIZE, entry.beadId, buildRoundRocailleSidecar(SIZE, entry.donor, { squareHole: false, colorAccuracy: 'photo', keepColorGroup: entry.donorSource === 'directory' }));
    return chartRegistryRow(entry);
  });
  console.log(`  wrote ${planned.length} originals + sidecars, ${added} registry rows`);
  console.log('\nNext: pnpm beads:miyuki:round_rocailles:sync -- --local-only');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nadd-conversion-chart failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
