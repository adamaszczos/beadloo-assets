import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ASSET_REPO_ROOT } from '../../../scripts/beads/common/lib/paths.js';

type Decided = { diameterMm: number; holeMm: number; beadsPerGram: number; lengthMm: number };
type Sources = {
  roundRocailles: Record<string, { decided?: Decided }>;
  delica: Record<string, { diameterMm: number; holeMm: number; beadsPerGram: number; cut: { prefix: string; holeMm: number; beadsPerGram: number } }>;
};
type RrEntry = { diameter_mm: number; thickness_mm: number; hole_size_mm: number; beads_per_gram: number; weight_per_bead_g: number; unverified?: boolean; source?: string };
type DelicaEntry = { height_mm: number; length_mm: number; hole_size_mm: number; beads_per_gram: number; weight_per_bead_g: number; cut: { prefix: string; hole_size_mm: number; beads_per_gram: number; weight_per_bead_g: number }; source?: string };

const read = <T,>(rel: string): T => JSON.parse(fs.readFileSync(path.join(ASSET_REPO_ROOT, rel), 'utf-8')) as T;
const sources = read<Sources>('sources/miyuki/size-tables.json');
const rr = read<Record<string, RrEntry | string>>('beads/miyuki/round_rocailles/round_rocailles.json');
const delica = read<Record<string, DelicaEntry | string>>('beads/miyuki/delica/delica.json');
const entries = <T,>(table: Record<string, T | string>): Array<[string, T]> =>
  Object.entries(table).filter(([key]) => !key.startsWith('$')) as Array<[string, T]>;

describe('round_rocailles.json against the official size tables', () => {
  it('offers exactly the sizes the sources decide', () => {
    const decided = Object.entries(sources.roundRocailles).filter(([key, value]) => !key.startsWith('$') && value.decided).map(([key]) => key);
    expect(entries(rr).map(([key]) => key).sort()).toEqual(decided.sort());
  });

  it.each(entries(rr))('%s carries the decided figures and a source', (size, entry) => {
    const decided = sources.roundRocailles[size].decided!;
    expect(entry.diameter_mm).toBe(decided.diameterMm);
    expect(entry.hole_size_mm).toBe(decided.holeMm);
    expect(entry.beads_per_gram).toBe(decided.beadsPerGram);
    expect(entry.thickness_mm).toBe(decided.lengthMm);
    expect(entry.weight_per_bead_g).toBeCloseTo(1 / decided.beadsPerGram, 3);
    expect(entry.source).toMatch(/miyuki-beads\.co\.jp|catalogue GB-6/);
  });

  it('marks only 2/0 as unverified', () => {
    expect(entries(rr).filter(([, entry]) => entry.unverified).map(([key]) => key)).toEqual(['2/0']);
  });
});

describe('delica.json against the official size tables', () => {
  it.each(entries(delica))('%s matches the site for the regular and the Cut bead', (size, entry) => {
    const official = sources.delica[size];
    expect(entry.height_mm).toBe(official.diameterMm);
    expect(entry.hole_size_mm).toBe(official.holeMm);
    expect(entry.beads_per_gram).toBe(official.beadsPerGram);
    expect(entry.cut.prefix).toBe(official.cut.prefix);
    expect(entry.cut.hole_size_mm).toBe(official.cut.holeMm);
    expect(entry.cut.beads_per_gram).toBe(official.cut.beadsPerGram);
    expect(entry.cut.weight_per_bead_g).toBeCloseTo(1 / official.cut.beadsPerGram, 3);
    expect(entry.source).toContain('miyuki-beads.co.jp');
  });
});
