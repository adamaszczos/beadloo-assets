import { describe, expect, it } from 'vitest';
import { isApprovedRow, registryRowFor, squareHoleSidecar } from '../../../../scripts/beads/miyuki/round_rocailles/add-square-hole.js';

describe('square-hole adder (batch c)', () => {
  it('takes only the approved, unshipped square-hole rows', () => {
    const row = { official_id: '10SH', size: '8', on_disk: 'no', proposal: 'add with colorAccuracy approximate: image and metadata from the round-hole bead 10 at 8/0' };
    expect(isApprovedRow(row)).toBe(true);
    expect(isApprovedRow({ ...row, on_disk: 'yes' })).toBe(false);
    expect(isApprovedRow({ ...row, proposal: 'hold: no official image' })).toBe(false);
    expect(isApprovedRow({ ...row, official_id: '10' })).toBe(false);
  });

  it("builds the sidecar from the round-hole sibling's, with the hole and the approximate accuracy", () => {
    const sibling = { shape: 'Round Rocailles', size: '8/0', colorGroup: 'Red', glassGroup: 'Transparent', finish: 'Silverline', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', formerly: '701', colorAccuracy: 'photo' };
    expect(squareHoleSidecar(sibling)).toEqual({
      shape: 'Round Rocailles', size: '8/0', colorGroup: 'Red', glassGroup: 'Transparent', finish: 'Silverline', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', hole: 'Square Hole', colorAccuracy: 'approximate',
    });
  });

  it('writes a registry row that names the table, the old numbers and the sibling', () => {
    const row = { official_id: '10SH', size: '8', old_numbers: '713', proposal: 'add with colorAccuracy approximate' };
    expect(registryRowFor(row, '10', '2026-10-17')).toEqual({
      beadId: '10SH', size: '8', listingSource: 'color-change-tsv', imageSource: 'round-hole-sibling', sizeSource: 'color-change-tsv', colorAccuracy: 'approximate',
      sourceRef: 'color_change.tsv "Square Hole Round 8/0" (old numbers 713); image and attributes: the round-hole bead 10 at 8/0 (approximate: no official image of the square-hole colour, decision of 2026-10-17)',
      addedOn: '2026-10-17',
    });
  });
});
