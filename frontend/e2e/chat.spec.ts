// The Chat view (page.html: "the Files view", "the chat"): turns, the latest whole and the earlier folded, and
// beside them each turn's files and commands.
import { expect, test } from "./test";
import { CLAUDE, CODEX, masks, openActor } from "./home";

test("shows a Claude Code actor's latest turn whole and its earlier turns folded", async ({ page }) => {
  await openActor(page, CLAUDE);
  const main = page.locator("#main");
  await expect(main).toContainText("Ahoy, Bob!");
  await expect(main).toContainText("earlier turns");
  await expect(main).toHaveScreenshot("chat-claude.png", { mask: masks(page) });
});

test("shows a `!` command as a bash bubble, its output under it", async ({ page }) => {
  await openActor(page, CLAUDE);
  const bang = page.locator("#main").getByText("echo", { exact: true }).first();
  await expect(bang).toBeVisible();
  await expect(page.locator("#main")).toContainText("bang");
});

test("opens a folded turn on a click, and folds it again", async ({ page }) => {
  await openActor(page, CLAUDE);
  const main = page.locator("#main");
  const turn = main.getByText("Reply with just: ok", { exact: true });
  await turn.click();
  await expect(main).toContainText("ok");
  await expect(main).toHaveScreenshot("chat-turn-open.png", { mask: masks(page) });
  await turn.click();
});

test("opens the files and commands beside the turn", async ({ page }) => {
  await openActor(page, CLAUDE);
  await page.locator("#main button.fl-bar").click();
  await expect(page.locator("#main .fl-side")).toBeVisible();
  await expect(page.locator("#main")).toHaveScreenshot("chat-side.png", { mask: masks(page) });
});

test("shows a Codex actor's chat", async ({ page }) => {
  await openActor(page, CODEX);
  await expect(page.locator("#main")).toContainText("echo hi");
  await expect(page.locator("#main")).toHaveScreenshot("chat-codex.png", { mask: masks(page) });
});
