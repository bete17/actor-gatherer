// The list of actors (page.html: "the agent list", "the list folded, or over the whole page").
import { expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, masks, open } from "./home";

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

test("the rail starts a new actor in a gatherer: its harness picked beside the rail, its directory asked if it fails", async ({
  page,
}) => {
  // the home as the server has it, but with two harnesses a session can be started on here, and its actors working in a
  // directory (its stream held back, so the server's own home does not replace it)
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    for (const a of home.gatherers.find((x: { name: string }) => x.name === GATHERER).agents) a.cwd = "/work/demo";
    home.harnesses = ["claude", "codex"];
    for (const h of home.harnesses) home.harness_info[h] = { ...home.harness_info[h], runs: true };
    await route.fulfill({ json: home });
  });
  await page.route("**/api/stream*", (route) => route.abort());
  const asked: { gatherer: string; cwd: string; harness: string }[] = [];
  await page.route("**/api/sessions", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { error: "no directory /gone" } });
  });
  await open(page);
  await page.locator("#agents .lb-fold").click();
  const rail = page.locator("#rail");
  const plus = rail.locator(".r-new");
  await expect(plus).toHaveCount(1); // one for the one gatherer, under its name
  await expect(plus).toHaveAttribute("aria-label", `New actor in ${GATHERER}`);
  await plus.click();
  const menu = page.locator(".row-menu[role=menu]");
  await expect(menu).toBeVisible();
  const [box, side] = [await menu.boundingBox(), await rail.boundingBox()];
  expect(box!.x).toBeGreaterThanOrEqual(side!.x + side!.width); // beside the rail, not over it
  await expect(menu.locator("[role=menuitem] .nm")).toHaveText(["Claude Code", "Codex"]);
  await menu.getByRole("menuitem", { name: "Codex" }).click();
  // started in the directory its newest actor works in; that failing, a box asks for one, saying why
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toEqual({ gatherer: GATHERER, cwd: "/work/demo", harness: "codex" });
  const ask = page.locator(".dw-menu[role=dialog]");
  await expect(ask).toBeVisible();
  await expect(ask).toContainText(`New actor in ${GATHERER}`);
  await expect(ask.locator(".err")).toHaveText("no directory /gone");
  await expect(ask.locator("input")).toHaveValue("/work/demo"); // the one tried
  await ask.locator("input").fill("~/elsewhere");
  await ask.getByRole("button", { name: "Claude Code" }).click();
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toMatchObject({ gatherer: GATHERER, cwd: "~/elsewhere", harness: "claude" });
  await expect(ask).toBeVisible(); // failed again: still open, for another try
  await plus.click(); // pressed again: closed
  await expect(ask).toBeHidden();
  await expect(plus).toHaveAttribute("aria-expanded", "false");
});

test("the rail's avatars have the list's bookmark and ×, over their corners: pressed, they save or close, not show", async ({
  page,
}) => {
  // the home as the server has it, but the Claude Code actor's process run by the dashboard, so it can be closed (its
  // stream held back, so the server's own home does not replace it)
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const claude = home.gatherers
      .find((x: { name: string }) => x.name === GATHERER)
      .agents.find((a: { harness?: string }) => a.harness === "claude");
    claude.session = { session_id: "s-claude", pid: 4242, status: "idle", cwd: "/work/demo" };
    claude.chattable = true;
    await route.fulfill({ json: home });
  });
  await page.route("**/api/stream*", (route) => route.abort());
  const saved: unknown[] = [],
    stopped: unknown[] = [];
  await page.route("**/api/saved", async (route) => {
    const asked = route.request().postDataJSON();
    saved.push(asked);
    // as the server answers: every actor saved
    await route.fulfill({ json: asked.saved ? { [asked.gatherer]: { [asked.channel]: "2026-10-01T00:00:00Z" } } : {} });
  });
  await page.route("**/api/stop", async (route) => {
    stopped.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  await open(page);
  await page.locator("#agents .lb-fold").click();
  const rail = page.locator("#rail");
  const claude = rail.locator(".r-actor", { hasText: CLAUDE });
  const codex = rail.locator(".r-actor", { hasText: CODEX });
  await expect(claude.locator(".close-btn")).toHaveCount(1);
  await expect(codex.locator(".close-btn")).toHaveCount(0); // no process of it the dashboard runs: none to close
  // over the tile's corners, beside the avatar: no taller for them, and shown only while hovered
  const [tile, pic, bookmark, x] = await Promise.all(
    [claude, claude.locator(".r-pic"), claude.locator(".save-btn"), claude.locator(".close-btn")].map((n) =>
      n.boundingBox(),
    ),
  );
  expect(bookmark!.x + bookmark!.width).toBeLessThanOrEqual(pic!.x);
  expect(x!.x).toBeGreaterThanOrEqual(pic!.x + pic!.width);
  for (const b of [bookmark!, x!]) expect(b.y).toBeGreaterThanOrEqual(tile!.y);
  await expect(claude.locator(".close-btn")).toHaveCSS("opacity", "0");
  await claude.hover();
  await expect(claude.locator(".close-btn")).toHaveCSS("opacity", "1");
  await claude.locator(".save-btn").click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ gatherer: GATHERER, saved: true });
  await expect(claude.locator(".save-btn.on")).toHaveCount(1); // filled, and shown with the pointer away too
  await page.mouse.move(700, 450);
  await expect(claude.locator(".save-btn.on")).toHaveCSS("opacity", "1");
  await expect(claude).toHaveAttribute("aria-current", "false"); // pressing it did not show the actor
  await claude.hover();
  await claude.locator(".close-btn").click();
  await expect.poll(() => stopped.length).toBe(1);
  expect(stopped[0]).toEqual({ session_id: "s-claude" });
  await expect(claude).toHaveAttribute("aria-current", "false");
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

