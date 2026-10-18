import { describe, expect, it } from 'vitest';
import { parseArgs, VALID_SIZES } from '../../../../scripts/beads/miyuki/round_rocailles/sync.js';
import { findNewListings, sidecarForListing } from '../../../../scripts/beads/miyuki/common/sync-pipeline.js';

describe('parseArgs (round rocailles)', () => {
  it('defaults to every size, square hole included', () => {
    expect(parseArgs([])).toEqual({ sizes: VALID_SIZES, dryRun: false, verbose: false, localOnly: false, force: false, includeSquareHole: true });
    expect(parseArgs(['--exclude-square-hole']).includeSquareHole).toBe(false);
    expect(parseArgs(['--include-square-hole']).includeSquareHole).toBe(true);
  });

  it('reads the flags and ignores unknown sizes', () => {
    expect(parseArgs(['--sizes', '11,15,99', '--dry-run', '--include-square-hole', '--dump', '/tmp/d.json'])).toEqual({
      sizes: ['11', '15'],
      dryRun: true,
      verbose: false,
      localOnly: false,
      force: false,
      includeSquareHole: true,
      dumpPath: '/tmp/d.json',
    });
  });
});

describe('sidecarForListing', () => {
  it('records the hole on a square-hole listing and leaves a round-hole one untouched', () => {
    const sidecar = { shape: 'Round Rocailles', size: '6/0', glassGroup: 'Transparent' };
    expect(sidecarForListing({ hole: 'SH' }, sidecar)).toEqual({ ...sidecar, hole: 'Square Hole' });
    expect(sidecarForListing({ hole: 'RH' }, sidecar)).toBe(sidecar);
  });
});

describe('findNewListings', () => {
  it('finds the listings not on disk; a -1 bead does not stand for the plain number the directory sells', () => {
    const listing = (beadId: string) => ({ beadId, size: '6' }) as Parameters<typeof findNewListings>[0][number];
    const fresh = findNewListings([listing('366'), listing('367'), listing('1SH')], '6', ['366-1', '1sh']);
    expect(fresh.map((l) => l.beadId)).toEqual(['366', '367']);
  });
});
