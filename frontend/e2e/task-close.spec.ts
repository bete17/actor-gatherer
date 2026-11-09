// A TASK SAVED AND CLOSED (05-agent-list.js's taskSaveButton, taskCloseButton): its bookmark saves every actor in it; its
// × closes them and puts its apps to sleep (kept, in the task: app_host.py's `sleep_instance`), opened again as it was;
// in its card, each actor's own bookmark and close, and "take out" a mark of its own.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { GATHERER, open } from "./home";
import { addNotepad, cardOf, taskHome, taskRow } from "./task-home";

// the requests closing a task makes, answered here: each actor's process closed (/api/stop), each app put to sleep
async function closings(page: Page) {
  const asked: string[] = [];
  await page.route("**/api/stop", async (route) => {
    asked.push(`stop ${route.request().postDataJSON().session_id}`);
    await route.fulfill({ json: {} });
  });
  await page.route("**/api/apps/sleep", async (route) => {
    asked.push("sleep");
    await route.continue();
  });
  return asked;
}

test("a task's bookmark saves every actor in it; its × closes them and puts its apps to sleep, their panels closed", async ({
  page,
}) => {
  await taskHome(page, true, true);
  const asked = await closings(page);
  await open(page);
  const row = taskRow(page);
  await addNotepad(page, row);
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(notes).toHaveCount(1);
  const home = await (await page.request.get("/api/home")).json();
  const channels: string[] = Object.keys(home.tasks[GATHERER].tasked).filter((k) => !k.startsWith("app:"));
  expect(channels).toHaveLength(2);
  try {
    await page.mouse.move(0, 0);
    await row.hover();
    const save = row.locator(".a-acts .save-btn");
    await save.click(); // every actor in it saved
    await expect(save).toHaveClass(/\bon\b/);
    await expect
      .poll(async () =>
        Object.keys((await (await page.request.get("/api/home")).json()).saved?.[GATHERER] || {}).sort(),
      )
      .toEqual([...channels].sort());
    await row.locator(".a-acts .close-btn").click(); // closed: its actors' processes, its app asleep, its panel gone
    await expect.poll(() => [...asked].sort()).toEqual(["sleep", ...channels.map((c) => `stop ${c}`)].sort());
    await expect(notes).toHaveCount(0);
    await page.mouse.move(0, 0);
    await row.click(); // opened again: as it was left, its app's panel back
    await expect(notes).toHaveCount(1);
  } finally {
    for (const channel of channels)
      await page.request.post("/api/saved", { data: { gatherer: GATHERER, channel, saved: false } });
  }
});

test("in a task's card each actor has its own bookmark and close, and a mark of its own to take it out", async ({
  page,
}) => {
  await taskHome(page, true, true);
  const asked = await closings(page);
  await open(page);
  const card = await cardOf(page, taskRow(page));
  const actors = card.locator(".c-task-row:not(.c-app-row)");
  await expect(actors).toHaveCount(2);
  for (const r of await actors.all()) {
    await expect(r.locator(".save-btn")).toHaveCount(1);
    await expect(r.locator(".close-btn")).toHaveCount(1);
    await expect(r.locator(".take-out circle")).toHaveCount(0); // not a close's circled ×
  }
  const first = actors.first(),
    channel = await first.locator(".nm").textContent();
  await first.locator(".close-btn").click(); // that actor alone closed
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toMatch(/^stop /);
  expect(channel).toBeTruthy();
});