test("lists a saved actor by its status while open, and under Saved once closed", async ({ page }) => {
  // the home as the server has it, but both actors saved for later and the Codex one closed (its stream held back, so
  // the server's own home, with neither, does not replace it)
  let codexChannel = "";
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const g = home.gatherers.find((x: { name: string }) => x.name === GATHERER);
    const codex = g.agents.find((a: { harness?: string }) => a.harness === "codex");
    codex.status = "closed";
    codexChannel = codex.channel;
    home.saved = {
      [GATHERER]: Object.fromEntries(g.agents.map((a: { channel: string }) => [a.channel, "2026-10-01T00:00:00Z"])),
    };
    await route.fulfill({ json: home });
  });
  await page.route("**/api/stream*", (route) => route.abort());
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  await expect(claude).toBeVisible();
  await expect(claude.locator(".save-btn.on")).toHaveCount(1); // still saved: its bookmark filled
  // the open one among the idle (or finished), not under Saved; the closed one folded away under Saved: 1 there, of 2
  const saved = page.locator("#agents .saved-line");
  await expect(saved).toHaveText("▸ 1 of 2 saved");
  const order = await page
    .locator("#agents .gatherer")
    .first()
    .evaluate((box) =>
      [...box.children].map((n) =>
        n.matches(".agent-group") ? `[${n.textContent}]` : n.getAttribute("data-key") || "",
      ),
    );
  const at = (key: string) => order.findIndex((x) => x === key || x.endsWith("/" + key));
  expect(at("[Idle]") >= 0 || at("[Finished]") >= 0, order.join(" | ")).toBe(true);
  const claudeKey = await claude.getAttribute("data-key");
  expect(order.indexOf(claudeKey || "?"), order.join(" | ")).toBeGreaterThan(Math.max(at("[Idle]"), at("[Finished]")));
  expect(codexChannel).not.toBe("");
  await saved.click();
  await expect(saved).toHaveText("▾ 1 of 2 saved");
  const codexRow = page.locator(`#agents button.agent[data-key="${GATHERER}/${codexChannel}"]`);
  await expect(codexRow).toBeVisible();
});

