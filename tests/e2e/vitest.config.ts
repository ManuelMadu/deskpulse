import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // *.spec.ts files are Playwright's (run via `npm run e2e`), never Vitest's.
    include: ['src/**/*.test.ts'],
  },
});
