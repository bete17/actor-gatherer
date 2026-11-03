// The conversation, at the right of the Chat view: each of the user's messages a turn, and under it the agent's (Turn).
// The latest turns drawn, the earlier a few more at a time as the reader scrolls up past the top (pull.ts). The turns
// before the latest folded as the setting "Chat's earlier turns" has them -- all but the latest two the agent answered in
// (a message, a thought or a call), and any after them it has yet to answer: the one before those two folds once a newer
// turn has its first answer; never by the actor's status, nor by a message sent and not yet stored, so a turn is not
// folded and shown again as the next starts. Then the turns the session has opened that ag has not stored yet.
import { useLayoutEffect } from "react";
import { plural } from "../../core/format";
import { useChat } from "./context";
import { OpenedTurn, openings } from "./Pending";
import { drawn } from "./pull";
import { turnsBegan, useTurns } from "./store";
import { Turn, type TurnPlace } from "./Turn";
import type { Turn as TurnData } from "./types";

const DONE = ["idle", "finished", "closed"];

export function Turns({ interrupting }: { interrupting: boolean }) {
  const { feed, host, folds } = useChat();
  const d = feed.data,
    last = d.turns.length - 1,
    info = feed.info;
  const opens = openings(feed.heard);
  const first = folds.first ?? 0;
  const answered = d.turns.filter((t) => (t.replies || []).length || t.calls).map((t) => t.n);
  const foldsAt = answered.length < 2 ? 0 : answered[answered.length - 2]; // the turns before this one fold
  const placeOf = (t: TurnData): TurnPlace => {
    const live = feed.running && !opens.length && t.n === last;
    return {
      live,
      done: !live && t.n === last && !opens.length && DONE.includes(feed.status),
      folds: foldsAt,
      opened: opens.length > 0,
      began: live ? turnsBegan.get(feed.key + "\u0000" + host.typedAs(t.text).slice(0, 200)) : undefined,
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
