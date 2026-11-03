// A snapshot (`ag-dashboard --out FILE`): the page with a home's data inside it, opened as a file, with no server.
import { expect, test } from "./test";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { CLAUDE, GATHERER, NOW } from "./home";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("draws the home from the data inside it", async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ag-snapshot-"));
  const file = path.join(dir, "snapshot.html");
  try {
    execFileSync(process.env.AG_PYTHON || "python3", ["tests/web_home.py", "--snapshot", file], {
      cwd: ROOT,
      env: { ...process.env, PYTHONPATH: ROOT },
      stdio: "ignore",
    });
    await page.clock.setFixedTime(new Date(NOW * 1000));
    await page.goto("file://" + file);
    await expect(page.locator("#agents")).toContainText(GATHERER);
    await expect(page.locator("#agents")).toContainText(CLAUDE);
    await expect(page).toHaveScreenshot("snapshot.png", { mask: [page.locator("#home")] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
