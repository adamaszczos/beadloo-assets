/**
 * The reviewed evidence for round rocailles only shops vouch for (`sources/miyuki/retailer/round-rocailles.csv`)
 * and the rule a row must meet before such a bead is added: the one written exception to official-only
 * sources (`sources/miyuki/README.md`, decided 2026-10-23). Read by the adder and by the audit, which
 * fails on a retailer bead without a row that meets it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT } from '../../common/lib/paths.js';
import { parseCsv } from './csv.js';
import { isRoundRocailleId, isRoundRocailleSize } from './round-rocaille-ids.js';

export const RETAILER_EVIDENCE_PATH = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'retailer', 'round-rocailles.csv');
export const MIN_SHOPS = 3;
export const MIN_PHOTOS = 3;

export type RetailerRow = Record<string, string>;

/** Where a retailer bead's image comes from: never a shop's photo. */
export type RetailerImage = { kind: 'rendered'; colour: string } | { kind: 'miyuki'; size: string; band: boolean };

/** `miyuki-15`: Miyuki's photo of the colour at 15/0; `-band` keeps only the rows where the beads are. */
const MIYUKI_IMAGE = /^miyuki-(\d+)(-band)?$/;
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
/** Columns a row must fill: the sidecar's attributes and what the registry row cites. */
const REQUIRED = ['name', 'listings', 'colour_from', 'glassGroup', 'finish', 'dyed', 'galvanized', 'plating', 'metadata_evidence'];

export function retailerImage(row: RetailerRow): RetailerImage | null {
  if (row.image === 'rendered') return HEX_COLOUR.test(row.colour ?? '') ? { kind: 'rendered', colour: row.colour } : null;
  const match = MIYUKI_IMAGE.exec(row.image ?? '');
  return match ? { kind: 'miyuki', size: match[1], band: Boolean(match[2]) } : null;
}

/** A count column as a whole number, or null when it is blank or not one. */
function count(value: string | undefined): number | null {
  return /^\d+$/.test((value ?? '').trim()) ? Number(value) : null;
}

/** Why a row is not taken, or null when the evidence meets the rule. */
export function retailerRowProblem(row: RetailerRow): string | null {
  if (!isRoundRocailleId(row.colour_no ?? '')) return `colour number "${row.colour_no ?? ''}" is not a round-rocaille number`;
  if (!isRoundRocailleSize(row.size ?? '')) return `size "${row.size ?? ''}" is not a round-rocaille size`;
  const shops = count(row.shops);
  if (shops === null) return `shops "${row.shops ?? ''}" is not a count`;
  if (shops < MIN_SHOPS) return `only ${shops} shops`;
  const photos = count(row.independent_photos);
  if (photos === null) return `independent_photos "${row.independent_photos ?? ''}" is not a count`;
  if (photos < MIN_PHOTOS) return `only ${photos} independent photos`;
  const blank = REQUIRED.find((column) => !(row[column] ?? '').trim());
  if (blank) return `no ${blank}`;
  if (row.image === 'rendered' && !HEX_COLOUR.test(row.colour ?? '')) return 'rendered without a colour';
  const image = retailerImage(row);
  if (!image) return `unknown image "${row.image ?? ''}"`;
  if (image.kind === 'miyuki' && !isRoundRocailleSize(image.size)) return `image from size ${image.size}/0, which is not a round-rocaille size`;
  if (image.kind === 'miyuki' && image.size === row.size) return `image "${row.image}" is the size being added: a photo of the colour at another size is required`;
  return null;
}

export function readRetailerEvidence(file = RETAILER_EVIDENCE_PATH): RetailerRow[] {
  return fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf-8')) : [];
}
