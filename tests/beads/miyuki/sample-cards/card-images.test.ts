import { describe, expect, it } from 'vitest';
import { strandBox } from '../../../../scripts/beads/miyuki/sample-cards/card-images.js';

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

  it('keeps a long dark strand whole: only a near-full span is a grid line', () => {
    const w = 100, h = 12;
    const px = new Uint8Array(w * h * 3).fill(250);
    // a strand across 90% of the cell, rows 2-9: the old 80% rule took its rows for lines and cut it
    for (let y = 2; y < 10; y++) for (let x = 5; x < 95; x++) { const i = (y * w + x) * 3; px[i] = 60; px[i + 1] = 150; px[i + 2] = 50; }
    expect(strandBox(px, w, h, 0)).toEqual({ x: 5, y: 2, w: 90, h: 8 });
    // a full-width line under it is still left out
    for (let x = 0; x < w; x++) { const i = (11 * w + x) * 3; px[i] = 30; px[i + 1] = 30; px[i + 2] = 30; }
    expect(strandBox(px, w, h, 0)).toEqual({ x: 5, y: 2, w: 90, h: 8 });
  });
});
