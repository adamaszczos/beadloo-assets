import { describe, expect, it } from 'vitest';
import * as path from 'path';

import {
  getBeadTypeSegments,
  getBeadTypePublicPath,
  getBeadTypeDirectory,
  discoverBeadTypesOnDisk,
  BEADS_ROOT,
} from '../../../../scripts/beads/common/lib/paths.js';

describe('getBeadTypeSegments', () => {
  it('returns known segments for miyuki-delica', () => {
    expect(getBeadTypeSegments('miyuki-delica')).toEqual(['miyuki', 'delica']);
  });

  it('returns known segments for toho-round', () => {
    expect(getBeadTypeSegments('toho-round')).toEqual(['toho', 'round']);
  });

  it('falls back to splitting on dash for unknown types', () => {
    expect(getBeadTypeSegments('preciosa-charlotte')).toEqual(['preciosa', 'charlotte']);
  });

  it('handles single-segment types', () => {
    expect(getBeadTypeSegments('custom')).toEqual(['custom']);
  });

  it('filters empty segments from leading/trailing dashes', () => {
    expect(getBeadTypeSegments('-leading-')).toEqual(['leading']);
  });
});

describe('getBeadTypePublicPath', () => {
  it('joins known segments with /', () => {
    expect(getBeadTypePublicPath('miyuki-delica')).toBe('miyuki/delica');
  });

  it('joins unknown segments with /', () => {
    expect(getBeadTypePublicPath('a-b-c')).toBe('a/b/c');
  });
});

describe('getBeadTypeDirectory', () => {
  it('builds absolute path under BEADS_ROOT for known type', () => {
    const result = getBeadTypeDirectory('miyuki-delica');
    expect(result).toBe(path.join(BEADS_ROOT, 'miyuki', 'delica'));
  });

  it('appends extra segments', () => {
    const result = getBeadTypeDirectory('miyuki-delica', '11', 'DB0001.jpg');
    expect(result).toBe(path.join(BEADS_ROOT, 'miyuki', 'delica', '11', 'DB0001.jpg'));
  });

  it('works for unknown types', () => {
    const result = getBeadTypeDirectory('brand-shape', 'size');
    expect(result).toBe(path.join(BEADS_ROOT, 'brand', 'shape', 'size'));
  });
});

describe('discoverBeadTypesOnDisk', () => {
  it('discovers existing bead types from the real beads/ directory', () => {
    const result = discoverBeadTypesOnDisk();
    expect(result).toContain('miyuki-delica');
    expect(result).toContain('toho-round');
    // Results should be sorted
    expect(result).toEqual([...result].sort());
  });
});
