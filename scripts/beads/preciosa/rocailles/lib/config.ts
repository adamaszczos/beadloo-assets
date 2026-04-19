import * as fs from 'fs';
import * as path from 'path';
import { BEADS_ROOT } from '../../../common/lib/paths.js';

export interface PreciosaRocaillesDimensions {
  diameter_min_mm: number;
  diameter_max_mm: number;
  diameter_mm: number;
  beads_per_gram: number;
}

export const PRECIOSA_ROCAILLES_SIZES = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '31',
  '32',
  '33',
  '34',
] as const;

export type PreciosaRocaillesSize = (typeof PRECIOSA_ROCAILLES_SIZES)[number];

const PRECIOSA_ROCAILLES_SIZE_LABELS: Record<PreciosaRocaillesSize, `${number}/0`> = {
  '1': '1/0',
  '2': '2/0',
  '3': '3/0',
  '4': '4/0',
  '5': '5/0',
  '6': '6/0',
  '7': '7/0',
  '8': '8/0',
  '9': '9/0',
  '10': '10/0',
  '11': '11/0',
  '12': '12/0',
  '13': '13/0',
  '14': '14/0',
  '15': '15/0',
  '16': '16/0',
  '31': '31/0',
  '32': '32/0',
  '33': '33/0',
  '34': '34/0',
};

type PreciosaRocaillesSizeLabel = (typeof PRECIOSA_ROCAILLES_SIZE_LABELS)[PreciosaRocaillesSize];

const dimensionsPath = path.join(BEADS_ROOT, 'preciosa', 'rocailles', 'rocailles.json');

export const preciosaRocaillesDimensionTable = JSON.parse(
  fs.readFileSync(dimensionsPath, 'utf-8')
) as Record<PreciosaRocaillesSizeLabel, PreciosaRocaillesDimensions>;

export function isPreciosaRocaillesSize(size: string): size is PreciosaRocaillesSize {
  return PRECIOSA_ROCAILLES_SIZES.includes(size as PreciosaRocaillesSize);
}

export function normalizePreciosaRocaillesSize(size?: string | null): PreciosaRocaillesSize | null {
  if (!size) {
    return null;
  }

  const normalized = size.trim().replace(/\s+/g, '').replace(/_0$/i, '/0');
  const compact = normalized.replace(/\/0$/i, '').replace(/^0+/, '') || '0';

  return isPreciosaRocaillesSize(compact) ? compact : null;
}

export function getPreciosaRocaillesSizeDisplayName(size: string): `${number}/0` {
  const normalized = normalizePreciosaRocaillesSize(size);

  if (!normalized) {
    throw new Error(`Unsupported Preciosa Rocailles size: ${size}`);
  }

  return PRECIOSA_ROCAILLES_SIZE_LABELS[normalized];
}

export function getPreciosaRocaillesDimensions(size: string): PreciosaRocaillesDimensions {
  return preciosaRocaillesDimensionTable[getPreciosaRocaillesSizeDisplayName(size)];
}

export function assertPreciosaRocaillesDimensionsForSizes(sizes: string[]): void {
  const missing = sizes.filter((size) => !preciosaRocaillesDimensionTable[getPreciosaRocaillesSizeDisplayName(size)]);

  if (missing.length > 0) {
    throw new Error(`Missing Preciosa Rocailles dimensions for sizes: ${missing.join(', ')}`);
  }
}