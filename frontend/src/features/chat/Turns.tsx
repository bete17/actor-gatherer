// The conversation, at the right of the Chat view: each of the user's messages a turn, and under it the agent's (Turn).
// The latest turns drawn, the earlier a few more at a time as the reader scrolls up past the top (pull.ts). The turns
// before the latest folded as the setting "Chat's earlier turns" has them -- all but the latest two the agent answered in
// (a message, a thought or a call), and any after them it has yet to answer: the one before those two folds once a newer
// turn has its first answer; never by the actor's status, nor by a message sent and not yet stored, so a turn is not
// folded and shown again as the next starts. Then the turns the session has opened that ag has not stored yet.
import { useEffect, useLayoutEffect } from "react";
import { plural } from "../../core/format";
import { useChat } from "./context";
import { OpenedTurn, opening, waiting } from "./Pending";
import { drawn } from "./pull";
import { atWork, turnsBegan, useTurns } from "./store";
import { Turn, type TurnPlace } from "./Turn";
import type { Turn as TurnData } from "./types";

const DONE = ["idle", "finished", "closed"];
/** A turn drawn at work is drawn so this long after its status stops saying it works, while the status catches up:
 * the turn stored from a message sent a moment ago, the actor not yet heard to run; a turn that ends and goes on at once
 * with the message held for its end, or opens the next with it -- not "Done" for a blink between. Counted from when the
 * page first draws it no longer at work, and only for an actor active just before (FRESH_MS: not one come back to, its
 * turn over long since). An Esc from here, or the turn stopped: at once. */
export const HOLD_MS = 600;
const FRESH_MS = 3000;

/** The turn `n` (an opening: the place it will take) drawn at work now, for the actor `key`. */
function sawAtWork(key: string, n: number): void {
  atWork.set(key, { n, stopped: null });
}

/** How much longer the latest turn, `n`, is held at work, for the actor `key` last active at `active` (seconds): ms, 0
 * for none -- the turn at work a moment ago, or one after it; not one before it (the message that opened it taken
 * back). The first draw no longer at work starts the hold. */
function heldFor(key: string, n: number, active: number, now = Date.now()): number {
  const w = atWork.get(key);
  if (!w || n < w.n || now - active * 1000 > FRESH_MS) return 0;
  if (w.stopped === null) w.stopped = now;
  return Math.max(0, HOLD_MS - (now - w.stopped));
}

export function Turns({ interrupting }: { interrupting: boolean }) {
  const { feed, host, folds } = useChat();
  const d = feed.data,
    last = d.turns.length - 1,
    info = feed.info;
  const opens = opening(feed, host); // the turns opening: the session's, and what was just sent to open one
  // a message on its way to the agent (sent from here, queued in its session): the turn it opens begins, so the
  // latest is not shown done meanwhile -- until the page hears the actor runs, the status still says idle
  const coming = waiting(feed, host) !== null;
  const words = (text: string) => host.typedAs(text).slice(0, 200);
  const latest: TurnData | undefined = d.turns[last];
  const runs = feed.running && !opens.length; // the latest stored turn at work, as its status says
  const working = opens.length ? last + opens.length : runs && latest ? last : null; // the turn at work, by its place
  if (working !== null) sawAtWork(feed.key, working);
  if (feed.interrupting || interrupting) atWork.delete(feed.key); // stopped from here: drawn as its status says, at once
  // the latest, or the turn before it, at work a moment ago -- its status not saying so yet (HOLD_MS)
  const active = Math.max(info.last || 0, (latest && latest.at) || 0);
  const hold =
    working === null && latest && !latest.stopped && feed.status !== "asking" ? heldFor(feed.key, last, active) : 0;
  useEffect(() => {
    if (!hold) return;
    const t = setTimeout(() => host.redraw(), hold + 20); // the hold over: drawn as its status says
    return () => clearTimeout(t);
  });
  const first = folds.first ?? 0;
  const answered = d.turns.filter((t) => (t.replies || []).length || t.calls).map((t) => t.n);
  const foldsAt = answered.length < 2 ? 0 : answered[answered.length - 2]; // the turns before this one fold
  const placeOf = (t: TurnData): TurnPlace => {
    const live = t.n === last && (runs || hold > 0);
    return {
      live,
      done: !live && t.n === last && !opens.length && !coming && DONE.includes(feed.status),
      folds: foldsAt,
      opened: opens.length > 0,
      began: live ? turnsBegan.get(feed.key + "\u0000" + words(t.text)) : undefined,
      // a call under way is drawn above, as the turn's latest call: the line under it only says the agent works
      now: !live
        ? ""
        : interrupting
          ? "Interrupting…"
          : info.failing
            ? "Retrying…"
            : t.now && t.now.kind === "thinking"
              ? "Thinking…"
              : "Working…",
    };
  };
  // the turn shown brought into view, once each time one is shown: the latest at its end, one picked at its top
  useLayoutEffect(() => {
    const at = `${feed.key}:${d.turn}`;
    if (useTurns.getState().shown === at) return;
    requestAnimationFrame(() => {
      if (useTurns.getState().shown === at) return; // already (keepTurn: kept where the reader had it)
      const cur = document.querySelector<HTMLElement>(".fl-talk .fl-turn.on");
      if (!cur || !cur.parentElement) return;
      useTurns.getState().setShown(at);
      const talk = cur.parentElement; // .fl-talk: its offset parent
      talk.scrollTop = (drawn.feed ?? feed).picked === null ? talk.scrollHeight : cur.offsetTop;
    });
  });
  return (
    <>
      {first ? <div className="fl-earlier">{`${plural(first, "earlier turn")} · scroll up for more`}</div> : null}
      {d.turns.slice(first).map((t) => (
        <Turn key={t.n} t={t} place={placeOf(t)} />
      ))}
      {opens.map((q, i) => (
        <OpenedTurn key={`opened-${i}`} q={q} latest={i === opens.length - 1} interrupting={interrupting} />
      ))}
    </>
  );
}
