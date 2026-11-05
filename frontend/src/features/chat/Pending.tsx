// What the user wrote that the turns ag stored do not hold yet: what waits to reach the agent, at the latest turn's end,
// faded and marked pending -- only while the actor is at a turn, the message waiting for its next step; and a message
// that opens a turn ag has not stored yet, that turn's, in full, the moment it is sent -- the actor at work under it.
import { useState, type CSSProperties } from "react";
import { useChat } from "./context";
import { Bubble } from "./Bubble";
import { StrokeIcon } from "../../core/ui/Icon";
import { turnsSeen } from "./store";
import { Status, Working } from "./Working";
import type { ChatFeed, ChatHost, Heard, Typed } from "./types";

/** A message sent from here and not seen for this long says so (the old page's UNSEEN_MS, 16-files-view.js). */
const UNSEEN_MS = 15000;
/** The server's record of a message sent from Chat (`chat_sent`) and one this page sent are the same send this close. */
const SAME_SEND_MS = 5000;
/** A turn that opens grows in (fl-in, 11-files-view.css) this long; the stored turn after it goes on from where it is. */
export const GROW_MS = 320;

/** The turns the session has started and ag has not stored yet, each by its first message as the session recorded it
 * when it went to the model (the agent's `typed`, data.py's: sent, not as part of the turn it was written in). */
export const openings = (h: Heard): Typed[] => h.typed.filter((q) => q.sent !== null && !q.joins);

/** What was written while it worked and sent as part of its turn, not yet stored by ag: stacked on the turn's message. */
export const joinedOf = (h: Heard): Typed[] => h.typed.filter((q) => q.sent !== null && q.joins);

/** Whether the actor is at a turn: a message sent now waits for its next step (pending), opening no turn of its own. */
export const atTurn = (feed: ChatFeed): boolean => feed.running || feed.status === "asking";

/** Whether a message the server lists as sent from Chat and not had (`chat`) is one this page sent: not had yet, or
 * had since (`had`) -- drawn as this page has it, not again. */
function sentHere(feed: ChatFeed, host: ChatHost, q: Typed): boolean {
  return [...feed.mine, ...(feed.had ?? [])].some(
    (m) => host.sameWords(m.text, q.text) && Math.abs(Number(q.at) * 1000 - m.at) < SAME_SEND_MS,
  );
}

/** Messages sent from Chat elsewhere (or before a reload) and not had yet, the actor at no turn: each opens one. */
function chatOpenings(feed: ChatFeed, host: ChatHost): Typed[] {
  if (atTurn(feed)) return [];
  return feed.heard.typed.filter((q) => q.chat && q.sent === null && !sentHere(feed, host, q));
}

/** The turns opening that ag has not stored yet, oldest first: those the session recorded (`openings`); before it has,
 * a message sent from here while the actor was at no turn (`SentHere.opens`) -- from the moment it was sent -- and one
 * sent from Chat elsewhere, the actor at no turn now. The session's record of a send from here is that send's turn:
 * counted from when it was sent. */
export function opening(feed: ChatFeed, host: ChatHost): Typed[] {
  const theirs = openings(feed.heard);
  const same = (q: Typed, m: { text: string; at: number }) =>
    host.sameWords(q.text, m.text) && Math.abs(Number(q.sent) * 1000 - m.at) < SAME_SEND_MS;
  const sent = feed.mine.filter((m) => m.opens);
  const out: Typed[] = theirs.map((q) => {
    const m = sent.find((s) => same(q, s));
    return m ? { ...q, sent: Math.min(q.sent!, m.at / 1000) } : q;
  });
  for (const m of sent)
    if (!theirs.some((q) => same(q, m))) out.push({ text: m.text, at: m.at / 1000, sent: m.at / 1000, ours: true });
  for (const q of chatOpenings(feed, host)) out.push({ ...q, sent: Number(q.at), ours: true });
  return out.sort((a, b) => Number(a.sent) - Number(b.sent));
}

export interface Waiting {
  texts: string[];
  /** sent from here and not seen by the session for long */
  unseen: boolean;
  /** ...with its terminal open: it may be asking something there first (whether to trust the folder, on a new actor's
   * first message), and the Terminal view the way to it */
  asks: boolean;
}

/** What waits to reach the agent's next step: sent from here while it was at a turn and not seen yet; in the session's
 * queue; in the dashboard agent's queue; sent from Chat elsewhere (or before a reload) and not had yet (its `chat_sent`),
 * the actor at a turn. Not what opens a turn (`opening`), nor a send of this page's twice (`sentHere`). Null: nothing. */
export function waiting(feed: ChatFeed, host: ChatHost, now = Date.now()): Waiting | null {
  const h = feed.heard,
    mine = feed.mine.filter((m) => !m.opens);
  const texts = [
    ...h.typed.filter((q) => q.sent === null && !q.chat).map((q) => q.text),
    ...h.queued,
    ...mine.map((m) => m.text),
  ];
  const chats = atTurn(feed)
    ? h.typed.filter(
        (q) => q.chat && q.sent === null && !texts.some((t) => host.sameWords(t, q.text)) && !sentHere(feed, host, q),
      )
    : [];
  texts.push(...chats.map((q) => q.text));
  if (!texts.length) return null;
  const unseen = mine.some((m) => now - m.at > UNSEEN_MS) || chats.some((q) => now - Number(q.at) * 1000 > UNSEEN_MS);
  return { texts, unseen, asks: unseen && !!feed.info.session?.terminal && feed.terminalView };
}

