// The list of actors (page.html: "the agent list", "the list folded, or over the whole page").
import { expect, test } from "@playwright/test";
import { GATHERER, masks, open } from "./home";

test("lists the gatherer's actors, each with its harness, name, recap and last request", async ({ page }) => {
  await open(page);
  const rows = page.locator("#agents button.agent");
  await expect(rows).toHaveCount(2);
  await expect(page.locator("#agents .gatherer-row")).toContainText(GATHERER);
  const claude = rows.filter({ hasText: "Parser fixes" });
  await expect(claude).toContainText("/probe-greet Bob");
  await expect(claude).toContainText("Fixed the CSV parser's quoting");
  await expect(rows.filter({ hasText: "Spawn one subagent" })).toHaveCount(1);
  await expect(page.locator(".side")).toHaveScreenshot("list.png", { mask: masks(page) });
});

test("folds to a rail of avatars, and opens again", async ({ page }) => {
  await open(page);
  await page.locator("#agents .lb-fold").click();
  await expect(page.locator("#rail")).toBeVisible();
  await expect(page.locator("#agents")).toBeHidden();
  await expect(page).toHaveScreenshot("list-folded.png", { mask: masks(page) });
  await page.locator("#list-btns .lb-fold").click();
  await expect(page.locator("#agents")).toBeVisible();
});

test("shows every actor over the whole page", async ({ page }) => {
  await open(page);
  await page.locator("#agents .lb-full").click();
  const monitor = page.locator("#monitor");
  await expect(monitor).toBeVisible();
  await expect(monitor).toContainText("Parser fixes");
  await expect(monitor).toContainText("Spawn one subagent");
  await expect(page).toHaveScreenshot("list-over-page.png", { mask: masks(page) });
});
