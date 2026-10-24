/**
 * Reviewed glass-and-finish decisions for round-rocaille colour numbers Miyuki's directory does not
 * list (issue #203): `sources/miyuki/round-rocaille-attributes.csv`, one row per colour number, read
 * by the sample-card adder for new beads and applied to the sidecars already on disk.
 *
 * A row records what a reviewer concluded from Miyuki's own data when no directory sibling exists:
 * the directory beads printed in the same run of the same card, the number's Delica-list seed twin
 * where the directory confirms how that phrase reads, Miyuki's notices. The evidence column says
 * which; a number the directory lists never takes a decision (the directory is the authority).
 */
import * as path from 'path';
import { ASSET_REPO_ROOT } from '../../common/lib/paths.js';
import { readCsvLines } from './csv.js';

export const ATTRIBUTE_DECISIONS_PATH = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'round-rocaille-attributes.csv');

export type DecidedAttributes = { glassGroup: string; finish: string; dyed: string; galvanized: string; plating: string };
export type AttributeDecision = DecidedAttributes & { colourNo: string; decidedOn: string; evidence: string };

const ATTRIBUTE_FIELDS: Array<keyof DecidedAttributes> = ['glassGroup', 'finish', 'dyed', 'galvanized', 'plating'];
const COLUMNS = ['colour_no', ...ATTRIBUTE_FIELDS, 'decided_on', 'evidence'];

/**
 * The directory's terms for the single-valued fields, as the library's sidecars carry them. A value
 * outside them is a typo or a shifted column (an unquoted `Outside-Dyed, Silverline` moves
 * `Silverline` into `dyed`), never a new term.
 */
const VOCABULARY: Partial<Record<keyof DecidedAttributes, readonly string[]>> = {
  glassGroup: ['Transparent', 'Opaque', 'Alabaster', 'Silk'],
  dyed: ['Non Dyed', 'Outside Dyed', 'Color-Lined', 'Duracoat Outside-Dyed'],
  galvanized: ['Non-galvanized', 'Galvanized', 'Duracoat Galvanized'],
  plating: ['Non-Plating', 'Copper', 'Gold', 'Nickel', 'Palladium', 'Silver'],
};

/** Why a decision is not one to apply, or null. */
function decisionProblem(decision: AttributeDecision): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(decision.decidedOn) || Number.isNaN(Date.parse(decision.decidedOn))) return `decided_on "${decision.decidedOn}" is not a YYYY-MM-DD date`;
  for (const field of ATTRIBUTE_FIELDS) {
    const allowed = VOCABULARY[field];
    if (allowed && !allowed.includes(decision[field])) return `${field} "${decision[field]}" is not one of ${allowed.join(', ')}`;
  }
  return null;
}

/**
 * The decisions keyed by colour number. Throws on a missing column, a row whose cell count differs
 * from the header's, an empty field, a value outside the vocabulary, or a number decided twice.
 */
export function parseAttributeDecisions(text: string): Map<string, AttributeDecision> {
  const fail = (message: string): never => {
    throw new Error(`round-rocaille-attributes.csv: ${message}`);
  };
  const [header = [], ...rows] = readCsvLines(text);
  const missingColumn = COLUMNS.find((column) => !header.includes(column));
  if (missingColumn) fail(`missing column ${missingColumn}`);
  const decisions = new Map<string, AttributeDecision>();
  rows.forEach((cells, index) => {
    const label = `row ${index + 2} (${cells[0] || 'no colour_no'})`;
    if (cells.length !== header.length) fail(`${label} has ${cells.length} cells, the header ${header.length} (an unquoted comma?)`);
    const row = Object.fromEntries(header.map((column, i) => [column, cells[i].trim()]));
    const colourNo = row.colour_no.toUpperCase();
    const empty = COLUMNS.find((column) => !row[column]);
    if (empty) fail(`${colourNo || label} has no ${empty}`);
    if (decisions.has(colourNo)) fail(`${colourNo} is decided twice`);
    const decision: AttributeDecision = {
      colourNo,
      glassGroup: row.glassGroup,
      finish: row.finish,
      dyed: row.dyed,
      galvanized: row.galvanized,
      plating: row.plating,
      decidedOn: row.decided_on,
      evidence: row.evidence,
    };
    const problem = decisionProblem(decision);
    if (problem) fail(`${colourNo}: ${problem}`);
    decisions.set(colourNo, decision);
  });
  return decisions;
}

/** A sidecar with the decided attributes in place of its own; every other field (size, hole, status, colour accuracy) kept. */
export function withDecidedAttributes(sidecar: Record<string, unknown>, decision: DecidedAttributes): { sidecar: Record<string, unknown>; changed: boolean } {
  const changed = ATTRIBUTE_FIELDS.some((field) => sidecar[field] !== decision[field]);
  if (!changed) return { sidecar, changed: false };
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sidecar)) next[key] = ATTRIBUTE_FIELDS.includes(key as keyof DecidedAttributes) ? decision[key as keyof DecidedAttributes] : value;
  for (const field of ATTRIBUTE_FIELDS) if (!(field in next)) next[field] = decision[field];
  return { sidecar: next, changed: true };
}

/** The registry note a decided bead carries, so its `sourceRef` names where its attributes now come from. */
export function decisionNote(decision: AttributeDecision): string {
  return `attributes: reviewed decision ${decision.decidedOn} (sources/miyuki/round-rocaille-attributes.csv)`;
}

/** `sourceRef` with the decision note appended once. */
export function withDecisionNote(sourceRef: string, decision: AttributeDecision): string {
  const note = decisionNote(decision);
  // A bead added from the decision already names it as its metadata source.
  if (sourceRef.includes(note) || sourceRef.includes(`metadata: reviewed decision ${decision.decidedOn}:`)) return sourceRef;
  const withoutOlder = sourceRef.replace(/; attributes: reviewed decision \d{4}-\d{2}-\d{2} \(sources\/miyuki\/round-rocaille-attributes\.csv\)/, '');
  return `${withoutOlder}; ${note}`;
}
