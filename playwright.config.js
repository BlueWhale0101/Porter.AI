import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: 'list',
  use: { baseURL: 'http://localhost:4178', trace: 'retain-on-failure' },
  projects: [
    { name: 'webkit-phone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'chromium-phone', use: { ...devices['Pixel 5'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'node test/browser/server.mjs',
    url: 'http://localhost:4178/health',
    reuseExistingServer: false,
  },
});
