/**
 * The mupdf side of the parser: reads a page's drawn segments, fills, images
 * and text lines into the library-agnostic `PageGraphics`, and renders a page
 * for cropping. mupdf is an ES module with top-level await, so it is loaded
 * with a dynamic import (the repo's scripts run as CommonJS under tsx).
 */

import * as fs from 'fs';
import type * as Mupdf from 'mupdf';
import type { Box, FillRect, PageGraphics, Segment, TextLine } from './types.js';

type MupdfModule = typeof Mupdf;

/** Filled rectangles up to this thick are grid lines drawn as fills rather than strokes. */
const MAX_LINE_THICKNESS = 1.5;
/** Fills lighter than this are backgrounds, never borders. */
const MAX_LINE_LUMINANCE = 0.9;

let mupdfModule: Promise<MupdfModule> | null = null;

export function loadMupdf(): Promise<MupdfModule> {
  mupdfModule ??= import('mupdf');
  return mupdfModule;
}

export interface RawImage {
  width: number;
  height: number;
  channels: 3;
  data: Buffer;
}

interface StructuredTextJson {
  blocks: Array<{ lines?: Array<{ text: string; bbox: { x: number; y: number; w: number; h: number }; font?: { size?: number } }> }>;
}

function applyMatrix(matrix: Mupdf.Matrix, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

function unitSquareBox(matrix: Mupdf.Matrix): Box {
  const corners = [applyMatrix(matrix, 0, 0), applyMatrix(matrix, 1, 0), applyMatrix(matrix, 0, 1), applyMatrix(matrix, 1, 1)];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Straight edges of the path in page coordinates; curves are left out. */
function straightEdges(path: Mupdf.Path, ctm: Mupdf.Matrix): Array<[[number, number], [number, number]]> {
  const edges: Array<[[number, number], [number, number]]> = [];
  let start: [number, number] | null = null;
  let current: [number, number] | null = null;
  path.walk({
    moveTo(x, y) {
      start = current = applyMatrix(ctm, x, y);
    },
    lineTo(x, y) {
      const next = applyMatrix(ctm, x, y);
      if (current) edges.push([current, next]);
      current = next;
    },
    curveTo(_x1, _y1, _x2, _y2, x3, y3) {
      current = applyMatrix(ctm, x3, y3);
    },
    closePath() {
      if (current && start) edges.push([current, start]);
      current = start;
    },
  });
  return edges;
}

function axisAlignedSegment([[x1, y1], [x2, y2]]: [[number, number], [number, number]]): Segment | null {
  const dx = Math.abs(x1 - x2);
  const dy = Math.abs(y1 - y2);
  if (dy < 0.3 && dx >= 0.3) return { axis: 'h', at: (y1 + y2) / 2, from: Math.min(x1, x2), to: Math.max(x1, x2) };
  if (dx < 0.3 && dy >= 0.3) return { axis: 'v', at: (x1 + x2) / 2, from: Math.min(y1, y2), to: Math.max(y1, y2) };
  return null;
}

function pathBox(path: Mupdf.Path, ctm: Mupdf.Matrix): Box | null {
  const points = straightEdges(path, ctm).flat();
  if (points.length === 0) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function colourToRgb(componentCount: number, color: number[]): [number, number, number] {
  if (componentCount === 4) {
    const [c, m, y, k] = color;
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  if (componentCount === 3) return [color[0], color[1], color[2]];
  if (componentCount === 1) return [color[0], color[0], color[0]];
  return [0.5, 0.5, 0.5];
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A thin dark filled rectangle is a border drawn as a fill; report it as the segment it stands for. */
function fillAsSegment(box: Box, rgb: [number, number, number]): Segment | null {
  if (luminance(rgb) > MAX_LINE_LUMINANCE) return null;
  if (box.h <= MAX_LINE_THICKNESS && box.w > MAX_LINE_THICKNESS) return { axis: 'h', at: box.y + box.h / 2, from: box.x, to: box.x + box.w };
  if (box.w <= MAX_LINE_THICKNESS && box.h > MAX_LINE_THICKNESS) return { axis: 'v', at: box.x + box.w / 2, from: box.y, to: box.y + box.h };
  return null;
}

function readTextLines(page: Mupdf.Page): TextLine[] {
  const structured = page.toStructuredText('preserve-whitespace');
  try {
    const json = JSON.parse(structured.asJSON()) as StructuredTextJson;
    const lines: TextLine[] = [];
    for (const block of json.blocks) {
      for (const line of block.lines ?? []) {
        lines.push({ text: line.text, x: line.bbox.x, y: line.bbox.y, w: line.bbox.w, h: line.bbox.h, fontSize: line.font?.size ?? 0 });
      }
    }
    return lines;
  } finally {
    structured.destroy();
  }
}

export class CataloguePdf {
  private constructor(
    private readonly mupdf: MupdfModule,
    private readonly document: Mupdf.Document
  ) {}

  static async open(pdfPath: string): Promise<CataloguePdf> {
    const mupdf = await loadMupdf();
    const document = mupdf.Document.openDocument(fs.readFileSync(pdfPath), 'application/pdf');
    return new CataloguePdf(mupdf, document);
  }

  pageCount(): number {
    return this.document.countPages();
  }

  /** Geometry and text of one page; `pageNumber` is 1-based like the PDF viewer. */
  readPageGraphics(pageNumber: number): PageGraphics {
    const page = this.document.loadPage(pageNumber - 1);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      const segments: Segment[] = [];
      const fills: FillRect[] = [];
      const images: Box[] = [];
      const device = new this.mupdf.Device({
        fillPath: (path, _evenOdd, ctm, colorspace, color) => {
          const box = pathBox(path, ctm);
          if (!box) return;
          const rgb = colourToRgb(colorspace.getNumberOfComponents(), color);
          const line = fillAsSegment(box, rgb);
          if (line) segments.push(line);
          else fills.push({ ...box, rgb });
        },
        strokePath: (path, _stroke, ctm) => {
          for (const edge of straightEdges(path, ctm)) {
            const segment = axisAlignedSegment(edge);
            if (segment) segments.push(segment);
          }
        },
        fillImage: (_image, ctm) => {
          images.push(unitSquareBox(ctm));
        },
      });
      page.run(device, this.mupdf.Matrix.identity);
      device.close();
      return { page: pageNumber, width: x1 - x0, height: y1 - y0, segments, fills, images, texts: readTextLines(page) };
    } finally {
      page.destroy();
    }
  }

  /** The page rendered as packed 8-bit RGB at the given resolution. */
  renderPage(pageNumber: number, dpi: number): RawImage {
    const page = this.document.loadPage(pageNumber - 1);
    const scale = dpi / 72;
    const pixmap = page.toPixmap(this.mupdf.Matrix.scale(scale, scale), this.mupdf.ColorSpace.DeviceRGB, false, false);
    try {
      const width = pixmap.getWidth();
      const height = pixmap.getHeight();
      const channels = pixmap.getNumberOfComponents();
      const stride = pixmap.getStride();
      if (channels !== 3) throw new Error(`expected an RGB render, got ${channels} channels`);
      const pixels = pixmap.getPixels();
      const data = Buffer.alloc(width * height * 3);
      for (let row = 0; row < height; row++) {
        data.set(pixels.subarray(row * stride, row * stride + width * 3), row * width * 3);
      }
      return { width, height, channels: 3, data };
    } finally {
      pixmap.destroy();
      page.destroy();
    }
  }

  destroy(): void {
    this.document.destroy();
  }
}
