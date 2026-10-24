import { describe, expect, it } from 'vitest';
import { colouredRowBand, planRetailerBeads, retailerRegistryRow, retailerSidecar } from '../../../../scripts/beads/miyuki/round_rocailles/add-retailer-beads.js';
import { RETAILER_ROW as row } from '../common/retailer-fixtures.js';

describe('round rocailles only shops vouch for', () => {
  it('marks the bead "Retailer" and its colour approximate, and names every source in the registry', () => {
    expect(retailerSidecar(row)).toMatchObject({ size: '11/0', glassGroup: 'Opaque', colorAccuracy: 'approximate', confirmation: 'Retailer' });
    const registry = retailerRegistryRow(row, '2026-10-23');
    expect(registry).toMatchObject({ listingSource: 'retailer', imageSource: 'rendered', sizeSource: 'retailer', colorAccuracy: 'approximate' });
    expect(registry.sourceRef).toContain('by 15 shops with 6 independent photos');
    expect(registry.sourceRef).toContain('https://shop.example/a, https://shop.example/b');
    expect(retailerRegistryRow({ ...row, image: 'miyuki-15-band' }).imageSource).toBe('same-colour-other-size');
    expect(retailerRegistryRow({ ...row, image: 'miyuki-15-band' }).sourceRef).toContain('image: Miyuki photo of 2046 at 15/0 (median of 3 photos), cropped to the bead rows');
  });

  it("plans a row only when the bead is not yet in the library and a borrowed image is Miyuki's photo at another size", () => {
    const borrowed = { ...row, colour_no: '2049', image: 'miyuki-15-band', colour: '' };
    const library = { inLibrary: (beadId: string) => beadId === '2041', photoDonor: (beadId: string, donorSize: string) => beadId === '2049' && donorSize === '15' };
    const { planned, notTaken } = planRetailerBeads([row, { ...row, colour_no: '2041' }, borrowed, { ...borrowed, colour_no: '2050' }, { ...row, colour_no: '2047', shops: '' }], library);
    expect(planned.map((p) => [p.row.colour_no, p.image.kind])).toEqual([['2046', 'rendered'], ['2049', 'miyuki']]);
    expect(notTaken).toEqual(['2050@11: no Miyuki photo of 2050 at 15/0 in the library to borrow', '2047@11: shops "" is not a count']);
  });

  it("keeps the rows of a strand photo where the coloured beads are, not the grey shadow under them", () => {
    const width = 10, height = 8;
    const px = new Uint8Array(width * height * 3).fill(235);
    const paint = (y: number, rgb: number[]) => { for (let x = 0; x < width; x++) px.set(rgb, (y * width + x) * 3); };
    for (const y of [2, 3, 4]) paint(y, [90, 110, 40]); // olive beads
    for (const y of [5, 6]) paint(y, [150, 150, 150]); // achromatic shadow
    expect(colouredRowBand(px, width, height, 3)).toEqual({ top: 2, bottom: 5 });
    expect(colouredRowBand(new Uint8Array(width * height * 3).fill(120), width, height, 3)).toBeNull();
  });

  it('reads the pixels with the channel count the image has', () => {
    const width = 4, height = 3;
    const rgba = new Uint8Array(width * height * 4).fill(200);
    for (let x = 0; x < width; x++) rgba.set([200, 40, 40, 255], (1 * width + x) * 4);
    expect(colouredRowBand(rgba, width, height, 4)).toEqual({ top: 1, bottom: 2 });
    expect(colouredRowBand(new Uint8Array(width * height).fill(90), width, height, 1)).toBeNull();
  });
});
