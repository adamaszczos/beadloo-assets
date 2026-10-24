import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { isPhotoDonor, originalPath, sidecarPath } from '../../../../scripts/beads/miyuki/common/bead-files.js';
import { BEADS_ROOT, DOWNLOADED_ROOT } from '../../../../scripts/beads/common/lib/paths.js';
import { registryKey, type RegistryRow } from '../../../../scripts/beads/miyuki/common/registry.js';

const row = (beadId: string, size: string, extra: Partial<RegistryRow> = {}): RegistryRow => ({ beadId, size, listingSource: 'directory', imageSource: 'directory', sizeSource: 'directory', colorAccuracy: 'photo', sourceRef: '', addedOn: '2026-10-16', ...extra });

describe("a bead's files", () => {
  it('resolves the sidecar under beads/ and the original under downloaded/', () => {
    expect(sidecarPath('miyuki-round_rocailles', '11', '2479-1')).toBe(path.join(BEADS_ROOT, 'miyuki', 'round_rocailles', '11', '2479-1.metadata.json'));
    expect(originalPath('miyuki-delica', '11', 'DB0106-1')).toBe(path.join(DOWNLOADED_ROOT, 'miyuki', 'delica', '11', 'DB0106-1.jpg'));
  });

  it("lends an original only from another size, as Miyuki's photo, with the file on disk", () => {
    const rows = [row('2049', '15'), row('2045', '11', { listingSource: 'retailer', imageSource: 'rendered', colorAccuracy: 'approximate' }), row('22', '8', { colorAccuracy: 'swatch' })];
    const registry = new Map(rows.map((r) => [registryKey(r.beadId, r.size), r]));
    const onDisk = (size: string, beadId: string) => !(beadId === '2049' && size === '6');
    expect(isPhotoDonor('2049', '15', '11', registry, onDisk)).toBe(true);
    expect(isPhotoDonor('2049', '15', '15', registry, onDisk)).toBe(false);
    expect(isPhotoDonor('2045', '11', '8', registry, onDisk)).toBe(false);
    expect(isPhotoDonor('22', '8', '11', registry, onDisk)).toBe(false);
    expect(isPhotoDonor('2049', '6', '11', new Map([[registryKey('2049', '6'), row('2049', '6')]]), onDisk)).toBe(false);
  });
});
