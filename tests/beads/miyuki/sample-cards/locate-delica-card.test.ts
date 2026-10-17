import { describe, expect, it } from 'vitest';
import {
  beadloo,
  clusterEdges,
  gridFromCells,
  normaliseLabel,
  officialRenumberedDelica,
  placeTargets,
  rectsAt,
} from '../../../../scripts/beads/miyuki/sample-cards/locate-delica-card.js';

// A card page in miniature: two label/bead column pairs, rows 100 px apart from y = 1000.
const columns = [100, 385, 740, 1025, 1380];
const cell = (column: number, row: number, text = '') => ({ x: columns[column], y: 1000 + row * 100, w: columns[column + 1] - columns[column], h: 100, text, conf: 90 });
const page = (texts: Record<string, [number, number]>) => {
  const cells = [];
  for (let row = 0; row < 6; row++) for (let column = 0; column < 4; column++) cells.push(cell(column, row));
  for (const [text, [column, row]] of Object.entries(texts)) cells.push(cell(column, row, text));
  return cells;
};

describe('locate-delica-card: grid', () => {
  it('clusters edges that sit within the tolerance, ignoring stray single detections', () => {
    expect(clusterEdges([100, 102, 98, 400, 401, 399, 900], 10)).toEqual([100, 400]);
  });

  it('reads the column edges and row tops of a page from its cells', () => {
    const grid = gridFromCells(page({}));
    expect(grid.columns).toEqual([100, 385, 740, 1025]);
    expect(grid.rows).toEqual([1000, 1100, 1200, 1300, 1400, 1500]);
    expect(grid.rowHeight).toBe(100);
  });

  it('gives the label cell and the strand cell beside it', () => {
    const grid = gridFromCells(page({}));
    expect(rectsAt(grid, 2, 3)).toEqual({ label: { x: 740, y: 1300, w: 285, h: 100 }, bead: { x: 1025, y: 1300, w: 356, h: 100 } });
  });
});

describe('locate-delica-card: labels', () => {
  it("normalises what Tesseract reads into the list's number", () => {
    expect(normaliseLabel('DB-106-1')).toBe('DB106-1');
    expect(normaliseLabel('D8-1O6-l')).toBe('DB106-1');
    expect(normaliseLabel('pB-51')).toBe('PB-51');
  });

  it("writes Beadloo's four-digit id", () => {
    expect(beadloo('DB106-1')).toBe('DB0106-1');
    expect(beadloo('DB1538-1')).toBe('DB1538-1');
  });

  it('takes the -1 colours from the official list', () => {
    expect(officialRenumberedDelica('DB#\tSeed#\nDB1\t451\nDB106-1\t366-1\nDB206-1\tN/A\n')).toEqual(['DB106-1', 'DB206-1']);
  });

  it('places exact readings, places misread labels from a neighbour, and reports the rest', () => {
    const cells = page({ 'DB-106-1': [0, 1], 'DB-2O6-1': [2, 1], 'DB-207-?': [2, 2] });
    const { placed, missing } = placeTargets([{ page: 1, cells }], ['DB106-1', 'DB206-1', 'DB207-1', 'DB999-1'], { 'DB207-1': { anchor: 'DB206-1', rows: 1 } });
    expect(placed.map((p) => [p.id, p.column, p.row, p.method])).toEqual([
      ['DB106-1', 0, 1, 'ocr-exact'],
      ['DB206-1', 2, 1, 'ocr-exact'],
      ['DB207-1', 2, 2, 'neighbour: 1 below DB206-1'],
    ]);
    expect(missing).toEqual(['DB999-1']);
  });
});

describe('locate-delica-card: re-runs', () => {
  it("keeps a human's status while the cells stay put, and asks again when a cell moved", async () => {
    const { statusAfterRelocating } = await import('../../../../scripts/beads/miyuki/sample-cards/locate-delica-card.js');
    const previous = { beadId: 'DB0106-1', label_cell_px150: '1575,1561,284,105', bead_cell_px150: '1859,1561,355,105', status: 'confirmed by eye 2026-10-17' };
    expect(statusAfterRelocating(previous, '1575,1561,284,105', '1859,1561,355,105')).toBe('confirmed by eye 2026-10-17');
    expect(statusAfterRelocating(previous, '1575,1666,284,105', '1859,1666,355,105')).toBe('located');
    expect(statusAfterRelocating(undefined, '1,2,3,4', '5,6,7,8')).toBe('located');
  });
});
