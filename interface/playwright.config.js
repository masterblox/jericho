import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
  webServer: [
    {
      command: 'npm run dev:a',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev:b',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
