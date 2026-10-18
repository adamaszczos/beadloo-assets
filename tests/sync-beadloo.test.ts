import { describe, it, expect } from 'vitest';
import { nextDependencySpec } from '../scripts/sync-beadloo.js';

describe('nextDependencySpec', () => {
  it('replaces an exact version', () => {
    expect(nextDependencySpec('0.3.1', '0.4.0')).toBe('0.4.0');
  });

  it('keeps a range prefix', () => {
    expect(nextDependencySpec('^0.3.1', '0.4.0')).toBe('^0.4.0');
    expect(nextDependencySpec('~0.3.1', '0.4.0')).toBe('~0.4.0');
    expect(nextDependencySpec('>=0.3.1', '0.4.0')).toBe('>=0.4.0');
  });

  it('replaces a git pin with the npm version', () => {
    expect(nextDependencySpec('github:adamaszczos/beadloo-assets#a060ef69ae5009cbd49ae2ff39c142caf92739c1', '0.4.0')).toBe('0.4.0');
  });
});
