/**
 * Builders shared by the catalogue parser tests: synthetic lattices, text
 * lines and catalogue rows. Not a test file, so vitest never collects it.
 */

import type { CatalogueRow, Segment, TextLine } from '../../../../scripts/beads/miyuki/catalogue/lib/types.js';

function cumulative(start: number, sizes: number[]): number[] {
  const values = [start];
  for (const size of sizes) values.push(values[values.length - 1] + size);
  return values;
}

/** Full-length grid lines, the way a table is usually drawn. */
export function lattice(x: number, y: number, widths: number[], heights: number[]): Segment[] {
  const xs = cumulative(x, widths);
  const ys = cumulative(y, heights);
  return [
    ...ys.map((at): Segment => ({ axis: 'h', at, from: xs[0], to: xs[xs.length - 1] })),
    ...xs.map((at): Segment => ({ axis: 'v', at, from: ys[0], to: ys[ys.length - 1] })),
  ];
}

/** Four short edges per cell, the way GB-6 draws its tables. */
export function perCellEdges(x: number, y: number, widths: number[], heights: number[]): Segment[] {
  const xs = cumulative(x, widths);
  const ys = cumulative(y, heights);
  const segments: Segment[] = [];
  for (let row = 0; row + 1 < ys.length; row++) {
    for (let col = 0; col + 1 < xs.length; col++) {
      segments.push(
        { axis: 'h', at: ys[row], from: xs[col], to: xs[col + 1] },
        { axis: 'h', at: ys[row + 1], from: xs[col], to: xs[col + 1] },
        { axis: 'v', at: xs[col], from: ys[row], to: ys[row + 1] },
        { axis: 'v', at: xs[col + 1], from: ys[row], to: ys[row + 1] }
      );
    }
  }
  return segments;
}

export function line(text: string, x: number, y: number, w = 20, h = 8, fontSize = 9): TextLine {
  return { text, x, y, w, h, fontSize };
}

/** A label centred in each cell of one row. */
export function labelsFor(x: number, y: number, widths: number[], labels: string[]): TextLine[] {
  const xs = cumulative(x, widths);
  return labels.map((label, index) => line(label, xs[index] + 4, y + 2, 30, 6));
}

export function row(overrides: Partial<CatalogueRow> = {}): CatalogueRow {
  return {
    shape: 'round-rocailles',
    colourNo: '131',
    size: '11/0',
    hole: 'RH',
    prefix: '',
    sectionJa: 'スキ',
    sectionEn: 'Transparent',
    page: 14,
    cell: { x: 42.951, y: 187.226, w: 152.78, h: 21.544 },
    swatch: { x: 93.69, y: 187.226, w: 51.02, h: 21.544 },
    codeNo: 'H 4',
    ...overrides,
  };
}
