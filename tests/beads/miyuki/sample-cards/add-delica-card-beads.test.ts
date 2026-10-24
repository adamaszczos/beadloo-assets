import { describe, expect, it } from 'vitest';
import { buildDelicaCardSidecar, isConfirmedCell, officialGlassAndFinish, registryRowFor } from '../../../../scripts/beads/miyuki/sample-cards/add-delica-card-beads.js';

describe('Delica -1 colours from card N-2', () => {
  it("turns each official glass type and finish into the directory's vocabulary", () => {
    expect(officialGlassAndFinish('Transparent - Glass Enamel - Luster')).toEqual({ glassGroup: 'Transparent', finish: 'Glass enamel, Luster' });
    expect(officialGlassAndFinish('Opaque - Glass Enamel')).toEqual({ glassGroup: 'Opaque', finish: 'Glass enamel' });
    expect(officialGlassAndFinish('Opaque- Glass Enamel - Luster')).toEqual({ glassGroup: 'Opaque', finish: 'Glass enamel, Luster' });
    expect(officialGlassAndFinish('Opaque - Glass Enamel - AB')).toEqual({ glassGroup: 'Opaque', finish: 'Glass enamel, Rainbow' });
    expect(officialGlassAndFinish('Matte Opaque - Glass Enamel')).toEqual({ glassGroup: 'Opaque', finish: 'Frosted (Matte), Glass enamel' });
    expect(officialGlassAndFinish('Matte Transparent - Glass Enamel')).toEqual({ glassGroup: 'Transparent', finish: 'Frosted (Matte), Glass enamel' });
    expect(officialGlassAndFinish('Silk - Glass Enamel')).toEqual({ glassGroup: 'Silk', finish: 'Glass enamel' });
  });

  it('refuses a finish it does not know rather than guess', () => {
    expect(() => officialGlassAndFinish('Opaque - Picasso')).toThrow(/unknown term "picasso"/);
    expect(() => officialGlassAndFinish('Lined - Glass Enamel')).toThrow(/unknown term "lined"/);
  });

  it('builds a photo sidecar without a colour group, which Miyuki does not publish for these', () => {
    expect(buildDelicaCardSidecar({ glassTypeFinish: 'Matte Opaque - Glass Enamel' })).toEqual({
      shape: 'Delica',
      size: '11/0',
      glassGroup: 'Opaque',
      finish: 'Frosted (Matte), Glass enamel',
      dyed: 'Non Dyed',
      galvanized: 'Non-galvanized',
      plating: 'Non-Plating',
      colorAccuracy: 'photo',
    });
  });

  it('takes only cells a human confirmed', () => {
    const row = { status: 'confirmed by eye 2026-10-17', bead_cell_px150: '1859,1561,355,105' };
    expect(isConfirmedCell(row)).toBe(true);
    expect(isConfirmedCell({ ...row, status: 'located' })).toBe(false);
    expect(isConfirmedCell({ ...row, bead_cell_px150: '' })).toBe(false);
  });

  it('writes a registry row naming the list row, the card cell and the separate old bead', () => {
    const row = { beadId: 'DB0106-1', card: 'N-2', pdf: 'N-2.pdf', page: '1', bead_cell_px150: '1859,1561,355,105' };
    expect(registryRowFor(row, { dbNumber: 'DB106-1', glassTypeFinish: 'Transparent - Glass Enamel - Luster' }, '2026-10-17')).toEqual({
      beadId: 'DB0106-1',
      size: '11',
      listingSource: 'durability-tsv',
      imageSource: 'sample-card',
      sizeSource: 'durability-tsv',
      colorAccuracy: 'photo',
      sourceRef: 'durability.tsv DB106-1 "Transparent - Glass Enamel - Luster"; image: sample card N-2 (N-2.pdf) p.1 bead cell (1859,1561,355,105); the old number DB106 is a separate bead, which Miyuki\'s directory still sells',
      addedOn: '2026-10-17',
    });
  });
});
