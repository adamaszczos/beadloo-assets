import { describe, expect, it } from 'vitest';
import { discontinuedTargets, noticeNumbersStillListed, parseGlassEnamelNotice, withDiscontinuedStatus } from '../../../scripts/beads/miyuki/mark-discontinued.js';

const NOTICE = [
  '1\tColor No. In Delica Beads \tComments\tpage\t',
  '2\tDB0106\tDiscontinued &#8594; Alternative color No.: DB0106-1\t1\t',
  '3\tDBS0209\tDiscontinued\t1\t',
  '4\tDB0210\tAvailable\t1\t',
  '128\tColor No. in Non-Delica Beads\tComments\t\t',
  '129\t365\tDiscontinued\t2\t',
  '130\t2562\tDiscontinued &#8594; Alternative color No.: 2562-1\t2\t',
].join('\n');

describe("Miyuki's Glass Enamel notice", () => {
  it('reads the Delica and non-Delica halves, keeping only discontinued colours', () => {
    expect(parseGlassEnamelNotice(NOTICE)).toEqual([
      { kind: 'delica', number: 'DB0106', comment: 'Discontinued → Alternative color No.: DB0106-1' },
      { kind: 'delica', number: 'DBS0209', comment: 'Discontinued' },
      { kind: 'non-delica', number: '365', comment: 'Discontinued' },
      { kind: 'non-delica', number: '2562', comment: 'Discontinued → Alternative color No.: 2562-1' },
    ]);
  });

  it('marks a Delica number at the size its prefix names and a colour number at every round-rocaille size on disk', () => {
    const onDisk = ['delica/11/DB0106', 'delica/15/DBS0209', 'delica/11/DB0500', 'round_rocailles/11/365', 'round_rocailles/15/365', 'round_rocailles/11/2562'];
    const exists = (file: string) => onDisk.some((suffix) => file.endsWith(`${suffix}.metadata.json`));
    const targets = discontinuedTargets(parseGlassEnamelNotice(NOTICE), ['DB0500'], exists);
    const short = targets.map((t) => t.file.split('/miyuki/')[1]).sort();
    expect(short).toEqual(['delica/11/DB0106.metadata.json', 'delica/11/DB0500.metadata.json', 'delica/15/DBS0209.metadata.json', 'round_rocailles/11/2562.metadata.json', 'round_rocailles/11/365.metadata.json', 'round_rocailles/15/365.metadata.json']);
    expect(targets.find((t) => t.file.endsWith('DB0500.metadata.json'))).toMatchObject({ beadType: 'miyuki-delica', reason: expect.stringMatching(/Delica list/) });
    expect(targets.find((t) => t.file.endsWith('15/365.metadata.json'))?.beadType).toBe('miyuki-round_rocailles');
    expect(targets.find((t) => t.file.endsWith('2562.metadata.json'))?.reason).toMatch(/2023-07-03: Discontinued → Alternative color No.: 2562-1/);
  });
});

describe('withDiscontinuedStatus', () => {
  it('adds the status once, keeping the issue #203 fields in a stable order', () => {
    const first = withDiscontinuedStatus({ shape: 'Delica', plating: 'Non-Plating', colorAccuracy: 'photo', formerly: 'DB0001' });
    expect(first.changed).toBe(true);
    expect(Object.keys(first.sidecar)).toEqual(['shape', 'plating', 'status', 'colorAccuracy', 'formerly']);
    expect(withDiscontinuedStatus(first.sidecar).changed).toBe(false);
  });
});

describe('notice numbers Miyuki still sells', () => {
  it('names the listings of a discontinued number: a Delica as itself, a colour number as a round rocaille at any size', () => {
    const listings = [
      { beadType: 'miyuki-delica', beadId: 'DB0106', size: '11' },
      { beadType: 'miyuki-delica', beadId: 'DB0210', size: '11' },
      { beadType: 'miyuki-round_rocailles', beadId: '365', size: '15' },
      { beadType: 'miyuki-round_rocailles', beadId: '365', size: '8' },
      { beadType: 'miyuki-round_rocailles', beadId: '2562-1', size: '11' },
    ] as const;
    expect(noticeNumbersStillListed(parseGlassEnamelNotice(NOTICE), listings)).toEqual(['365@8', '365@15', 'DB0106@11']);
  });
});
