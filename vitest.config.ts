import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      // The shared, brand-agnostic library is held to the coverage gate. Brand sync.ts entry points
      // are network/IO-bound orchestration covered separately by their own integration tests; the
      // single-bead render + derivative pipeline here is the pure logic that must stay well-tested.
      include: ['scripts/beads/common/lib/**/*.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
