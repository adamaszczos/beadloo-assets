import { describe, expect, it } from 'vitest';
import { isRoundRocailleId, isRoundRocailleSize, ROUND_ROCAILLE_SIZES } from '../../../../scripts/beads/miyuki/common/round-rocaille-ids.js';

describe('round-rocaille ids', () => {
  it("accepts Miyuki's numbers with their finish letters, HB colours, a square hole and the -1 renumbering", () => {
    for (const id of ['1', '22', '131SF', '2400SFR', '140FR', '11D', '406L', '457B', '1F', 'HB167', '3271SH', '2479-1', '3551L-1']) expect(isRoundRocailleId(id)).toBe(true);
  });

  it('refuses padding, other letters, slash forms and lower case', () => {
    for (const id of ['0022', '0', '2046X', '3300/L', '141D/FR', '12345', '22f', '', 'DB0001']) expect(isRoundRocailleId(id)).toBe(false);
  });

  it('knows the sizes the library keeps', () => {
    expect(ROUND_ROCAILLE_SIZES).toEqual(['1', '2', '5', '6', '8', '11', '15']);
    expect(isRoundRocailleSize('11')).toBe(true);
    expect(isRoundRocailleSize('11/0')).toBe(false);
    expect(isRoundRocailleSize('10')).toBe(false);
  });
});
