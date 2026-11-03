// The Chat view's turns as the page draws them: which turns, folded or whole, their replies, the actor at work or done
// under the latest, what was opened or waits since -- and what stays from draw to draw: its node, the actor's stage, the
// folds a click made.
import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadVendored } from "../../core/ui/testing";
import { useTurns } from "./store";
import { ACTOR, AT, testPage, turn } from "./testing";

const NOW = AT + 3600;
const turns = (n: number) => Array.from({ length: n }, (_, i) => turn(i));
const ids = (node: HTMLElement) => [...node.querySelectorAll(":scope > .fl-turn")].map((t) => t.id);

beforeAll(() => loadVendored());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("Turns", () => {
  it("draws the latest turns, the earlier counted above them, those before the latest two answered folded", () => {
    const { page } = testPage(turns(8));
    const node = page.draw();
    expect(node.className).toBe("fl-talk");
    expect(node.dataset.keep).toBe("files-talk");
    expect(node.dataset.follow).toBe("1");
    expect(node.querySelector(":scope > .fl-earlier")!.textContent).toBe("3 earlier turns · scroll up for more");
    expect(ids(node)).toEqual(["fl-turn-3", "fl-turn-4", "fl-turn-5", "fl-turn-6", "fl-turn-7"]);
    expect([...node.querySelectorAll(":scope > .fl-turn")].map((t) => t.className)).toEqual([
      "fl-turn folded",
      "fl-turn folded",
      "fl-turn folded",
      "fl-turn",
      "fl-turn on",
    ]);
    // an earlier turn's message a button, folding or showing it; the latest's not
    const folded = node.querySelector("#fl-turn-4 .fl-head > .fl-user")!;
    expect(folded.tagName).toBe("BUTTON");
    expect(folded.getAttribute("aria-expanded")).toBe("false");
    expect(folded.getAttribute("title")).toBe("Show this turn's replies. ⌘+click: show this turn's files and commands");
    expect(node.querySelector("#fl-turn-4 .fl-reply")).toBeNull();
    const shown = node.querySelector("#fl-turn-6 .fl-head > .fl-user")!;
    expect(shown.getAttribute("title")).toBe(
      "Fold this turn to your message. ⌘+click: show this turn's files and commands",
    );
    const latest = node.querySelector("#fl-turn-7 .fl-head > .fl-user")!;
    expect(latest.tagName).toBe("DIV");
    expect(latest.getAttribute("title")).toBe("⌘+click: show this turn's files and commands");
    expect(latest.querySelector(".fold-mark")).toBeNull();
    expect(latest.querySelector(".fl-count")!.textContent).toBe("1 message");
    const main = node.querySelector<HTMLDetailsElement>("#fl-m-7-0")!;
    expect(main.open).toBe(true);
    expect(main.querySelector(".md")!.textContent!.trim()).toBe("Answer 7");
    // over: the actor done under it, and short of height, how long it took
    expect(node.querySelector("#fl-turn-7 .fl-finished .fl-times")!.textContent).toBe("took 5s");
    expect(node.querySelector(":scope > .fl-done > .done")!.getAttribute("data-sig")).toBe('["rest","animal/fox",107]');
    expect(node.querySelector(":scope > .fl-done")!.getAttribute("title")).toBe("Done · 10m ago");
  });

  it("keeps its node, and the actor's stage while it shows the same, from draw to draw", () => {
    const { page } = testPage(turns(3));
    const node = page.draw();
    const stage = node.querySelector(".fl-done > .done")!;
    expect(page.draw({ data: { turns: turns(3), turn: 2 } })).toBe(node);
    expect(node.querySelector(".fl-done > .done")).toBe(stage);
    // the stage put its next moment in its place meanwhile: that one is compared, and kept
    const next = stage.cloneNode(true) as HTMLElement;
    stage.replaceWith(next);
    page.draw();
    expect(node.querySelector(".fl-done > .done")).toBe(next);
    // a new turn: another stage
    page.draw({ data: { turns: turns(4), turn: 3 } });
    expect(node.querySelector(".fl-done > .done")).not.toBe(next);
    expect(node.querySelectorAll(".fl-done").length).toBe(1);
  });

  it("shows an earlier turn's replies on a click on its message, kept as turns come; the setting picked again starts over", () => {
    const { page, host } = testPage(turns(5));
    const node = page.draw();
    const message = () => node.querySelector<HTMLElement>("#fl-turn-1 .fl-head > .fl-user")!;
    act(() => message().click());
    expect(host.calls).toContainEqual(["redraw"]);
    expect(node.querySelector("#fl-turn-1")!.className).toBe("fl-turn shown");
    expect(message().getAttribute("aria-expanded")).toBe("true");
    expect(node.querySelector("#fl-m-1-0")).not.toBeNull();
    page.draw({ data: { turns: turns(6), turn: 5 } });
    expect(node.querySelector("#fl-turn-1")!.className).toBe("fl-turn shown");
    useTurns.getState().clearFlips();
    page.draw();
    expect(node.querySelector("#fl-turn-1")!.className).toBe("fl-turn folded");
    // under "Whole", every turn shown; a click folds one
    page.draw({ earlierTurns: "whole" });
    expect(node.querySelector("#fl-turn-1")!.className).toBe("fl-turn");
    act(() => message().click());
    expect(node.querySelector("#fl-turn-1")!.className).toBe("fl-turn folded");
  });

  it("shows a turn's earlier messages behind its +, and folds them again by its −", () => {
    const replies = [0, 1, 2, 3].map((i) => ({ kind: "text", text: `on the way ${i}` }));
    const { page } = testPage([turn(0, { replies: [...replies, { kind: "text", text: "Done." }] })]);
    const node = page.draw();
    const more = () => node.querySelector<HTMLButtonElement>("#fl-turn-0 .fl-more")!;
    expect(more().textContent).toBe("+2 earlier messages");
    expect(more().getAttribute("aria-expanded")).toBe("false");
    expect([...node.querySelectorAll("#fl-turn-0 .fl-minor > details")].map((d) => d.id)).toEqual([
      "fl-r-0-2",
      "fl-r-0-3",
    ]);
    act(() => more().click());
    expect(more().textContent).toBe("−2 earlier messages");
    expect(more().getAttribute("title")).toBe("Fold the earlier messages again");
    expect(node.querySelectorAll("#fl-turn-0 .fl-minor > details").length).toBe(4);
    act(() => more().click());
    expect(node.querySelectorAll("#fl-turn-0 .fl-minor > details").length).toBe(2);
  });

  it("keeps the latest reply folded by a click across draws; another files feed starts the folds over", () => {
    const { page } = testPage(turns(2));
    const node = page.draw();
    const main = () => node.querySelector<HTMLDetailsElement>("#fl-m-1-0")!;
    act(() => {
      main().open = false;
      fireEvent(main(), new Event("toggle"));
    });
    expect(useTurns.getState().closed.has("fl-m-1-0")).toBe(true);
    page.draw({ data: { turns: turns(2), turn: 1 } });
    expect(main().open).toBe(false);
    expect(main().hasAttribute("open")).toBe(false);
    page.draw({ files: {} });
    expect(main().open).toBe(true);
  });

  it("draws what a turn's agent thought, its notes, and its latest call while nothing followed it", () => {
    const t = turn(0, {
      replies: [
        { kind: "thinking", texts: ["**Plan**: read the file", "then answer"] },
        { kind: "thinking", texts: [] },
        { kind: "report", text: "It's 42.", name: "counter" },
        { kind: "peer", text: "Hello from there\nmore", name: "Bob" },
      ],
      last: { id: "c1", text: "ls -la", running: false, error: true, output: "denied" },
    });
    const { page } = testPage([t]);
    const node = page.draw();
    const thought = node.querySelector("#fl-r-0-0")!;
    expect(thought.className).toBe("fl-reply thought");
    expect(thought.querySelector(".lbl")!.textContent).toBe("Thought:");
    expect(thought.querySelector(".first")!.textContent).toBe("Plan: read the file");
    expect(node.querySelector("#fl-r-0-1")).toBeNull(); // encrypted: nothing to read
    const report = node.querySelector("#fl-r-0-2")!;
    expect(report.className).toBe("fl-reply noted report");
    expect(report.querySelector(".lbl")!.textContent).toBe("Subagent's report:");
    expect(report.querySelector(".first")!.textContent).toBe("counter");
    const peer = node.querySelector("#fl-r-0-3")!;
    expect(peer.querySelector(".lbl")!.textContent).toBe("Message from Bob:");
    expect(peer.querySelector(".first")!.textContent).toBe("Hello from there");
    const call = node.querySelector("#fl-c-0-c1")!;
    expect(call.querySelector("summary")!.textContent).toBe("●Failed:ls -la");
    expect(call.querySelector(".dot")!.className).toBe("dot err");
    expect(call.querySelector(".cv.err pre.out")!.textContent).toBe("denied");
    expect(node.querySelector(".fl-count")!.getAttribute("title")).toBe("3 messages from the agent, 0 commands");
  });

  it("says how the latest call is: running, waiting for the user, stopped, or ran", () => {
    const words = (over: Parameters<typeof testPage>[1], running: boolean) => {
      const { page } = testPage([turn(0, { replies: [], last: { id: "x", text: "sleep 9", running } })], over);
      return page.draw().querySelector("#fl-c-0-x summary .lbl")!.textContent;
    };
    expect(words({ running: true, status: "running" }, true)).toBe("Running:");
    expect(words({ status: "asking" }, true)).toBe("Waiting for you:");
    expect(words({}, true)).toBe("Stopped:");
    expect(words({}, false)).toBe("Ran:");
  });

  it("draws the actor at work under a running turn: the line under it, its stage below", () => {
    const at = turn(1, { at: NOW - 125, work: { doing: "read" } });
    const { page } = testPage([turn(0), at], {
      running: true,
      status: "running",
      info: { ...ACTOR, last: NOW - 3 },
      canInterrupt: true,
    });
    const node = page.draw();
    const line = node.querySelector("#fl-turn-1 .fl-working")!;
    expect(line.querySelector(".fl-times")!.textContent).toBe(
      "last activity 3s ago · 2m 05s so far · esc to interrupt",
    );
    expect(line.querySelector("[data-ago]")!.getAttribute("data-ago")).toBe(String(NOW - 3));
    expect(line.querySelector(".now")!.textContent).toBe("Working…");
    expect(line.querySelector(".fl-mini img")!.getAttribute("src")).toBe("/avatars/animal/fox.svg?bare=1");
    const status = node.querySelector(":scope > .fl-status")!;
    expect([...status.children].map((c) => c.className)).toEqual(["stage-box", "now"]);
    expect(status.firstElementChild!.getAttribute("data-sig")).toBe('["work","animal/fox",{"doing":"read"}]');
    expect(node.querySelector(".fl-done")).toBeNull();
    expect(node.querySelector("#fl-turn-1 .fl-finished")).toBeNull();
    // thinking; its calls failing; Esc sent
    page.draw({ data: { turns: [turn(0), { ...at, now: { kind: "thinking" } }], turn: 1 } });
    expect(status.querySelector(".now")!.textContent).toBe("Thinking…");
    page.draw({ info: { ...ACTOR, failing: { at: NOW - 7 } } });
    expect(node.querySelector("#fl-turn-1 .fl-times")!.textContent).toMatch(/^last try 7s ago/);
    expect(status.querySelector(".now")!.textContent).toBe("Retrying…");
    page.draw({ interrupting: true });
    expect(status.querySelector(".now")!.textContent).toBe("Interrupting…");
  });

  it("ends the Esc sent once the latest turn no longer works", () => {
    const { page, host } = testPage(turns(2), { running: true, status: "running", interrupting: true });
    page.draw();
    expect(host.calls).not.toContainEqual(["interruptOver"]);
    page.draw({ running: false, status: "idle" });
    expect(host.calls).toContainEqual(["interruptOver"]);
  });

  it("draws a turn the session opened before ag stored it, at work; the turn stored counts from when it was sent", () => {
    const typed = [{ text: "And now?", sent: NOW - 30, at: NOW - 31 }];
    const { page } = testPage(turns(2), { running: true, status: "running", heard: { stored: [], typed, queued: [] } });
    const node = page.draw();
    const opened = node.querySelector(":scope > .fl-turn.opened")!;
    expect(opened.querySelector(".fl-user")!.getAttribute("title")).toBe(
      "Sent to the agent: shown here until the gatherer has stored it",
    );
    expect(opened.querySelector(".fl-times")!.textContent).toBe("last activity 30s ago · 30s so far");
    expect(node.lastElementChild!.className).toBe("fl-status");
    expect(node.querySelector("#fl-turn-1 .fl-working, .fl-done")).toBeNull(); // the latest stored: not at work
    // stored, at a later time: still from when it was sent
    page.draw({
      data: { turns: [...turns(2), turn(2, { text: "And now?", at: NOW - 10 })], turn: 2 },
      heard: { stored: [], typed: [], queued: [] },
    });
    expect(node.querySelector("#fl-turn-2 .fl-times")!.textContent).toBe("last activity 30s ago · 30s so far");
  });

  it("draws what waits to reach the agent at the latest turn's end; not seen for long, the way to its terminal", () => {
    const { page, host } = testPage(turns(1), {
      info: { ...ACTOR, session: { status: "terminal", terminal: { cols: 80 } } },
      heard: { stored: [], typed: [{ text: "queued one", sent: null }], queued: ["in its queue"] },
      mine: [{ text: "sent here", at: NOW * 1000 - 1000 }],
    });
    const node = page.draw();
    const pending = node.querySelector("#fl-turn-0 > .fl-pending")!;
    expect([...pending.querySelectorAll(".fl-user .tx")].map((t) => t.textContent)).toEqual([
      "queued one",
      "in its queue",
      "sent here",
    ]);
    expect(pending.querySelector(".lbl")!.textContent).toBe("Pending");
    page.draw({ mine: [{ text: "sent here", at: NOW * 1000 - 20000 }] });
    expect(pending.querySelector(".lbl")!.textContent).toBe(
      "Pending · not seen by the session yet; its terminal may be asking something first. Open the terminal",
    );
    act(() => pending.querySelector<HTMLButtonElement>(".to-term")!.click());
    expect(host.calls).toContainEqual(["setChatView", "terminal"]);
  });

  it("stacks what was written mid-turn on the turn's message", () => {
    const t = turn(0, { more: [{ text: "Also this.", kind: "mid_turn" }] });
    const { page } = testPage([t, turn(1)], {
      heard: { stored: [], typed: [{ text: "And that.", sent: NOW, joins: true }], queued: [] },
    });
    const node = page.draw();
    const joined = node.querySelector("#fl-turn-0 > .fl-user.joined")!;
    expect(joined.tagName).toBe("BUTTON");
    expect(joined.getAttribute("title")).toBe(
      "Written while it worked, and given to the agent in this turn. Fold this turn to your message. ⌘+click: show this turn's files and commands",
    );
    expect(node.querySelector("#fl-turn-1 > .fl-user.joined")!.textContent).toBe("And that.");
  });

  it("shows a turn's files and commands by its button: the side unfolded, the turn picked", async () => {
    const { page, host } = testPage(turns(3));
    const node = page.draw();
    await act(async () => node.querySelector<HTMLElement>("#fl-turn-0 .fl-side-btn")!.click());
    expect(host.calls).toContainEqual(["foldSide", false, false]);
    expect(host.calls).toContainEqual(["setFilesTurn", 0]);
    // the latest, its files shown: folded again
    page.draw({ sideFolded: false });
    const btn = node.querySelector<HTMLElement>("#fl-turn-2 .fl-side-btn")!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.getAttribute("title")).toBe("Fold this turn's files and commands");
    await act(async () => btn.click());
    expect(host.calls).toContainEqual(["foldSide", true]);
  });

  it("says how a turn stopped short, unless the actor's error note says it", () => {
    const stopped = { kind: "error", text: "overloaded" };
    const { page } = testPage([turn(0, { stopped: { kind: "interrupted" } }), turn(1, { stopped })], {
      home: {
        home: "/h",
        now: AT,
        gatherers: [],
        harness_info: { h1: { stopped: { lead: "■", interrupted: "Stopped by you", error: "Error" } } },
      },
      earlierTurns: "whole",
    });
    const node = page.draw();
    expect(node.querySelector("#fl-turn-0 .fl-stopped")!.textContent).toBe("■Stopped by you");
    expect(node.querySelector("#fl-turn-1 .fl-stopped.error")!.textContent).toBe("■overloaded");
    page.draw({ info: { ...ACTOR, status: "error" } });
    expect(node.querySelector("#fl-turn-1 .fl-stopped")).toBeNull();
  });
});

