// What the user wrote that the turns ag stored do not hold yet: what waits to reach the agent, at the latest turn's end,
// faded and marked pending; and a message that opened a turn ag has not stored yet, that turn's, in full, the moment the
// session has it -- the actor at work under it.
import { useChat } from "./context";
import { Bubble } from "./Bubble";
import { Status, Working } from "./Working";
import type { ChatFeed, ChatHost, Heard, Typed } from "./types";

/** A message sent from here and not seen for this long says so (the old page's UNSEEN_MS, 16-files-view.js). */
const UNSEEN_MS = 15000;

/** The turns the session has started and ag has not stored yet, each by its first message as the session recorded it
 * when it went to the model (the agent's `typed`, data.py's: sent, not as part of the turn it was written in). */
export const openings = (h: Heard): Typed[] => h.typed.filter((q) => q.sent !== null && !q.joins);

/** What was written while it worked and sent as part of its turn, not yet stored by ag: stacked on the turn's message. */
export const joinedOf = (h: Heard): Typed[] => h.typed.filter((q) => q.sent !== null && q.joins);

export interface Waiting {
  texts: string[];
  /** sent from here and not seen by the session for long */
  unseen: boolean;
  /** ...with its terminal open: it may be asking something there first (whether to trust the folder, on a new actor's
   * first message), and the Terminal view the way to it */
  asks: boolean;
}

/** What waits to reach the agent: sent from here and not seen yet; in the session's queue; in the dashboard agent's
 * queue; sent from Chat elsewhere (or before a reload) and not had yet (its `chat_sent`). Null: nothing. */
export function waiting(feed: ChatFeed, host: ChatHost, now = Date.now()): Waiting | null {
  const h = feed.heard,
    mine = feed.mine;
  const texts = [
    ...h.typed.filter((q) => q.sent === null && !q.chat).map((q) => q.text),
    ...h.queued,
    ...mine.map((m) => m.text),
  ];
  const chats = h.typed.filter((q) => q.chat && q.sent === null && !texts.some((t) => host.sameWords(t, q.text)));
  texts.push(...chats.map((q) => q.text));
  if (!texts.length) return null;
  const unseen = mine.some((m) => now - m.at > UNSEEN_MS) || chats.some((q) => now - Number(q.at) * 1000 > UNSEEN_MS);
  return { texts, unseen, asks: unseen && !!feed.info.session?.terminal && feed.terminalView };
}

export function Pending({ w }: { w: Waiting }) {
  const { host } = useChat();
  return (
    <div className="fl-pending">
      {w.texts.map((text, i) => (
        <Bubble key={i} text={text} title="Written while it works: given to the agent at its next step" />
      ))}
      <span className="lbl">
        {w.unseen ? "Pending · not seen by the session yet" : "Pending"}
        {w.asks ? "; its terminal may be asking something first. " : null}
        {w.asks ? (
          <button type="button" className="to-term" onClick={() => host.setChatView("terminal")}>
            Open the terminal
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** A turn the session has started that ag has not stored yet: its first message, sent -- in full, as the terminal shows
 * it -- and, the latest, the actor at work under it and what waits to reach it. Drawn from what ag stores once it has. */
export function OpenedTurn({ q, latest, interrupting }: { q: Typed; latest: boolean; interrupting: boolean }) {
  const { feed, host } = useChat();
  const now = interrupting ? "Interrupting…" : "Working…";
  const w = latest ? waiting(feed, host) : null;
  return (
    <>
      <div className="fl-turn opened">
        <Bubble text={q.text} title="Sent to the agent: shown here until the gatherer has stored it" />
        {latest ? <Working last={Math.max(q.sent!, feed.info.last || 0)} at={q.sent} now={now} /> : null}
        {w ? <Pending w={w} /> : null}
      </div>
      {latest ? <Status work={{}} now={now} /> : null}
    </>
  );
}
