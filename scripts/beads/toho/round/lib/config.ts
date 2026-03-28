import * as fs from 'fs';
import * as path from 'path';
import { BEADS_ROOT } from '../../../common/lib/paths.js';

export interface BeadDimensions {
  height_mm: number;
  length_mm: number;
  hole_size_mm: number;
}

export const TOHO_ROUND_SIZES = ['3', '6', '8', '11', '15'] as const;
export type TohoRoundSize = (typeof TOHO_ROUND_SIZES)[number];

const TOHO_ROUND_SIZE_LABELS: Record<TohoRoundSize, `${number}/0`> = {
  '3': '3/0',
  '6': '6/0',
  '8': '8/0',
  '11': '11/0',
  '15': '15/0',
};

const TOHO_ROUND_SIZE_CODES: Record<TohoRoundSize, string> = {
  '3': '03',
  '6': '06',
  '8': '08',
  '11': '11',
  '15': '15',
};

type TohoRoundSizeLabel = (typeof TOHO_ROUND_SIZE_LABELS)[TohoRoundSize];
type TohoRoundDimensionEntry = BeadDimensions & { beads_per_gram: number };

const dimensionsPath = path.join(BEADS_ROOT, 'toho', 'round', 'toho-rounded.json');
export const tohoRoundDimensionTable = JSON.parse(
  fs.readFileSync(dimensionsPath, 'utf-8')
) as Record<TohoRoundSizeLabel, TohoRoundDimensionEntry>;

export function normalizeTohoRoundSize(size?: string | null): TohoRoundSize {
  if (!size) {
    return '11';
  }

  const normalized = size.trim().toLowerCase();
  const compact = normalized.replace('/0', '').replace(/^0+/, '') || '0';

  if (TOHO_ROUND_SIZES.includes(compact as TohoRoundSize)) {
    return compact as TohoRoundSize;
  }

  switch (normalized) {
    case '03':
      return '3';
    case '06':
      return '6';
    case '08':
      return '8';
    default:
      return '11';
  }
}

export function getTohoRoundSizeDisplayName(size: string): `${number}/0` {
  return TOHO_ROUND_SIZE_LABELS[normalizeTohoRoundSize(size)];
}

export function getTohoRoundSizeCode(size: string): string {
  return TOHO_ROUND_SIZE_CODES[normalizeTohoRoundSize(size)];
}
