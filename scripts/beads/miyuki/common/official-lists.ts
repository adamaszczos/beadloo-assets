/**
 * Parsers for Miyuki's official data files committed under `sources/miyuki/official/`.
 *
 * - `durability.tsv`: the official Delica colour list (`DB#`, the round-rocaille `Seed#` of the same
 *   colour, Miyuki's `old#`, a discontinued flag, glass type / finish, durability grades).
 * - `color_change.tsv`: old (tentative) colour numbers to unified numbers. The shape and size of a
 *   section sit in the `new_flag2` column on the section's first row only; later rows inherit it.
 *
 * Both files are read from their UTF-8 copies. Pure functions; callers pass the text.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT } from '../../common/lib/paths.js';

export const OFFICIAL_DIR = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'official');
export const DURABILITY_TSV_PATH = path.join(OFFICIAL_DIR, 'durability.tsv');
export const COLOR_CHANGE_TSV_PATH = path.join(OFFICIAL_DIR, 'color_change.tsv');

// ============================================================================
// durability.tsv
// ============================================================================

export type DelicaOfficialRow = {
  /** As printed: `DB1`, `DB106-1`. */
  dbNumber: string;
  /** Beadloo's canonical ID: `DB0001`, `DB0106-1`. */
  beadId: string;
  /** True for the `-1` colours: a product of its own beside the plain number (beadloo-assets PR #2). */
  renumbered: boolean;
  /** The round-rocaille colour number of the same colour, e.g. `451`, `2479-1`; empty when none. */
  seedNumber: string;
  oldNumber: string;
  discontinued: boolean;
  glassTypeFinishJa: string;
  glassTypeFinish: string;
  durability: { colorChange: string; peeling: string; fading: string };
};

const DB_NUMBER = /^(DB)(\d+)([A-Z]*)(-1)?$/i;

/** `DB106-1` → `DB0106-1`; `DB31L` → `DB0031L`. */
export function canonicalDelicaId(dbNumber: string): string | null {
  const match = dbNumber.trim().match(DB_NUMBER);
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2].padStart(4, '0')}${match[3].toUpperCase()}${match[4] ?? ''}`;
}

export function parseDurabilityTsv(text: string): DelicaOfficialRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = lines[0].split('\t');
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`durability.tsv: column "${name}" not found in header ${header.join(' | ')}`);
    return index;
  };
  const cDb = column('DB#');
  const cSeed = column('Seed#');
  const cOld = column('old#');
  const cDisc = column('Discontinued');
  const cJa = column('ガラス種類／加工名');
  const cEn = column('Glass Type / Finish');
  const cA = column('A：変色');
  const cB = column('B：色剥げ');
  const cC = column('C：色落ち');

  const rows: DelicaOfficialRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const dbNumber = (cells[cDb] ?? '').trim();
    const beadId = canonicalDelicaId(dbNumber);
    if (!beadId) throw new Error(`durability.tsv: unexpected DB number "${dbNumber}"`);
    rows.push({
      dbNumber,
      beadId,
      renumbered: beadId.endsWith('-1'),
      seedNumber: (cells[cSeed] ?? '').trim(),
      oldNumber: (cells[cOld] ?? '').trim(),
      discontinued: (cells[cDisc] ?? '').trim() !== '',
      glassTypeFinishJa: (cells[cJa] ?? '').trim(),
      glassTypeFinish: (cells[cEn] ?? '').trim(),
      durability: { colorChange: (cells[cA] ?? '').trim(), peeling: (cells[cB] ?? '').trim(), fading: (cells[cC] ?? '').trim() },
    });
  }
  return rows;
}

export function readDurabilityTsv(filePath = DURABILITY_TSV_PATH): DelicaOfficialRow[] {
  return parseDurabilityTsv(fs.readFileSync(filePath, 'utf-8'));
}

// ============================================================================
// color_change.tsv
// ============================================================================

export type ColorChangeRow = {
  oldNumber: string;
  /** The unified number as printed in the file, e.g. `1001`, `3 S.H.`, `2422(3 in RR 5/0)`. */
  unifiedRaw: string;
  /** The unified number alone, e.g. `1001`, `3`, `2422`. */
  unified: string;
  /** True when the unified number carries `S.H.`, or the whole section is a `Square Hole Round <size>/0` one. */
  squareHole: boolean;
  /** Section label as printed in `new_flag2`, forward-filled: `Round 8/0`, `Square Hole Round 11/0`, `2Cut 11/0`, `Bugle 6mm`, or empty before the first label. */
  section: string;
  /** `Round` for the sections that are round rocailles (square hole included); other shapes keep their printed name. */
  shape: string;
  /** Compact size for `Round <size>/0` and `Square Hole Round <size>/0` sections (`8`), otherwise empty. */
  size: string;
};

export function parseColorChangeTsv(text: string): ColorChangeRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = lines[0].split('\t');
  const cOld = header.indexOf('Old(Tentative)');
  const cUnified = header.indexOf('Unified');
  const cSection = header.indexOf('new_flag2');
  if (cOld < 0 || cUnified < 0 || cSection < 0) {
    throw new Error(`color_change.tsv: unexpected header ${header.join(' | ')}`);
  }
  const rows: ColorChangeRow[] = [];
  let section = '';
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const oldNumber = (cells[cOld] ?? '').trim();
    if (!oldNumber) continue;
    const printedSection = (cells[cSection] ?? '').trim();
    if (printedSection) section = printedSection;
    const unifiedRaw = (cells[cUnified] ?? '').trim();
    const unifiedMatch = unifiedRaw.match(/^(\d+[A-Z]*)/i);
    const shapeMatch = section.match(/^(Square Hole\s+)?([A-Za-z0-9]+)\s+(\d+)\/0$/i);
    const sectionSquareHole = Boolean(shapeMatch?.[1]);
    rows.push({
      oldNumber: oldNumber.toUpperCase(),
      unifiedRaw,
      unified: unifiedMatch ? unifiedMatch[1].toUpperCase() : '',
      squareHole: sectionSquareHole || /S\.?H\.?/i.test(unifiedRaw.replace(/^\d+[A-Z]*/i, '')),
      section,
      shape: shapeMatch ? shapeMatch[2] : section.split(/\s+/)[0] ?? '',
      size: shapeMatch && /^round$/i.test(shapeMatch[2]) ? shapeMatch[3] : '',
    });
  }
  return rows;
}

export function readColorChangeTsv(filePath = COLOR_CHANGE_TSV_PATH): ColorChangeRow[] {
  return parseColorChangeTsv(fs.readFileSync(filePath, 'utf-8'));
}
