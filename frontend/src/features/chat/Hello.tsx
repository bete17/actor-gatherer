// Before the actor's first turn is stored: the turns its session has opened since, each in full with the actor at work
// under the latest; or none yet -- the actor waving hello (the host's greeting), saying its line (or that there is none
// yet), under the first message while it waits to reach the agent.
import { Fragment, useRef } from "react";
import { useChat } from "./context";
import { useStage } from "./Hosted";
import { OpenedTurn, openings, Pending, waiting } from "./Pending";

export function FirstTurns({ interrupting }: { interrupting: boolean }) {
  const { feed } = useChat();
  const opens = openings(feed.heard);
  if (!opens.length) return <Hello />;
  return opens.map((q, i) => <OpenedTurn key={i} q={q} latest={i === opens.length - 1} interrupting={interrupting} />);
}

function Hello() {
  const { feed, host } = useChat();
  const { info, session, writable, held } = feed;
  const w = waiting(feed, host);
  // its line (avatar_hello: one of its avatar's in avatars/hello.toml, the same for it always -- avatars.py's), a
  // haiku's lines each on its own
  const says = writable && !held && session.status !== "starting" && info.avatar ? info.avatar_hello : null;
  const parts = says ? String(says).split("\n") : [];
  const box = useRef<HTMLDivElement>(null),
    line = useRef<HTMLDivElement>(null);
  useStage(box, () => host.greeting(info), line);
  return (
    <>
      {w ? (
        <div className="fl-turn">
          <Pending w={w} />
        </div>
      ) : null}
      <div ref={box} className="fl-hello">
        {w ? null : says ? (
          <div ref={line} className={"fl-say" + (parts.length > 1 ? " verse" : "")}>
            {parts.map((part, k) => (
              <Fragment key={k}>
                {k ? <br /> : null}
                {part}
              </Fragment>
            ))}
          </div>
        ) : (
          <div ref={line}>
            {session.status === "starting"
              ? "Starting the agent…"
              : writable && !held
                ? "No messages yet. Write one below."
                : "No messages yet."}
          </div>
        )}
      </div>
    </>
  );
}
