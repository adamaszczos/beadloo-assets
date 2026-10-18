import { describe, expect, it } from 'vitest';
import { startsNewRun } from '../../../../scripts/beads/miyuki/catalogue/lib/page.js';

const page26 = { family: { ja: 'Eビーズ', en: 'Round Rocaille Beads' }, size: '5/0' };

describe('startsNewRun (catalogue page headers)', () => {
  it('continues the previous table when a page only adds a further size (GB-6 p.26 → p.27)', () => {
    expect(startsNewRun(page26, { ja: 'Eビーズ・EE ビーズ', en: 'Round Rocaille Beads' }, '5/0')).toBe(false);
  });

  it('continues across pages of the same family and size', () => {
    expect(startsNewRun(page26, { ja: 'Eビーズ', en: 'Round Rocaille Beads' }, '5/0')).toBe(false);
  });

  it('starts a new run when the family changes, or its name and its first size both do', () => {
    expect(startsNewRun(page26, { ja: 'デリカビーズ', en: 'Delica Beads' }, '11/0')).toBe(true);
    expect(startsNewRun(page26, { ja: '丸小ビーズ', en: 'Round Rocaille Beads' }, '11/0')).toBe(true);
  });
});
