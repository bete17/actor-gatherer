// The Browser view (20-browser.js): what the agent did on the page, said in a line under it (bwFeed) and outlined on it
// (bwOutline) -- from a Browser's stream, scripted here: the test home has no Browser, nor a Chrome to run one.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, GATHERER, NOW, openActor } from "./home";

const KEY = "0123456789abcdef";
const DELETE = [40, 60, 120, 30]; // where the agent's click was
const ROW = [30, 50, 400, 50]; // the row whose check failed
const NOW_BOX = [30, 200, 400, 50]; // where the clicked element is when hovered in the list (`where`)

type Action = { i: number; at: number; ok: boolean; text: string; box: number[] | null; detail: string };
const act = (i: number, ago: number, ok: boolean, text: string, box: number[] | null, detail = ""): Action => ({
  i,
  at: (NOW - ago) * 1000,
  ok,
  text,
  box,
  detail,
});
const OLD = act(1, 90, true, "Opened example.com/invoices", null);
const DONE = act(2, 2, true, 'Clicked "Delete" in "Invoice #4411"', DELETE);
const REFUSED = act(
  3,
  1,
  false,
  `Didn't click "Delete": its row now reads "Invoice #4413" (you clicked button "Sort by amount")`,
  ROW,
  "Not done: expect 1 is false: el.innerText.includes('#4411')",
);

/** The test home's actors as Browsers' (their sessions' `role`), a Chrome there to run them; the home's own stream
 * held back, so it does not replace this one. */
async function browserActors(page: Page) {
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    home.browser = true;
    for (const a of home.gatherers.find((g: { name: string }) => g.name === GATHERER).agents)
      a.session = { ...(a.session || {}), role: JSON.stringify({ browser: KEY }) };
    await route.fulfill({ json: home });
  });
  await page.route("**/api/stream*", (route) => route.abort());
  await page.route(`**/browser/w/${KEY}/resize`, (route) => route.fulfill({ json: {} }));
}

/** The Browser's stream: its state as browser.py's `state` sends it, as server-sent events; joined again `retry` ms
 * after it ends. */
const events = (states: object[], frame: string, retry = 150) =>
  `retry: ${retry}\n\nevent: frame\ndata: ${JSON.stringify({ data: frame, w: 800, h: 600 })}\n\n` +
  states
    .map(
      (s) =>
        `event: state\ndata: ${JSON.stringify({
          tabs: [{ title: "Invoices", url: "https://example.com/invoices", loading: false }],
          active: 0,
          picks: [],
          acting: null,
          dialog: null,
          error: "",
          running: true,
          viewport: [800, 600],
          chrome: "own",
          allow: false,
          video: false,
          video_off: "",
          cursor: "",
          tip: null,
          popup: null,
          chooser: null,
          downloads: [],
          ...s,
        })}\n\n`,
    )
    .join("");

