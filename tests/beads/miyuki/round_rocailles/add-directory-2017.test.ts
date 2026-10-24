import { describe, expect, it } from 'vitest';
import { baseNumber, directory2017RegistryRow, parse2017Photo, plan2017Beads } from '../../../../scripts/beads/miyuki/round_rocailles/add-directory-2017.js';

describe("Miyuki's 2017 directory photos", () => {
  it('reads the size and colour number of a photo, square-hole folders included', () => {
    expect(parse2017Photo('Size 11/11-406L.jpg')).toEqual({ size: '11', beadId: '406L' });
    expect(parse2017Photo('Size 6S/6S-1.jpg')).toEqual({ size: '6', beadId: '1SH' });
    expect(parse2017Photo('Size 15/15-131fr.JPG')).toEqual({ size: '15', beadId: '131FR' });
    expect(parse2017Photo('Thumbs.db')).toBeNull();
  });

  it("gives a light or dark shade its base number, and nothing else", () => {
    expect(baseNumber('406L')).toBe('406');
    expect(baseNumber('141D')).toBe('141');
    expect(baseNumber('131FR')).toBeNull();
    expect(baseNumber('406')).toBeNull();
  });

  it('plans a photo only when its bead is missing, its number current, a donor lends attributes and the file is the listed one', () => {
    const rows = ['Size 11/11-406L.jpg', 'Size 11/11-22.jpg', 'Size 11/11-1254.jpg', 'Size 15/15-9999.jpg', 'Size 8/8-406L.jpg', 'Size 6/6-131S.jpg', 'Size 3/3-22.jpg', 'Thumbs.db'].map((file) => ({ type: 'round_rocailles', file, sha256: `sha-${file}` }));
    const donor = { colorGroup: 'Red', glassGroup: 'Opaque', finish: 'Luster', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating' };
    const plan = plan2017Beads(rows, {
      inLibrary: (beadId) => beadId === '22',
      renumberedTo: (beadId) => (beadId === '1254' ? '2001' : null),
      sidecar: (size, beadId) => (beadId === '406' && size === '11' ? donor : null),
      photoProblem: (file) => (file.startsWith('Size 8/') ? 'no file' : null),
    });
    expect(plan.planned.map((p) => [p.beadId, p.size, p.source])).toEqual([['406L', '11', "attributes of 406 at 11/0 (406L is its light/dark shade in Miyuki's colour-number key)"]]);
    expect(plan.planned[0].sidecar).toEqual({ shape: 'Round Rocailles', size: '11/0', glassGroup: 'Opaque', finish: 'Luster', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', colorAccuracy: 'photo' });
    expect(plan.notRoundRocaille).toEqual(['Size 6/6-131S.jpg', 'Size 3/3-22.jpg']);
    expect(plan.aliases).toEqual(['1254@11 → 2001']);
    expect(plan.noMetadata).toEqual(['9999@15']);
    expect(plan.badPhotos).toEqual(['406L@8 (no file)']);
    expect(directory2017RegistryRow(plan.planned[0], '2026-10-24')).toMatchObject({ listingSource: 'directory-historical', colorAccuracy: 'photo', sourceRef: expect.stringContaining('"Size 11/11-406L.jpg"') });
  });
});
