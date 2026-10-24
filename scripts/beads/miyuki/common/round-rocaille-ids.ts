/**
 * Round-rocaille IDs and sizes: the one grammar a Miyuki round-rocaille ID in the library follows (the
 * app's `src/lib/beads/miyuki/ids.ts` holds the same rule, `ROUND_ROCAILLE_STRICT`) and the sizes the
 * library is kept in. Pure; the adders validate what they read from a source against it.
 */

/** Compact sizes, as the folders under `beads/miyuki/round_rocailles/` are named. */
export const ROUND_ROCAILLE_SIZES = ['1', '2', '5', '6', '8', '11', '15'];

/**
 * The number as Miyuki prints it without the zero padding of its product codes (`HB` colours included),
 * one of Miyuki's finish letters (`F`, `D`, `L`, `B`, `SF`, `FR`, `SFR`), `SH` for a square hole and
 * `-1` for a lead-free renumbered colour: `22`, `131SF`, `HB167`, `3271SH`, `3551L-1`.
 */
const ROUND_ROCAILLE_ID = /^(HB)?[1-9]\d{0,3}(SFR|SF|FR|[BDFL])?(SH)?(-1)?$/;

export function isRoundRocailleId(id: string): boolean {
  return ROUND_ROCAILLE_ID.test(id);
}

export function isRoundRocailleSize(size: string): boolean {
  return ROUND_ROCAILLE_SIZES.includes(size);
}
