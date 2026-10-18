import { describe, expect, it } from 'vitest';
import { buildCardSidecar, isReadyRow, parseBox, sizesForRow, strandBox } from '../../../../scripts/beads/miyuki/sample-cards/add-card-beads.js';

describe('sample-card adder', () => {
  it('reads the sizes a row goes in at: the card size, or all four for card 867/R', () => {
    expect(sizesForRow({ card: '866R', card_size: '6/0' })).toEqual(['6']);
    expect(sizesForRow({ card: '76/4R', card_size: '2/0 SH' })).toEqual(['2']);
    expect(sizesForRow({ card: '867/R', card_size: '6/0, 8/0, 11/0, 15/0 (per section)' })).toEqual(['15', '11', '8', '6']);
    expect(sizesForRow({ card: 'x', card_size: '' })).toEqual([]);
  });

  it('takes only confirmed rows with a located bead cell', () => {
    const base = { status: 'confirmed by eye on the card', bead_cell_px150: '10,20,300,40', page: '1' };
    expect(isReadyRow(base)).toBe(true);
    expect(isReadyRow({ ...base, bead_cell_px150: '' })).toBe(false);
    expect(isReadyRow({ ...base, status: 'EXCLUDED: triangle' })).toBe(false);
    expect(isReadyRow({ ...base, status: 'ocr-read; to confirm by eye' })).toBe(false);
    expect(parseBox('1,2,3')).toBeNull();
  });

  it('builds the sidecar as a photo, with the hole for SH and the colour group only from a donor', () => {
    const donor = { colorGroup: 'Red', glassGroup: 'Transparent', finish: 'Silverline', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating' };
    expect(buildCardSidecar('2', donor, { squareHole: true, keepColorGroup: true })).toEqual({
      shape: 'Round Rocailles', size: '2/0', colorGroup: 'Red', glassGroup: 'Transparent', finish: 'Silverline', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', hole: 'Square Hole', colorAccuracy: 'photo',
    });
    const fromSection = buildCardSidecar('11', { ...donor, finish: '' }, { squareHole: false, keepColorGroup: false });
    expect(fromSection.colorGroup).toBeUndefined();
    expect(fromSection.finish).toBe('Not Specified');
    expect(Object.keys(fromSection)).toEqual(['shape', 'size', 'glassGroup', 'finish', 'dyed', 'galvanized', 'plating', 'colorAccuracy']);
  });
});

describe('strandBox', () => {
  it('finds the beads inside a wide cell and keeps the whole cell when nothing dark is there', () => {
    const w = 60, h = 10;
    const px = new Uint8Array(w * h * 3).fill(250);
    for (let y = 3; y < 7; y++) for (let x = 5; x < 35; x++) { const i = (y * w + x) * 3; px[i] = 120; px[i + 1] = 40; px[i + 2] = 60; }
    // a cell border: a dark line down the whole height at x = 50 must not widen the box
    for (let y = 0; y < h; y++) { const i = (y * w + 50) * 3; px[i] = 30; px[i + 1] = 30; px[i + 2] = 30; }
    expect(strandBox(px, w, h, 2)).toEqual({ x: 3, y: 1, w: 34, h: 8 });
    expect(strandBox(new Uint8Array(w * h * 3).fill(250), w, h)).toEqual({ x: 0, y: 0, w, h });
  });
});
