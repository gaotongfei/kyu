import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  outputDir: '.thinkrail/context/verification/playwright',
  use: {
    baseURL: process.env.KYU_BASE_URL || 'http://127.0.0.1:3017',
    channel: 'chromium',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