describe("before the first turn", () => {
  it("draws the actor waving hello and saying its line", () => {
    const { page } = testPage([]);
    const node = page.draw();
    expect(node.className).toBe("fl-talk hi");
    expect(node.dataset.keep).toBeUndefined();
    const hello = node.querySelector(":scope > .fl-hello")!;
    expect(hello.firstElementChild!.getAttribute("data-sig")).toBe('["hello","animal/fox"]');
    expect(hello.querySelector(".fl-say.verse")!.innerHTML).toBe("Hi, I'm Fox.<br>Ready when you are.");
    page.draw({ session: { status: "starting" } });
    expect(hello.lastElementChild!.outerHTML).toBe("<div>Starting the agent…</div>");
    page.draw({ session: { status: "terminal" }, writable: false });
    expect(hello.lastElementChild!.textContent).toBe("No messages yet.");
    page.draw({ writable: true, info: { ...ACTOR, avatar: null } });
    expect(hello.innerHTML).toBe("<div>No messages yet. Write one below.</div>");
  });

  it("draws the first message waiting to reach the agent above the actor, and the turn it opens", () => {
    const { page } = testPage([], { mine: [{ text: "Hello there", at: NOW * 1000 }] });
    const node = page.draw();
    expect(node.querySelector(":scope > .fl-turn > .fl-pending .tx")!.textContent).toBe("Hello there");
    expect(node.querySelector(".fl-hello")!.children.length).toBe(1); // the actor, no line
    page.draw({ mine: [], heard: { stored: [], typed: [{ text: "Hello there", sent: NOW }], queued: [] } });
    expect(node.className).toBe("fl-talk");
    expect(node.querySelector(".fl-hello")).toBeNull();
    expect(node.querySelector(":scope > .fl-turn.opened .tx")!.textContent).toBe("Hello there");
    expect(node.lastElementChild!.className).toBe("fl-status");
  });
});
