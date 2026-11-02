// The actor's other views (page.html: "the Terminal view", "the History view", "the Transcript view") and the Details
// panel beside the chat ("the selected agent", "the chat"'s context cards).
import { expect, test } from "@playwright/test";
import { CLAUDE, masks, openActor } from "./home";

test("the Terminal view of a session with no terminal says so", async ({ page }) => {
  await openActor(page, CLAUDE);
  await page.locator("#controls").getByRole("button", { name: "Terminal" }).click();
  await expect(page.locator("#main")).toHaveScreenshot("terminal.png", { mask: masks(page) });
});

test("the History view lists the actor's history", async ({ page }) => {
  await openActor(page, CLAUDE);
  await page.locator("#controls").getByRole("button", { name: "History" }).click();
  await expect(page.locator("#main")).toContainText("probe-greet");
  await expect(page.locator("#main")).toHaveScreenshot("history.png", { mask: masks(page) });
});

test("Details opens beside the chat, and closes", async ({ page }) => {
  await openActor(page, CLAUDE);
  const details = page.locator("#controls .details-btn").last();
  await details.click();
  await expect(page).toHaveScreenshot("details.png", { mask: masks(page) });
  await details.click();
});
