import { describe, expect, it } from 'vitest';
import { decisionsOverDirectory } from '../../../../scripts/beads/miyuki/round_rocailles/apply-attribute-decisions.js';
import { parseAttributeDecisions } from '../../../../scripts/beads/miyuki/common/attribute-decisions.js';
import type { RegistryRow } from '../../../../scripts/beads/miyuki/common/registry.js';

const decisions = parseAttributeDecisions([
  'colour_no,glassGroup,finish,dyed,galvanized,plating,decided_on,evidence',
  '1340,Transparent,Silverline,Outside Dyed,Non-galvanized,Non-Plating,2026-10-23,family',
  '1446,Transparent,Silverline,Outside Dyed,Non-galvanized,Non-Plating,2026-10-23,family',
].join('\n'));
const row = (beadId: string, size: string, listingSource: RegistryRow['listingSource']): RegistryRow => ({ beadId, size, listingSource, imageSource: listingSource, sizeSource: listingSource, colorAccuracy: 'photo', sourceRef: '', addedOn: '2026-10-23' });

describe('applying attribute decisions', () => {
  it('names a decided number the directory lists at any size: the directory stays the authority', () => {
    expect(decisionsOverDirectory(decisions, [row('1340', '11', 'catalogue-gb6'), row('1446', '11', 'catalogue-gb6'), row('1446', '15', 'directory')])).toEqual(['1446']);
    expect(decisionsOverDirectory(decisions, [row('1340', '11', 'catalogue-gb6')])).toEqual([]);
  });
});
