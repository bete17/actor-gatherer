// Lines an actor wrote in Notes from its own conversation with the user (notes_add / notes_change with
// from_conversation: ag_apps/notes/): its avatar at the end of the last of them -- who wrote them and when -- which opens
// the conversation about them beside the page, where the user follows up with that actor; lines it was only told to
// write name no one. The test home's actors have no session for the apps' MCP server, so the lines and the actor's
// reply are put in as its tools leave them (tests/test_app_notes.py tests the tools); what reaches it from the page is
// /api/send, held here.
import type { FrameLocator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, GATHERER, NOW, open } from "./home";
import { call, openNotes } from "./notes-home";

/** The test home's Claude Code actor (tests/web_home.py), the one named CLAUDE. */
const ACTOR = "5f0c2a2e-8d1b-4c7e-9a3f-1b2c3d4e5f60";
const WROTE = NOW - 600;

/** The panel's connection to its backend (app_kit/js/app.js), as a test reaches it in the panel's frame. */
type Panel = { AgApp: { connect(): Promise<{ api(path: string, init?: RequestInit): Promise<Response> }> } };

/** Ops applied to the notebook as the actor's tools apply them, through the panel's own backend. */
async function asActor(panel: FrameLocator, ops: unknown[]) {
  await panel.locator("body").evaluate(
    async (_, [by, ops]) => {
      const ag = await (window as unknown as Panel).AgApp.connect();
      const r = await ag.api("ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ by, ops }),
      });
      if (!r.ok) throw new Error(await r.text());
    },
    [`agent:${ACTOR}`, ops] as const,
  );
}

async function threadOf(panel: FrameLocator, id: string): Promise<Record<string, unknown>[]> {
  return panel.locator("body").evaluate(async (_, id) => {
    const ag = await (window as unknown as Panel).AgApp.connect();
    const st = await (await ag.api("state")).json();
    for (const p of st.pages) for (const b of p.blocks || []) if (b.id === id) return b.thread || [];
    return [];
  }, id);
}

async function holdSends(page: Page): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/send", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  return sent;
}

test("lines an actor wrote from its conversation name it, and a follow-up from the page goes to it", async ({
  page,
}) => {
  const sent = await holdSends(page);
  await open(page);
  const { panel, instance } = await openNotes(page);
  const src = { source: ACTOR, source_at: WROTE };
  await asActor(panel, [
    {
      op: "page.new",
      page: { id: "discpage01", title: "Discussion" },
      blocks: [
        { id: "aaaaaa01", type: "bullet", text: "ACP fits ag best", ...src },
        { id: "aaaaaa02", type: "bullet", text: "AG-UI less so", ...src },
        { id: "aaaaaa03", type: "todo", text: "Call Ana" }, // only told to write it: names no one
      ],
    },
  ]);
  await panel.locator(".pg-row", { hasText: "Discussion" }).first().click();

  const line = (id: string) => panel.locator(`#blocks > .blk[data-id=${id}]`);
  const [first, second] = [line("aaaaaa01"), line("aaaaaa02")];
  await expect(second).toContainText("AG-UI less so");
  await expect(first.locator(".sent")).toHaveCount(0); // written together: shown once, at the last of them
  await expect(line("aaaaaa03").locator(".sent")).toHaveCount(0);
  const chip = second.locator(".sent .chip");
  await expect(chip).toHaveAttribute(
    "aria-label",
    new RegExp(`^Written by ${CLAUDE} from your conversation · .+ \\(2 lines\\)$`),
  );
  await expect(chip.locator("img.face")).toHaveCount(1); // its avatar, no status word: not a line sent to it
  await expect(chip).toHaveText("");
  await expect(second.locator(".sent .talk")).toHaveCount(0); // nothing said about them yet
  await expect(second).not.toHaveClass(/is-sent/);

  // its avatar opens the conversation about them beside the page: who wrote them, when, and the lines as written
  await chip.click();
  const convo = panel.locator("#convo");
  await expect(convo).toBeVisible();
  await expect(first).toHaveClass(/convo-on/);
  await expect(convo.locator(".cv-who")).toContainText(CLAUDE);
  await expect(convo.locator(".cv-who .pill")).toHaveText("Wrote this");
  await expect(convo.locator(".cv-src")).toContainText(`Written from your conversation with ${CLAUDE} · `);
  await expect(convo.locator(".cv-chat")).toHaveText("Open its Chat");
  const wrote = convo.locator(".msg").first();
  await expect(wrote).not.toHaveClass(/you/);
  await expect(wrote.locator(".bub")).toContainText("ACP fits ag best");
  await expect(wrote.locator(".bub")).toContainText("AG-UI less so");
  await expect(wrote.locator(".mm")).toContainText(`${CLAUDE} wrote · `);

  // a follow-up: to that actor, as the user's message -- the lines named, then the lines, then what the user asks
  const box = convo.locator(".reply input");
  await expect(box).toBeFocused();
  await expect(box).toHaveAttribute("placeholder", `Follow up with ${CLAUDE}`);
  await box.fill("Why less so?");
  await box.press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ gatherer: GATHERER, channel: ACTOR });
  expect(String(sent[0].text)).toMatch(
    new RegExp(
      '^\\(A reply in my Notes, page "Discussion", blocks aaaaaa01, aaaaaa02: about lines you wrote there on [^)]+, ' +
        "from our conversation\\. Answer as always, then put one to three lines beside them with notes_report, one report, on block aaaaaa02\\.\\)" +
        "\\n\\n- ACP fits ag best\\n- AG-UI less so\\n\\nWhy less so\\?$",
    ),
  );
  await expect(convo.locator(".msg.you .bub")).toHaveText(["Why less so?"]);
  await expect(second.locator(".sent .talk")).toHaveText("1");
  await expect(second).not.toHaveClass(/is-sent/); // a follow-up doesn't make them lines sent to it

  // its reply (notes_report: a line of the thread, by it), beside the lines
  const said = await threadOf(panel, "aaaaaa02");
  await asActor(panel, [
    {
      op: "block.put",
      page: "discpage01",
      block: {
        id: "aaaaaa02",
        thread: [...said, { id: "line0002", by: `agent:${ACTOR}`, text: "It needs a web front end." }],
      },
    },
  ]);
  const reply = convo.locator(".msg:not(.you)").last();
  await expect(reply.locator(".bub")).toHaveText("It needs a web front end.");
  await expect(reply.locator(".mm")).toContainText(`${CLAUDE} replied on “AG-UI less so” · `); // which of them
  await expect(second.locator(".sent .talk")).toHaveText("2");

  // what an agent reads: who wrote them, and what was said about them -- not lines sent to anyone
  const read = (await call(page, instance, "read", { page: "Discussion" })).text;
  expect(read).toContain(`- [aaaaaa01], [aaaaaa02] by actor ${ACTOR}, `);
  expect(read).toContain("    the user: Why less so?\n");
  expect(read).toContain(`    actor ${ACTOR}: It needs a web front end.`);
  expect(read).not.toContain("sent to no one");

  // the user's own edit keeps who wrote it
  await first.locator(".tx").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" today");
  await expect
    .poll(async () => (await call(page, instance, "read", { page: "Discussion" })).text)
    .toContain("ACP fits ag best today");
  expect((await call(page, instance, "read", { page: "Discussion" })).text).toContain(
    "[aaaaaa01], [aaaaaa02] by actor",
  );
  await expect(second.locator(".sent .chip")).toHaveAttribute("aria-label", /\(2 lines\)$/);
});