test("files saved actors in folders: made from the Saved line, filled by dragging, renamed and deleted", async ({
  page,
}) => {
  await open(page);
  type Home = {
    gatherers: { name: string; agents: { harness?: string; channel: string }[] }[];
    saved: Record<string, Record<string, string>>;
    saved_folders: Record<string, Record<string, string[]>>;
  };
  const home = async () => (await (await page.request.get("/api/home")).json()) as Home;
  const g = (await home()).gatherers.find((x) => x.name === GATHERER)!;
  const channelOf = (harness: string) => g.agents.find((a) => a.harness === harness)!.channel;
  const [claudeCh, codexCh] = [channelOf("claude"), channelOf("codex")];
  const row = (text: string) => page.locator("#agents button.agent", { hasText: text });
  const savedLine = page.locator("#agents .saved-line");
  try {
    await expect(savedLine).toHaveCount(0); // nothing saved, no folder: no Saved line
    await row(CODEX).hover();
    await row(CODEX).locator(".save-btn").click(); // the bookmark: saved, in no folder
    await expect(savedLine).toHaveText("▸ 0 of 1 saved"); // idle: listed among the idle still, counted in all
    await expect(row(CODEX).locator(".save-btn.on")).toHaveCount(1);
    await savedLine.hover();
    await savedLine.locator(".folder-act.new").click();
    await expect(savedLine).toContainText("▾ 0 of 1 saved");
    const box = page.locator("#agents .folder-box");
    await box.fill("  Paper   revisions ");
    await box.press("Enter");
    const folder = page.locator("#agents .folder-line", { hasText: "Paper revisions" });
    await expect(folder.locator(".n")).toHaveText("empty");
    await expect(savedLine).toContainText("▾ 0 of 1 saved · 1 folder");
    await expect.poll(async () => (await home()).saved_folders).toEqual({ [GATHERER]: { "Paper revisions": [] } });

    await row(CLAUDE).dragTo(folder); // saved, and in it
    await expect(row(CLAUDE).locator(".in-folder-chip")).toHaveText("Paper revisions"); // open: listed by its status
    await expect(folder.locator(".n")).toHaveText("0 of 1"); // none of it listed there, of 1 in it
    await expect(savedLine).toContainText("▾ 0 of 2 saved");
    await expect
      .poll(async () => (await home()).saved_folders)
      .toEqual({ [GATHERER]: { "Paper revisions": [claudeCh] } });
    expect(Object.keys((await home()).saved[GATHERER]).sort()).toEqual([claudeCh, codexCh].sort());

    await folder.hover();
    await folder.locator(".folder-act.rename").click();
    await box.fill("Drafts");
    await box.press("Enter");
    await expect(page.locator("#agents .folder-line", { hasText: "Drafts" })).toBeVisible();
    await expect(row(CLAUDE).locator(".in-folder-chip")).toHaveText("Drafts");
    await expect.poll(async () => (await home()).saved_folders).toEqual({ [GATHERER]: { Drafts: [claudeCh] } });

    await row(CLAUDE).dragTo(savedLine); // out of its folder, still saved
    await expect(row(CLAUDE).locator(".in-folder-chip")).toHaveCount(0);
    await expect(row(CLAUDE).locator(".save-btn.on")).toHaveCount(1);
    await expect.poll(async () => (await home()).saved_folders).toEqual({ [GATHERER]: { Drafts: [] } });

    const drafts = page.locator("#agents .folder-line", { hasText: "Drafts" });
    await drafts.hover();
    await drafts.locator(".folder-act.delete").click();
    await expect(page.locator("#agents .folder-line")).toHaveCount(0);
    await expect.poll(async () => (await home()).saved_folders).toEqual({}); // none left

    // held over the Saved line while folded, it opens, for the folder in it to be dropped on
    await page.request.post("/api/saved/folders", { data: { gatherer: GATHERER, do: "new", name: "Later" } });
    await savedLine.click(); // folded
    await expect(savedLine).toContainText("▸ 0 of 2 saved · 1 folder");
    await row(CODEX).hover();
    await page.mouse.down();
    const at = await savedLine.boundingBox();
    await page.mouse.move(at!.x + 30, at!.y + at!.height / 2, { steps: 4 });
    await expect(savedLine).toContainText("▾ 0 of 2 saved", { timeout: 3000 });
    const later = page.locator("#agents .folder-line", { hasText: "Later" });
    const to = await later.boundingBox();
    await page.mouse.move(to!.x + 40, to!.y + to!.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(row(CODEX).locator(".in-folder-chip")).toHaveText("Later");
    await expect.poll(async () => (await home()).saved_folders).toEqual({ [GATHERER]: { Later: [codexCh] } });
  } finally {
    for (const c of [claudeCh, codexCh])
      await page.request.post("/api/saved", { data: { gatherer: GATHERER, channel: c, saved: false } });
    const left = ((await home()).saved_folders || {})[GATHERER] || {};
    for (const name of Object.keys(left))
      await page.request.post("/api/saved/folders", { data: { gatherer: GATHERER, do: "delete", name } });
  }
});

test("lists a closed saved actor in its folder, folded till opened", async ({ page }) => {
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const g = home.gatherers.find((x: { name: string }) => x.name === GATHERER);
    const codex = g.agents.find((a: { harness?: string }) => a.harness === "codex");
    codex.status = "closed";
    home.saved = { [GATHERER]: { [codex.channel]: "2026-10-01T00:00:00Z" } };
    home.saved_folders = { [GATHERER]: { Paper: [codex.channel], Empty: [] } };
    await route.fulfill({ json: home });
  });
  await page.route("**/api/stream*", (route) => route.abort());
  await open(page);
  const savedLine = page.locator("#agents .saved-line");
  await expect(savedLine).toHaveText("▸ 1 of 1 saved · 2 folders");
  await savedLine.click();
  const lines = page.locator("#agents .folder-line");
  await expect(lines).toHaveText([/Empty\s*empty/, /Paper\s*1 of 1/]); // by name
  const codexRow = page.locator("#agents button.agent.in-folder", { hasText: CODEX });
  const isOpen = await codexRow.count(); // the first actor is shown, so in view under its folded folder
  await lines.filter({ hasText: "Paper" }).click();
  await expect(codexRow).toBeVisible();
  await expect(codexRow.locator(".in-folder-chip")).toHaveCount(0); // listed in it: not named again
  await lines.filter({ hasText: "Paper" }).click();
  await expect(codexRow).toHaveCount(isOpen);
});
