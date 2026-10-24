import { describe, expect, it } from 'vitest';
import { retailerImage, retailerRowProblem } from '../../../../scripts/beads/miyuki/common/retailer-evidence.js';
import { RETAILER_ROW } from './retailer-fixtures.js';

describe('the retailer evidence rule', () => {
  const row = RETAILER_ROW;

  it('takes a row only with three shops, three independent photos and an image that is never a shop photo', () => {
    expect(retailerRowProblem(row)).toBeNull();
    expect(retailerRowProblem({ ...row, shops: '2' })).toBe('only 2 shops');
    expect(retailerRowProblem({ ...row, independent_photos: '1' })).toBe('only 1 independent photos');
    expect(retailerRowProblem({ ...row, colour: '' })).toBe('rendered without a colour');
    expect(retailerRowProblem({ ...row, image: 'miyuki-15-band', colour: '' })).toBeNull();
    expect(retailerRowProblem({ ...row, image: 'shop-photo' })).toBe('unknown image "shop-photo"');
  });

  it('refuses a count that is blank or not a whole number, which a numeric comparison would let through', () => {
    expect(retailerRowProblem({ ...row, shops: '' })).toBe('shops "" is not a count');
    expect(retailerRowProblem({ ...row, shops: 'many' })).toBe('shops "many" is not a count');
    expect(retailerRowProblem({ ...row, independent_photos: '3.5' })).toBe('independent_photos "3.5" is not a count');
  });

  it('checks the colour number against the round-rocaille grammar and the size against the sizes Miyuki makes', () => {
    expect(retailerRowProblem({ ...row, colour_no: '2046X' })).toBe('colour number "2046X" is not a round-rocaille number');
    expect(retailerRowProblem({ ...row, colour_no: '02046' })).toBe('colour number "02046" is not a round-rocaille number');
    expect(retailerRowProblem({ ...row, size: '10' })).toBe('size "10" is not a round-rocaille size');
  });

  it('needs every attribute column, the listings and the evidence the registry row cites', () => {
    expect(retailerRowProblem({ ...row, finish: ' ' })).toBe('no finish');
    expect(retailerRowProblem({ ...row, listings: '' })).toBe('no listings');
    expect(retailerRowProblem({ ...row, metadata_evidence: '' })).toBe('no metadata_evidence');
  });

  it("borrows Miyuki's photo only from another size Miyuki makes", () => {
    expect(retailerRowProblem({ ...row, image: 'miyuki-11' })).toMatch(/is the size being added/);
    expect(retailerRowProblem({ ...row, image: 'miyuki-10' })).toMatch(/not a round-rocaille size/);
  });

  it('reads the image source of a row', () => {
    expect(retailerImage(row)).toEqual({ kind: 'rendered', colour: '#864f61' });
    expect(retailerImage({ ...row, image: 'miyuki-15-band' })).toEqual({ kind: 'miyuki', size: '15', band: true });
    expect(retailerImage({ ...row, image: 'miyuki-8' })).toEqual({ kind: 'miyuki', size: '8', band: false });
    expect(retailerImage({ ...row, image: 'shop-photo' })).toBeNull();
  });
});
