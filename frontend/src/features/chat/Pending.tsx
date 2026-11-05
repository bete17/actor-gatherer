// What the user wrote that the turns do not hold yet, as the server's view has it (view.ts): what waits for the agent's
// next step, at the latest turn's end, faded and marked pending; and the turn a message opened that is not stored yet,
// drawn in full the moment it is sent -- the actor at work under it, or, the session not having had it for long, the way
// to its terminal.
import { useChat } from "./context";
import { Bubble } from "./Bubble";
import { waitsOf } from "./view";
import { Status, Working } from "./Working";
import type { ChatFeed, Opening } from "./types";

export interface Waiting {
  texts: string[];
}

/** What waits for the agent's next step (view.ts's waitsOf): null for nothing. */
export function waiting(feed: ChatFeed): Waiting | null {
  const texts = waitsOf(feed).map((w) => w.text);
  return texts.length ? { texts } : null;
}

export function Pending({ w }: { w: Waiting }) {
  return (
    <div className="fl-pending">
      {w.texts.map((text, i) => (
        <Bubble key={i} text={text} title="Written while it works: given to the agent at its next step" />
      ))}
      <span className="lbl">Pending</span>
    </div>
  );
}

/** The turn a message opened, not stored yet (view.ts's openingOf): its message in full, as the terminal shows it; the
 * actor at work under it, from when it was sent -- or, the session not having had it for long (`unseen`), that, and the
 * way to its terminal, which may be asking something first; what waits after it. Replaced by the stored turn, which
 * counts from the same moment. */
export function OpenedTurn({ o, interrupting }: { o: Opening; interrupting: boolean }) {
  const { feed, host } = useChat();
  const now = interrupting ? "Interrupting…" : "Working…";
  const w = waiting(feed);
  const asks = !!o.unseen && !!feed.info.session?.terminal && feed.terminalView;
  return (
    <>
      <div className="fl-turn opened">
        <Bubble text={o.text} title="Sent to the agent: shown here until the gatherer has stored it" />
        {o.unseen ? (
          <div className="fl-pending">
            <span className="lbl">
              Not seen by the session yet
              {asks ? "; its terminal may be asking something first. " : null}
              {asks ? (
                <button type="button" className="to-term" onClick={() => host.setChatView("terminal")}>
                  Open the terminal
                </button>
              ) : null}
            </span>
          </div>
        ) : (
          <Working last={Math.max(o.began, feed.info.last || 0)} at={o.began} now={now} />
        )}
        {w ? <Pending w={w} /> : null}
      </div>
      {o.unseen ? null : <Status work={{}} now={now} />}
    </>
  );
}