export function Pending({ w }: { w: Waiting }) {
  return (
    <div className="fl-pending">
      {w.texts.map((text, i) => (
        <Bubble key={i} text={text} title="Written while it works: given to the agent at its next step" />
      ))}
      <span className="lbl">
        {w.unseen ? "Pending · not seen by the session yet" : "Pending"}
        <ToTerminal asks={w.asks} />
      </span>
    </div>
  );
}

/** The way to the session's terminal, where it may be asking something before it takes a message (whether to trust
 * the folder, on a new actor's first message). */
function ToTerminal({ asks }: { asks: boolean }) {
  const { host } = useChat();
  if (!asks) return null;
  return (
    <>
      {"; its terminal may be asking something first. "}
      <button type="button" className="to-term" onClick={() => host.setChatView("terminal")}>
        Open the terminal
      </button>
    </>
  );
}

/** The key a turn opening is known by on this page, from its first draw on: the actor and its message's words. */
export const seenKey = (feed: ChatFeed, host: ChatHost, text: string) =>
  feed.key + "\u0000" + host.typedAs(text).slice(0, 200);

/** A turn opening first drawn now (by `seenKey`): from now on it grows in. A turn with the same words long before is
 * another. */
export function seeing(key: string, now = Date.now()): void {
  const seen = turnsSeen.get(key);
  if (seen !== undefined && now - seen <= 60000) return;
  if (turnsSeen.size > 50) turnsSeen.clear();
  turnsSeen.set(key, now);
}

/** How far into growing in (fl-in) a turn is when its box is first drawn: the time since this page first drew the turn
 * opening (`seeing`), as a CSS delay, kept for the box's life -- so the stored turn drawn in the opening's place goes on
 * from there, and a redraw does not move it. Null for a turn grown, or never seen opening. */
export function useGrowing(key: string): CSSProperties | null {
  const [age] = useState(() => growingFor(key));
  return age === null ? null : ({ "--in": `-${Math.round(age)}ms` } as CSSProperties);
}

/** How long ago this page first drew the turn opening `key`, while it still grows in; null after, or never seen. */
function growingFor(key: string, now = Date.now()): number | null {
  const seen = turnsSeen.get(key);
  const age = seen === undefined ? Infinity : now - seen;
  return age < GROW_MS ? age : null;
}

/** A turn opening sent from here or from Chat elsewhere (`ours`) that the session has not seen for long. */
const unseenOpening = (q: Typed, now = Date.now()) => !!q.ours && now - Number(q.sent) * 1000 > UNSEEN_MS;

/** A turn that has opened and ag has not stored yet: its first message -- in full, as the terminal shows it -- drawn as
 * the turn ag stores is, the moment it is sent, so the stored one takes its place unmoved; and, the latest, the actor at
 * work under it, from when it was sent, and what waits to reach it. Sent from here or from Chat elsewhere and not seen
 * by the session for long, it says so, where the actor at work would say what it does. */
export function OpenedTurn({ q, latest, interrupting }: { q: Typed; latest: boolean; interrupting: boolean }) {
  const { feed, host } = useChat();
  const key = seenKey(feed, host, q.text);
  seeing(key);
  const grow = useGrowing(key);
  const unseen = unseenOpening(q);
  const now = interrupting ? "Interrupting…" : unseen ? "Not seen yet" : "Working…";
  const w = latest ? waiting(feed, host) : null;
  const tip = "Its files and commands show once the gatherer has stored the turn";
  return (
    <>
      <div className={"fl-turn opened" + (grow ? " fl-in" : "")} style={grow ?? undefined}>
        <div className="fl-head">
          <Bubble text={q.text} title="Sent to the agent: shown here until the gatherer has stored it" />
          <span className="fl-btns">
            <button type="button" className="fl-side-btn" disabled title={tip} aria-label={tip}>
              <StrokeIcon d={host.icons.sidebar} size={14} />
            </button>
          </span>
        </div>
        {latest ? <Working last={Math.max(q.sent!, feed.info.last || 0)} at={q.sent} now={now} /> : null}
        {latest && unseen ? <NotSeen /> : null}
        {w ? <Pending w={w} /> : null}
      </div>
      {latest ? <Status work={{}} now={now} /> : null}
    </>
  );
}

/** Under a turn opening that the session has not seen for long: so, and the way to its terminal. */
function NotSeen() {
  const { feed } = useChat();
  return (
    <div className="fl-pending">
      <span className="lbl">
        Not seen by the session yet
        <ToTerminal asks={!!feed.info.session?.terminal && feed.terminalView} />
      </span>
    </div>
  );
}
