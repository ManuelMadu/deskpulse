import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  // Electron on shared runners flakes; one retry with traces (PDD §33, R2).
  retries: 1,
  use: {
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
});
