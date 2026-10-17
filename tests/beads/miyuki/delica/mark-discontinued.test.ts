import { describe, expect, it } from 'vitest';
import { withDiscontinuedStatus } from '../../../../scripts/beads/miyuki/delica/mark-discontinued.js';

describe('withDiscontinuedStatus', () => {
  it('adds the status once, keeping the issue #203 fields in a stable order', () => {
    const first = withDiscontinuedStatus({ shape: 'Delica', plating: 'Non-Plating', colorAccuracy: 'photo', formerly: 'DB0001' });
    expect(first.changed).toBe(true);
    expect(Object.keys(first.sidecar)).toEqual(['shape', 'plating', 'status', 'colorAccuracy', 'formerly']);
    expect(withDiscontinuedStatus(first.sidecar).changed).toBe(false);
  });
});
