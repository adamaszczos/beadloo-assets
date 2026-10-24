import { describe, expect, it } from 'vitest';
import { parseAttributeDecisions, withDecidedAttributes, withDecisionNote } from '../../../../scripts/beads/miyuki/common/attribute-decisions.js';

const HEADER = 'colour_no,glassGroup,finish,dyed,galvanized,plating,decided_on,evidence';
const ROW = '1340,Transparent,"Outside-Dyed, Silverline",Outside Dyed,Non-galvanized,Non-Plating,2026-10-23,"directory family, 15 of 15"';

describe('round-rocaille attribute decisions', () => {
  it('reads one decision per colour number, upper-cased, with its evidence', () => {
    const decisions = parseAttributeDecisions(`${HEADER}\n${ROW}\n411f,Opaque,Frosted (Matte),Non Dyed,Non-galvanized,Non-Plating,2026-10-23,card run\n`);
    expect(decisions.get('1340')).toEqual({
      colourNo: '1340', glassGroup: 'Transparent', finish: 'Outside-Dyed, Silverline', dyed: 'Outside Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', decidedOn: '2026-10-23', evidence: 'directory family, 15 of 15',
    });
    expect(decisions.has('411F')).toBe(true);
  });

  it('refuses a missing column, an empty field and a number decided twice', () => {
    expect(() => parseAttributeDecisions('colour_no,glassGroup\n1,Opaque\n')).toThrow(/missing column finish/);
    expect(() => parseAttributeDecisions(`${HEADER}\n1340,Transparent,Silverline,Non Dyed,Non-galvanized,Non-Plating,2026-10-23,\n`)).toThrow(/1340 has no evidence/);
    expect(() => parseAttributeDecisions(`${HEADER}\n${ROW}\n${ROW}\n`)).toThrow(/1340 is decided twice/);
  });

  it('refuses a row whose columns shifted, rather than reading a finish term as the dyed field', () => {
    const unquoted = '1340,Transparent,Outside-Dyed, Silverline,Outside Dyed,Non-galvanized,Non-Plating,2026-10-23,evidence';
    expect(() => parseAttributeDecisions(`${HEADER}\n${unquoted}\n`)).toThrow(/row 2 \(1340\) has 9 cells, the header 8/);
  });

  it('refuses a date that is not YYYY-MM-DD and a value outside the directory vocabulary', () => {
    expect(() => parseAttributeDecisions(`${HEADER}\n${ROW.replace('2026-10-23', '23/10/2026')}\n`)).toThrow(/decided_on "23\/10\/2026"/);
    expect(() => parseAttributeDecisions(`${HEADER}\n${ROW.replace('2026-10-23', '2026-13-45')}\n`)).toThrow(/decided_on/);
    expect(() => parseAttributeDecisions(`${HEADER}\n${ROW.replace('Outside Dyed', 'Silverline')}\n`)).toThrow(/1340: dyed "Silverline" is not one of/);
    expect(() => parseAttributeDecisions(`${HEADER}\n${ROW.replace('Non-galvanized', 'galvanised')}\n`)).toThrow(/galvanized "galvanised"/);
    expect(() => parseAttributeDecisions(`${HEADER}\n${ROW.replace('Non-Plating', 'None')}\n`)).toThrow(/plating "None"/);
  });

  it('reads a file saved with a byte-order mark', () => {
    expect(parseAttributeDecisions(`\uFEFF${HEADER}\n${ROW}\n`).has('1340')).toBe(true);
  });

  it('replaces only the five attributes, keeping every other field and their order', () => {
    const sidecar = { shape: 'Round Rocailles', size: '11/0', colorGroup: 'Pink', glassGroup: 'Alabaster', finish: 'Outside-Dyed, Silverline', dyed: 'Outside Dyed', galvanized: 'Non-galvanized', plating: 'Non-Plating', status: 'Discontinued', colorAccuracy: 'swatch' };
    const decision = parseAttributeDecisions(`${HEADER}\n${ROW}\n`).get('1340')!;
    const { sidecar: next, changed } = withDecidedAttributes(sidecar, decision);
    expect(changed).toBe(true);
    expect(next).toEqual({ ...sidecar, glassGroup: 'Transparent' });
    expect(Object.keys(next)).toEqual(Object.keys(sidecar));
    expect(withDecidedAttributes(next, decision).changed).toBe(false);
  });

  it('notes the decision once in the registry row, and not on a bead the decision itself added', () => {
    const decision = parseAttributeDecisions(`${HEADER}\n${ROW}\n`).get('1340')!;
    const noted = withDecisionNote('GB-6 p.14 cell (1, 2); metadata: heading', decision);
    expect(noted).toBe('GB-6 p.14 cell (1, 2); metadata: heading; attributes: reviewed decision 2026-10-23 (sources/miyuki/round-rocaille-attributes.csv)');
    expect(withDecisionNote(noted, decision)).toBe(noted);
    const added = 'sample card 853/R (853-R.pdf) p.1 bead cell (1,2,3,4) "x"; size: 11/0; metadata: reviewed decision 2026-10-23: card run';
    expect(withDecisionNote(added, decision)).toBe(added);
  });

  it('replaces the note of an older decision rather than adding a second one', () => {
    const decision = parseAttributeDecisions(`${HEADER}\n${ROW.replace('2026-10-23', '2026-10-24')}\n`).get('1340')!;
    const older = 'GB-6 p.14 cell (1, 2); metadata: heading; attributes: reviewed decision 2026-10-23 (sources/miyuki/round-rocaille-attributes.csv)';
    expect(withDecisionNote(older, decision)).toBe('GB-6 p.14 cell (1, 2); metadata: heading; attributes: reviewed decision 2026-10-24 (sources/miyuki/round-rocaille-attributes.csv)');
  });
});
