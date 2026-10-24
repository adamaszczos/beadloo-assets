import { describe, expect, it } from 'vitest';
import { attributesFromOfficialFinish } from '../../../../scripts/beads/miyuki/common/official-finish.js';

describe("Miyuki's Delica-list phrases as round-rocaille attributes", () => {
  it('reads the glass, the finishes in sorted order and the dyed and galvanized fields', () => {
    expect(attributesFromOfficialFinish('Opaque - Glass Enamel - Luster')).toEqual({ glassGroup: 'Opaque', finish: 'Glass enamel, Luster', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating' });
    expect(attributesFromOfficialFinish('Matte Metallic - AB')).toMatchObject({ glassGroup: 'Opaque', finish: 'Frosted (Matte), Metallic, Rainbow' });
    expect(attributesFromOfficialFinish('Silk - Glass Enamel')).toMatchObject({ glassGroup: 'Silk', finish: 'Glass enamel' });
    expect(attributesFromOfficialFinish('Transparent')).toMatchObject({ glassGroup: 'Transparent', finish: 'Non-Extra Finish' });
  });

  it("supplies the glass a phrase implies and tolerates the list's typos", () => {
    expect(attributesFromOfficialFinish('Color Lined - AB')).toEqual({ glassGroup: 'Transparent', finish: 'Color-Lined, Rainbow', dyed: 'Color-Lined', galvanized: 'Non-galvanized', plating: 'Non-Plating' });
    expect(attributesFromOfficialFinish('Qpaque - AB')).toMatchObject({ glassGroup: 'Opaque', finish: 'Rainbow' });
  });

  it('fails loudly on a term it does not know rather than guess', () => {
    expect(() => attributesFromOfficialFinish('Opaque - Moonbeam')).toThrow(/unknown term/);
  });
});
