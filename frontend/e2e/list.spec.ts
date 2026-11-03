// The list of actors (page.html: "the agent list", "the list folded, or over the whole page").
import { expect, test } from "./test";
import { GATHERER, masks, open } from "./home";

test("lists the gatherer's actors, each by its name alone: hovered, a card says who it is", async ({ page }) => {
  await open(page);
  const rows = page.locator("#agents button.agent");
  await expect(rows).toHaveCount(2);
  await expect(page.locator("#agents .gatherer-row")).toContainText(GATHERER);
  const claude = rows.filter({ hasText: "Parser fixes" });
  await expect(claude).not.toContainText("/probe-greet Bob");
  await expect(claude).not.toContainText("Fixed the CSV parser's quoting");
  await expect(claude).not.toHaveAttribute("title"); // the card, not the browser's own tooltip
  await expect(rows.filter({ hasText: "Spawn one subagent" })).toHaveCount(1); // no name: its last request in its place
  await expect(page.locator(".side")).toHaveScreenshot("list.png", { mask: masks(page) });
  await claude.hover();
  const card = page.locator("#actor-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Parser fixes");
  await expect(card).toContainText("/probe-greet Bob");
  await expect(card).toContainText("Fixed the CSV parser's quoting");
  const [box, side] = [await card.boundingBox(), await page.locator("#agents").boundingBox()];
  expect(box!.x).toBeGreaterThanOrEqual(side!.x + side!.width); // beside the list, not over it
  await claude.locator(".save-btn").hover(); // over its own buttons: none, their titles say what they do
  await expect(card).toBeHidden();
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

test("the rail groups the actors by gatherer, names each, says who it is hovered, and shows one clicked", async ({
  page,
}) => {
  await open(page);
  await page.locator("#agents .lb-fold").click();
  const rail = page.locator("#rail");
  await expect(rail.locator(".r-gatherer")).toHaveCount(1);
  await expect(rail.locator(".r-gname")).toContainText(GATHERER);
  const actors = rail.locator(".r-actor");
  await expect(actors).toHaveCount(2); // idle ones too: every actor the list shows
  const claude = actors.filter({ hasText: "Parser fixes" });
  await expect(actors.filter({ hasText: "Spawn one subagent" })).toHaveCount(1);
  await claude.hover();
  const card = page.locator("#actor-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Parser fixes");
  await expect(card).toContainText(`${GATHERER} · Claude Code`);
  await expect(card).toContainText("/probe-greet Bob");
  await expect(card).toContainText("Fixed the CSV parser's quoting");
  await expect(page).toHaveScreenshot("rail-card.png", { mask: masks(page) });
  await page.mouse.move(700, 450);
  await expect(card).toBeHidden();
  await claude.click();
  await expect(claude).toHaveAttribute("aria-current", "true");
  // folded from the rail as in the list: its actors go, and come back
  await rail.locator(".r-gname").click();
  await expect(rail.locator(".r-actor")).toHaveCount(1); // the one shown stays in view
  await rail.locator(".r-gname").click();
  await expect(actors).toHaveCount(2);
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
