import { defineConfig } from 'vitest/config';

// Minimal unit-test runner for the pure calculation libs (analyze.ts,
// offer-engine.ts, scaling-advisor.ts). Node environment — these modules have no
// React/DOM or path-alias imports, so no jsdom or alias resolver is needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['app/**/*.test.{ts,tsx}'],
  },
});
