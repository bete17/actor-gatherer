// The actor's other views (page.html: "the Terminal view", "the History view", "the Transcript view") and the Details
// panel beside the chat ("the selected agent", "the chat"'s context cards).
import type { WebSocketRoute } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, NOW, masks, openActor } from "./home";

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

test("an item opened in the Context panel stays open as the context grows", async ({ page }) => {
  // the actor as the stream brings it, sent again with an item more at the context's end: what ag stored since the
  // latest call (`after_read`), as each new message adds to it
  let last: [string, Record<string, unknown>] | null = null;
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/api\/ws$/, (ws) => {
    socket = ws;
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const [id, name, ...data] = typeof m === "string" ? m.split("\n") : [];
      if (name === "agent") last = [id, JSON.parse(data.join("\n"))];
      ws.send(m);
    });
  });
  await openActor(page, CLAUDE);
  await page.locator("#controls .details-btn").last().click();
  await page.locator(".drawer-head").getByRole("button", { name: "Context" }).click();
  const items = page.locator(".drawer .ctx details.item");
  await expect(items.first()).toBeVisible();
  const before = await items.count();
  const opened = items.nth(1);
  await opened.locator("summary").click();
  await expect(opened.locator("pre")).toBeVisible();

  expect(last, "the actor's stream message").not.toBeNull();
  const [id, agent] = last!;
  const more = {
    position: null,
    group: "Stored since the latest call",
    name: "user_message",
    tokens: 3,
    row_id: 999999,
    made_id: null,
    at: NOW,
    clipped: 0,
    text: "a message stored after the latest call",
  };
  const grown = { ...agent, after_read: [...((agent.after_read as unknown[]) || []), more] };
  socket!.send(`${id}\nagent\n${JSON.stringify(grown)}`);

  await expect(items).toHaveCount(before + 1);
  await expect(items.last()).toContainText("a message stored after the latest call");
  await expect(items.nth(1)).toHaveJSProperty("open", true);
  await expect(items.nth(1).locator("pre")).toBeVisible();
});
