import { defineConfig } from "@playwright/test";

// The app end to end (e2e/): Playwright starts the built app (dist/) with Electron. Needs AG_PYTHON, a Python with
// ag's dashboard packages, to run real dashboards from this checkout.
export default defineConfig({
  testDir: "e2e",
  timeout: 150_000,
  workers: 1,
  reporter: "list",
});
