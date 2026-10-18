import { describe, expect, it } from 'vitest';
import { cropFileName, cropRelativePath, swatchPixelRect } from '../../../../../scripts/beads/miyuki/catalogue/lib/crops.js';
import { row } from '../fixtures.js';

describe('crop naming', () => {
  it('names round-rocaille crops by number, marking square holes', () => {
    expect(cropFileName(row())).toBe('131.png');
    expect(cropFileName(row({ colourNo: '1', hole: 'SH' }))).toBe('1-SH.png');
    expect(cropRelativePath(row({ colourNo: 'HB167' }))).toBe('round-rocailles/11/HB167.png');
    expect(cropRelativePath(row({ colourNo: '414', size: '1/0' }))).toBe('round-rocailles/1/414.png');
  });

  it('names Delica crops by prefix and number', () => {
    expect(cropRelativePath(row({ shape: 'delica', prefix: 'DBS', colourNo: '134', size: '15/0' }))).toBe('delica/15/DBS134.png');
  });
});

describe('swatchPixelRect', () => {
  it('scales the swatch to the render resolution, inset by a point, and clamps to the image', () => {
    expect(swatchPixelRect({ x: 93.69, y: 187.226, w: 51.02, h: 21.544 }, 300, { width: 2480, height: 3508 })).toEqual({
      left: 395,
      top: 784,
      width: 204,
      height: 82,
    });
    expect(swatchPixelRect({ x: -2, y: -2, w: 10, h: 10 }, 72, { width: 5, height: 5 })).toEqual({ left: 0, top: 0, width: 5, height: 5 });
    expect(swatchPixelRect({ x: 0, y: 0, w: 1, h: 1 }, 72, { width: 100, height: 100 })).toEqual({ left: 1, top: 1, width: 1, height: 1 });
  });
});
