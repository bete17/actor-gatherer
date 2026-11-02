// Browser tests of the dashboard (ag_dashboard/DESIGN.md, step A0): the page as a reader uses it, on a home of
// recorded sessions (tests/web_home.py) that the dashboard serves for the run, at a fixed clock and zone so every
// run draws the same page. Screenshots are kept per platform (Playwright's default naming).
//
//   pnpm e2e                    run them (AG_PYTHON: the Python with ag's dependencies; default python3)
//   pnpm e2e:update             write the screenshots again, after a change meant to change them
//   PW_CHANNEL=chrome pnpm e2e  in the installed Google Chrome, without Playwright's own browser
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PORT = Number(process.env.AG_E2E_PORT || 47913);
const ROOT = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1, // one dashboard, one home: tests that change it (panes, settings) run one at a time
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" } },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 1300, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  webServer: {
    // the page built first (frontend/'s build, which the dashboard serves), then served on the test home
    command: `cd frontend && "${process.execPath}" node_modules/vite/bin/vite.js build --logLevel warn && cd .. && ${
      process.env.AG_PYTHON || "python3"
    } tests/web_home.py --serve ${PORT}`,
    cwd: ROOT,
    env: { PYTHONPATH: ROOT },
    url: `http://127.0.0.1:${PORT}/api/home`,
    reuseExistingServer: false, // a fresh home each run: what a run marks seen or opens does not carry to the next
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