test("what the agent did is said under the page and flashed on it; what it didn't, and why, in amber", async ({
  page,
}) => {
  const frame = await page.evaluate(() => {
    const c = document.createElement("canvas");
    [c.width, c.height] = [800, 600];
    const x = c.getContext("2d")!;
    x.fillStyle = "#fff";
    x.fillRect(0, 0, 800, 600);
    return c.toDataURL("image/jpeg").split(",")[1];
  });
  await browserActors(page);
  // joined with one action done before (listed, not flashed); then a click, as it is done and once done; then, joined
  // again, a click refused
  let joins = 0;
  await page.route(`**/browser/w/${KEY}/stream*`, (route) => {
    joins += 1;
    const states =
      joins === 1
        ? [
            { actions: [OLD] },
            { actions: [OLD], acting: { label: 'Clicking "Delete"', box: DELETE } },
            { actions: [OLD, DONE] },
          ]
        : [{ actions: [OLD, DONE, REFUSED] }];
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: events(states, frame, 1500) });
  });
  const asked: number[] = [];
  await page.route(`**/browser/w/${KEY}/where`, async (route) => {
    asked.push(route.request().postDataJSON().i);
    await route.fulfill({ json: { box: NOW_BOX } });
  });
  await openActor(page, CLAUDE);

  const feed = page.locator(".bw-feed"),
    line = feed.locator(".line"),
    outline = page.locator(".bw-stage .acting");
  // the click: said in the past tense, the element it was on flashed where it was, then fading
  await expect(line.locator(".tx")).toHaveText(DONE.text);
  await expect(line.locator(".tm")).toHaveText("2s ago");
  // then the refusal, joined again: amber, the row whose check failed outlined, what the agent was told on hover
  await expect(line.locator(".tx")).toHaveText(REFUSED.text);
  await expect(feed).toHaveClass(/\bno\b/);
  await expect(outline).toHaveClass(/\bno\b/);
  await expect(outline).toHaveCSS("left", `${ROW[0] - 3}px`);
  await expect(line).toHaveAttribute("title", new RegExp("What the agent was told:\\nNot done: expect 1 is false"));
  // gone after its fade
  await expect(outline).toBeHidden({ timeout: 5000 });
  // the line opens to the last ones, the latest first; one hovered, outlined where its element is now
  await line.click();
  const items = feed.locator(".list li");
  await expect(items.locator(".tx")).toHaveText([REFUSED.text, DONE.text, OLD.text]);
  await expect(items.first()).toHaveClass(/\bno\b/);
  await items.nth(1).hover();
  await expect.poll(() => asked).toEqual([2]);
  await expect(outline).toBeVisible();
  await expect(outline).toHaveClass(/\bhover\b/);
  await expect(outline).toHaveCSS("top", `${NOW_BOX[1] - 3}px`);
  // the user scrolling the page: the outline is no longer where its element is
  await page.locator(".bw-stage").hover({ position: { x: 300, y: 400 } });
  await page.mouse.wheel(0, 200);
  await expect(outline).toBeHidden();
  // Esc closes the list
  await line.focus();
  await page.keyboard.press("Escape");
  await expect(feed.locator(".list")).toBeHidden();
  await expect(line).toHaveAttribute("aria-expanded", "false");
});

test("the first action done is flashed: an outline drawn as the agent acts, then flashed in place", async ({
  page,
}) => {
  await browserActors(page);
  // the click under way, held there until the test lets it end
  let ended = false;
  await page.route(`**/browser/w/${KEY}/stream*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: events(
        ended
          ? [{ actions: [DONE] }]
          : [{ actions: [] }, { actions: [], acting: { label: 'Clicking "Delete"', box: DELETE } }],
        "",
      ),
    }),
  );
  await openActor(page, CLAUDE);
  const line = page.locator(".bw-feed .line"),
    outline = page.locator(".bw-stage .acting");
  await expect(line.locator(".tx")).toHaveText('Clicking "Delete"…');
  await expect(page.locator(".bw-feed")).toHaveClass(/\bdoing\b/);
  await expect(outline).toHaveClass(/\bdoing\b/);
  await expect(outline).toHaveCSS("left", `${DELETE[0] - 3}px`);
  ended = true;
  await expect(line.locator(".tx")).toHaveText(DONE.text);
  await expect(outline).toHaveClass(/\bdone\b/);
  await expect(outline).toHaveCSS("left", `${DELETE[0] - 3}px`);
});

test("before the agent has acted the line says so, and does not open", async ({ page }) => {
  await browserActors(page);
  await page.route(`**/browser/w/${KEY}/stream*`, (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: events([{ actions: [] }], "") }),
  );
  await openActor(page, CLAUDE);
  const line = page.locator(".bw-feed .line");
  await expect(line.locator(".tx")).toHaveText("The agent has done nothing on the page yet");
  await expect(line).toBeDisabled();
});

test("an action done while the view was away is listed when it comes back, not flashed", async ({ page }) => {
  await browserActors(page);
  let joins = 0;
  await page.route(`**/browser/w/${KEY}/stream*`, (route) => {
    joins += 1;
    const actions = joins === 1 ? [] : [act(4, 30, true, 'Clicked "Archive"', DELETE)];
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: events([{ actions }], "") });
  });
  await openActor(page, CLAUDE);
  const line = page.locator(".bw-feed .line");
  await expect(line.locator(".tx")).toHaveText('Clicked "Archive"');
  await expect(line.locator(".tm")).toHaveText("30s ago");
  await expect(page.locator(".bw-stage .acting")).toBeHidden({ timeout: 500 }); // a flash would last 3 s
});
