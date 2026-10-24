import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildCardBeadLookup,
  buildCardSidecar,
  buildOfficialPhraseLookup,
  chooseCardMetadata,
  countMetadataKinds,
  formatPlan,
  isOwnCardImage,
  isReadyRow,
  parseBox,
  parseCardArgs,
  parseSectionMappings,
  resolveCardBead,
  rowColorAccuracy,
  sizesForRow,
  type CardBeadLookup,
  type CardLookupSources,
  type Resolved,
} from '../../../../scripts/beads/miyuki/sample-cards/add-card-beads.js';
import { ASSET_REPO_ROOT } from '../../../../scripts/beads/common/lib/paths.js';
import { parseAttributeDecisions } from '../../../../scripts/beads/miyuki/common/attribute-decisions.js';
import { registryKey, type RegistryRow } from '../../../../scripts/beads/miyuki/common/registry.js';

const attributes = (finish: string, glassGroup = 'Opaque') => ({ glassGroup, finish, dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating' });

describe('sample-card adder', () => {
  it('reads the sizes a row goes in at: the card size, or all four for card 867/R', () => {
    expect(sizesForRow({ card: '866R', card_size: '6/0' })).toEqual(['6']);
    expect(sizesForRow({ card: '76/4R', card_size: '2/0 SH' })).toEqual(['2']);
    expect(sizesForRow({ card: '867/R', card_size: '6/0, 8/0, 11/0, 15/0 (per section)' })).toEqual(['15', '11', '8', '6']);
    expect(sizesForRow({ card: 'x', card_size: '' })).toEqual([]);
  });

  it('takes only confirmed rows with a located bead cell', () => {
    const base = { status: 'confirmed by eye on the card', bead_cell_px150: '10,20,300,40', page: '1' };
    expect(isReadyRow(base)).toBe(true);
    expect(isReadyRow({ ...base, bead_cell_px150: '' })).toBe(false);
    expect(isReadyRow({ ...base, status: 'EXCLUDED: triangle' })).toBe(false);
    expect(isReadyRow({ ...base, status: 'ocr-read; to confirm by eye' })).toBe(false);
    expect(parseBox('1,2,3')).toBeNull();
  });

  it("reads a row's colour accuracy: photo by default, approximate when the card warns its strand shows another size's colour", () => {
    expect(rowColorAccuracy({})).toBe('photo');
    expect(rowColorAccuracy({ color_accuracy: ' ' })).toBe('photo');
    expect(rowColorAccuracy({ color_accuracy: 'approximate' })).toBe('approximate');
    expect(() => rowColorAccuracy({ color_accuracy: 'close' })).toThrow(/unknown color_accuracy "close"/);
  });

  it('builds the sidecar as a photo, with the hole for SH and the colour group only from a donor', () => {
    const donor = { colorGroup: 'Red', glassGroup: 'Transparent', finish: 'Silverline', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating' };
    expect(buildCardSidecar('2', donor, { squareHole: true, keepColorGroup: true })).toEqual({
      shape: 'Round Rocailles', size: '2/0', colorGroup: 'Red', glassGroup: 'Transparent', finish: 'Silverline', dyed: 'Non Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', hole: 'Square Hole', colorAccuracy: 'photo',
    });
    const fromSection = buildCardSidecar('11', { ...donor, finish: '' }, { squareHole: false, keepColorGroup: false });
    expect(fromSection.colorGroup).toBeUndefined();
    expect(fromSection.finish).toBe('Not Specified');
    expect(Object.keys(fromSection)).toEqual(['shape', 'size', 'glassGroup', 'finish', 'dyed', 'galvanized', 'plating', 'colorAccuracy']);
  });
});

describe('card section mappings', () => {
  const mapped = { card_section: 'Fancy', catalogue_heading: 'Fancy Color', ...attributes('Luster'), evidence: '3 of 3 directory beads' };

  it('keeps a mapped heading and a blank one, and refuses a half-filled row', () => {
    const sections = parseSectionMappings([mapped, { card_section: 'Mixed', catalogue_heading: '', glassGroup: '', finish: '', dyed: '', galvanized: '', plating: '', evidence: '', note: 'spans several finishes' }]);
    expect(sections.get('Fancy')).toMatchObject({ catalogue_heading: 'Fancy Color', glassGroup: 'Opaque', finish: 'Luster' });
    expect(sections.get('Mixed')?.catalogue_heading).toBe('');
    expect(() => parseSectionMappings([{ ...mapped, dyed: '' }])).toThrow(/"Fancy" is mapped but lacks dyed/);
    expect(() => parseSectionMappings([{ ...mapped, catalogue_heading: '' }])).toThrow(/names attributes but no catalogue_heading/);
    expect(() => parseSectionMappings([mapped, mapped])).toThrow(/mapped twice/);
  });
});

describe('card metadata sources', () => {
  const section = { catalogue_heading: 'Fancy', ...attributes('Section'), evidence: 'section evidence' };
  const base: CardBeadLookup = { inLibrary: () => false, sections: new Map([['Fancy', section]]), renderExists: () => true, anyDonor: () => ({ sidecar: attributes('Donor'), source: 'donor' }) };
  const decision = () => ({ sidecar: attributes('Decided'), source: 'reviewed decision 2026-10-23: run evidence' });
  const officialPhrase = () => ({ attributes: attributes('Phrase'), source: 'phrase' });

  it('takes a reviewed decision before the Delica phrase, another size and the section, but after the directory', () => {
    expect(chooseCardMetadata('2063', '11', 'Fancy', { ...base, decision, officialPhrase })).toMatchObject({ source: 'reviewed decision 2026-10-23: run evidence', keepColorGroup: false, kind: 'decision' });
    const directoryDonor = () => ({ sidecar: attributes('Directory'), source: 'official attributes (directory)' });
    expect(chooseCardMetadata('2063', '11', 'Fancy', { ...base, decision, directoryDonor })).toMatchObject({ source: 'official attributes (directory)', keepColorGroup: true, kind: 'directory' });
    expect(chooseCardMetadata('2063', '11', 'Fancy', { ...base, anyDonor: () => null })).toMatchObject({ source: expect.stringContaining('section evidence'), kind: 'section' });
  });

  it("takes the Delica list's phrase before the same number at another size from a non-directory source", () => {
    expect(chooseCardMetadata('2063', '11', 'Fancy', { ...base, officialPhrase })).toMatchObject({ source: 'phrase', keepColorGroup: false, kind: 'delica-list', sidecar: { finish: 'Phrase' } });
    expect(chooseCardMetadata('2063', '11', 'Fancy', base)).toMatchObject({ source: 'donor', keepColorGroup: true, kind: 'other-size' });
  });

  it('skips a section whose mapping is blank, so a heading spanning several finishes never guesses', () => {
    const blank = { ...section, catalogue_heading: '' };
    expect(chooseCardMetadata('2063', '11', 'Fancy', { ...base, sections: new Map([['Fancy', blank]]), anyDonor: () => null })).toBeNull();
  });

  it('resolves a row to its sidecar, render and metadata kind, and skips a bead already in the library', () => {
    const row = { colour_no: '2063', card: '853/R', pdf: '853-R.pdf', page: '1', bead_cell_px150: '1,2,30,40', card_section: 'Fancy', card_states_size: '11/0' };
    const resolved = resolveCardBead(row, '11', { ...base, anyDonor: () => null });
    expect(resolved).toMatchObject({ beadId: '2063', size: '11', metadataKind: 'section', bead: { x: 1, y: 2, w: 30, h: 40 } });
    expect('render' in resolved && path.basename(resolved.render)).toBe('853-R-p1-150.png');
    expect(resolveCardBead(row, '11', { ...base, inLibrary: () => true })).toEqual({ beadId: '2063', size: '11', skip: 'already on disk' });
    expect(countMetadataKinds([{ metadataKind: 'section' }, { metadataKind: 'section' }, { metadataKind: 'directory' }])).toEqual({ directory: 1, decision: 0, 'delica-list': 0, 'other-size': 0, section: 2 });
  });
});

describe("the Delica list's seed twins", () => {
  const listRow = (dbNumber: string, seedNumber: string, glassTypeFinish: string) => ({ dbNumber, seedNumber, glassTypeFinish });
  const directory = (finish: string, glassGroup = 'Opaque') => ({ shape: 'Round Rocailles', ...attributes(finish, glassGroup) });

  it('trusts a reading the directory confirms on the twins it carries, and one no directory twin is read as', () => {
    const { lookup } = buildOfficialPhraseLookup([listRow('DB1', '401', 'Opaque - AB'), listRow('DB2', '402', 'Qpaque  - AB'), listRow('DB3', '403', 'Silk - Glass Enamel')], (seed) => (seed === '401' ? directory('Rainbow') : null));
    expect(lookup('402')).toEqual({ attributes: attributes('Rainbow'), source: 'Miyuki\'s Delica list: seed twin of DB2, "Qpaque - AB" (the reading matches the directory on 1 of 1 twins read the same way)' });
    expect(lookup('403')?.source).toContain('no directory twin is read this way to compare');
    expect(lookup('999')).toBeNull();
  });

  it('drops a reading the directory contradicts on any twin read the same way', () => {
    const rows = [listRow('DB1', '1201', 'Color Lined - AB'), listRow('DB2', '1202', 'Color Lined - AB'), listRow('DB3', '1203', 'Color Lined - AB')];
    const { lookup } = buildOfficialPhraseLookup(rows, (seed) => (seed === '1201' ? directory('Color-Lined, Rainbow', 'Transparent') : seed === '1202' ? directory('Rainbow', 'Transparent') : null));
    expect(lookup('1203')).toBeNull();
    expect(lookup('1201')).toBeNull();
  });

  it('counts the phrases with a term it does not know instead of dropping them silently, and skips N/A seeds', () => {
    const { lookup, unknownTerms } = buildOfficialPhraseLookup([listRow('DB1', '1', 'Duracoat - Galvanized - Dyed'), listRow('DB2', '2', 'Opaque - Duracoat - Dyed'), listRow('DB3', '3', 'Picasso Coating'), listRow('DB4', 'N/A', 'Moonbeam')], () => null);
    expect(Object.fromEntries(unknownTerms)).toEqual({ duracoat: 2, 'picasso coating': 1 });
    expect(lookup('1')).toBeNull();
  });
});

describe('building the card lookup', () => {
  const row = (beadId: string, size: string, listingSource: RegistryRow['listingSource']): RegistryRow => ({ beadId, size, listingSource, imageSource: listingSource, sizeSource: listingSource, colorAccuracy: 'photo', sourceRef: '', addedOn: '2026-10-23' });
  const sidecars = new Map<string, Record<string, string>>([
    ['3271:6', { ...attributes('Rococo Color, Silverline', 'Transparent'), colorGroup: 'Gold' }],
    ['1203:15', attributes('Luster')],
    ['22:11', attributes('Not Specified')],
    ['23:11', attributes('Not Specified')],
  ]);
  const registryRows = [row('3271', '6', 'directory'), row('1203', '15', 'catalogue-gb6'), row('22', '11', 'directory')];
  const sources = (overrides: Partial<CardLookupSources> = {}): CardLookupSources => ({
    registry: new Map(registryRows.map((r) => [registryKey(r.beadId, r.size), r])),
    sidecar: (beadId, size) => sidecars.get(`${beadId}:${size}`) ?? null,
    sections: new Map(),
    decisions: parseAttributeDecisions('colour_no,glassGroup,finish,dyed,galvanized,plating,decided_on,evidence\n2063,Opaque,Metallic,Non Dyed,Non-galvanized,Non-Plating,2026-10-23,card run\n'),
    delicaList: [],
    renderExists: () => true,
    rewriteImages: false,
    ...overrides,
  });

  it("lends a square-hole colour the round-hole bead's directory attributes when it has none of its own", () => {
    const { lookup } = buildCardBeadLookup(sources());
    expect(lookup.directoryDonor!('3271SH', '2')).toEqual({ sidecar: sidecars.get('3271:6'), source: 'official attributes of 3271 at 6/0 (directory)' });
    const resolved = resolveCardBead({ colour_no: '3271SH', card: '76/4R', pdf: '76-4R.pdf', page: '1', bead_cell_px150: '1,2,30,40', card_section: 'x', card_states_size: '2/0' }, '2', lookup);
    expect(resolved).toMatchObject({ metadataKind: 'directory', sidecar: { glassGroup: 'Transparent', colorGroup: 'Gold', hole: 'Square Hole' } });
  });

  it('names the source of another size, falls back to the round-hole bead from any source, and never counts the size being added', () => {
    const { lookup } = buildCardBeadLookup(sources());
    expect(lookup.directoryDonor!('1203', '11')).toBeNull();
    expect(lookup.anyDonor!('1203', '11')).toEqual({ sidecar: attributes('Luster'), source: 'attributes of 1203 at 15/0 (catalogue-gb6)' });
    expect(lookup.anyDonor!('1203SH', '15')?.source).toBe('attributes of 1203 at 15/0 (catalogue-gb6)');
    expect(lookup.anyDonor!('1203', '15')).toBeNull();
  });

  it('reads a reviewed decision with its evidence', () => {
    const { lookup } = buildCardBeadLookup(sources());
    expect(lookup.decision!('2063')).toMatchObject({ sidecar: { finish: 'Metallic' }, source: 'reviewed decision 2026-10-23: card run' });
    expect(lookup.decision!('2064')).toBeNull();
  });

  it('counts a bead as present only with both its sidecar and its registry row, and none at all when rewriting images', () => {
    const { lookup } = buildCardBeadLookup(sources());
    expect(lookup.inLibrary('22', '11')).toBe(true);
    expect(lookup.inLibrary('23', '11')).toBe(false); // a sidecar left without its registry row
    expect(lookup.inLibrary('1203', '11')).toBe(false);
    expect(buildCardBeadLookup(sources({ rewriteImages: true })).lookup.inLibrary('22', '11')).toBe(false);
  });

  it('weighs a Delica-list reading against the directory twins only', () => {
    const delicaList = [{ dbNumber: 'DB1', seedNumber: '3271', glassTypeFinish: 'Silver Lined' }, { dbNumber: 'DB2', seedNumber: '1203', glassTypeFinish: 'Opaque - Luster' }, { dbNumber: 'DB3', seedNumber: '1204', glassTypeFinish: 'Silver Lined' }];
    const { lookup } = buildCardBeadLookup(sources({ delicaList }));
    // 3271's directory sidecar reads "Rococo Color, Silverline", not the list's plain "Silverline"
    expect(lookup.officialPhrase!('1204')).toBeNull();
    // 1203's sidecar is the catalogue's, not the directory's, so it neither confirms nor contradicts
    expect(lookup.officialPhrase!('1203')?.source).toContain('no directory twin is read this way');
  });
});

describe('the command line', () => {
  it('reads --batch and --plan against the repo root, and makes --plan a dry run', () => {
    const args = parseCardArgs(['--batch', 'sources/miyuki/batches/e-mud-cover-15-0.csv', '--plan', 'tmp/plan.csv', '--only', '1603,3271sh']);
    expect(args).toMatchObject({ dryRun: true, rewriteImages: false, batchFile: path.join(ASSET_REPO_ROOT, 'sources/miyuki/batches/e-mud-cover-15-0.csv'), planFile: path.join(ASSET_REPO_ROOT, 'tmp/plan.csv') });
    expect(args.only).toEqual(new Set(['1603', '3271SH']));
    expect(parseCardArgs([])).toMatchObject({ dryRun: false, planFile: null, only: null, batchFile: path.join(ASSET_REPO_ROOT, 'sources/miyuki/batches/b-sample-cards.csv') });
    expect(parseCardArgs(['--rewrite-images']).rewriteImages).toBe(true);
  });
});

describe('rewriting card images', () => {
  const row = { card: '867/R', pdf: '867-R.pdf', page: '1' };
  const registryRow = (imageSource: RegistryRow['imageSource'], sourceRef: string): RegistryRow => ({ beadId: '235', size: '11', listingSource: 'sample-card', imageSource, sizeSource: 'sample-card', colorAccuracy: 'photo', sourceRef, addedOn: '2026-10-23' });

  it('rewrites only an original this card row supplied', () => {
    expect(isOwnCardImage(registryRow('sample-card', 'sample card 867/R (867-R.pdf) p.1 bead cell (1,2,3,4) "Inside Dyed Color Fancy"'), row)).toBe(true);
    // the same colour at a size the catalogue supplied: never overwritten by the card's crop
    expect(isOwnCardImage(registryRow('catalogue-gb6', 'GB-6 p.15 cell (221.10, 381.12)'), row)).toBe(false);
    expect(isOwnCardImage(registryRow('sample-card', 'sample card 866R (866R.pdf) p.1 bead cell (1,2,3,4)'), row)).toBe(false);
    expect(isOwnCardImage(undefined, row)).toBe(false);
  });

  it('writes a plan row per resolved bead and per skipped one, quoting fields with commas', () => {
    const resolved = { beadId: '2063', size: '11', row: { card: '853/R', card_section: 'Metallic, Lustered & Fancy / x' }, sidecar: { glassGroup: 'Opaque', finish: 'Frosted (Matte), Metallic', dyed: 'Non Dyed', galvanized: 'Non-galvanized' }, metadataSource: 'decision', metadataKind: 'decision', render: '', bead: { x: 0, y: 0, w: 1, h: 1 } } satisfies Resolved;
    const lines = formatPlan([resolved], new Map([['no official metadata source', ['2291@11']]])).trim().split('\n');
    expect(lines[0]).toBe('beadId,size,card,card_section,glassGroup,finish,dyed,galvanized,metadataSource');
    expect(lines[1]).toBe('2063,11,853/R,"Metallic, Lustered & Fancy / x",Opaque,"Frosted (Matte), Metallic",Non Dyed,Non-galvanized,decision');
    expect(lines[2]).toBe('2291,11,,,,,,,SKIPPED: no official metadata source');
  });
});
