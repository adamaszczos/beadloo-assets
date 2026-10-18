import { describe, expect, it } from 'vitest';
import { parseArgs, VALID_SIZES } from '../../../../scripts/beads/miyuki/delica/sync.js';

describe('parseArgs (delica)', () => {
  it('defaults to every size', () => {
    expect(parseArgs([])).toEqual({ sizes: VALID_SIZES, dryRun: false, verbose: false, localOnly: false, force: false });
  });

  it('reads the flags and ignores unknown sizes', () => {
    expect(parseArgs(['--sizes', '8,10,7', '--local-only', '--force', '--verbose'])).toEqual({
      sizes: ['8', '10'],
      dryRun: false,
      verbose: true,
      localOnly: true,
      force: true,
    });
  });
});
