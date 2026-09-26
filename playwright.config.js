import { defineConfig } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  // A stray test.only would silently shrink the CI gate to one test.
  forbidOnly: CI,
  // CI runners are slower than this laptop and the charts are the slow part;
  // one retry keeps a timing wobble from failing a good commit. A test that
  // needs the retry every run is a broken test, not a slow one — the report
  // artifact flags retried tests so they do not hide.
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4322',
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    // Astro may daemonize when it detects an agent; Playwright owns this process.
    command: 'npm run preview -- --ignore-lock --host 127.0.0.1 --port 4322',
    url: 'http://127.0.0.1:4322',
    reuseExistingServer: false,
  },
});
