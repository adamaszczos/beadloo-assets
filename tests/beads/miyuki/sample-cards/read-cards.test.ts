import { describe, expect, it } from 'vitest';
import { beadCellFor, cellsFromLines, mergeRuns } from '../../../../scripts/beads/miyuki/sample-cards/read-cards.js';

describe('sample-card cell reader', () => {
  it('merges the rows of one thick border line into one', () => {
    expect(mergeRuns([{ pos: 10, start: 0, end: 500 }, { pos: 11, start: 0, end: 500 }, { pos: 12, start: 2, end: 498 }, { pos: 60, start: 0, end: 500 }])).toEqual([
      { pos: 12, start: 0, end: 500 },
      { pos: 60, start: 0, end: 500 },
    ]);
  });

  it('cuts cells between consecutive borders and pairs a number cell with the bead cell to its right', () => {
    const horizontals = [{ pos: 0, start: 0, end: 300 }, { pos: 40, start: 0, end: 300 }, { pos: 80, start: 0, end: 300 }];
    const verticals = [{ pos: 0, start: 0, end: 80 }, { pos: 100, start: 0, end: 80 }, { pos: 300, start: 0, end: 80 }];
    const cells = cellsFromLines(horizontals, verticals);
    expect(cells).toEqual([
      { x: 0, y: 0, w: 100, h: 40 },
      { x: 100, y: 0, w: 200, h: 40 },
      { x: 0, y: 40, w: 100, h: 40 },
      { x: 100, y: 40, w: 200, h: 40 },
    ]);
    expect(beadCellFor(cells[0], cells)).toEqual({ x: 100, y: 0, w: 200, h: 40 });
    expect(beadCellFor(cells[1], cells)).toBeNull();
  });
});
