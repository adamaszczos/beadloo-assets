import { describe, expect, it } from 'vitest';
import {
  PRECIOSA_ROCAILLES_SIZES,
  getPreciosaRocaillesDimensions,
  getPreciosaRocaillesSizeDisplayName,
  normalizePreciosaRocaillesSize,
} from '../../../../../scripts/beads/preciosa/rocailles/lib/config.js';

describe('normalizePreciosaRocaillesSize', () => {
  it('normalizes display labels and compact size strings', () => {
    expect(normalizePreciosaRocaillesSize('10/0')).toBe('10');
    expect(normalizePreciosaRocaillesSize('10')).toBe('10');
    expect(normalizePreciosaRocaillesSize('33/0')).toBe('33');
    expect(normalizePreciosaRocaillesSize('033')).toBe('33');
  });

  it('returns null for unsupported sizes', () => {
    expect(normalizePreciosaRocaillesSize('17/0')).toBeNull();
    expect(normalizePreciosaRocaillesSize('0')).toBeNull();
    expect(normalizePreciosaRocaillesSize(undefined)).toBeNull();
  });
});

describe('getPreciosaRocaillesSizeDisplayName', () => {
  it('returns the canonical size label', () => {
    expect(getPreciosaRocaillesSizeDisplayName('10')).toBe('10/0');
    expect(getPreciosaRocaillesSizeDisplayName('33')).toBe('33/0');
  });
});

describe('getPreciosaRocaillesDimensions', () => {
  it('loads dimensions from the checked-in rocailles table', () => {
    expect(getPreciosaRocaillesDimensions('10')).toEqual({
      diameter_min_mm: 2.2,
      diameter_max_mm: 2.4,
      diameter_mm: 2.3,
      beads_per_gram: 91,
    });
  });

  it('covers every supported size', () => {
    for (const size of PRECIOSA_ROCAILLES_SIZES) {
      const dimensions = getPreciosaRocaillesDimensions(size);
      expect(dimensions.diameter_mm).toBeGreaterThan(0);
      expect(dimensions.diameter_max_mm).toBeGreaterThan(dimensions.diameter_min_mm);
      expect(dimensions.beads_per_gram).toBeGreaterThan(0);
    }
  });
});