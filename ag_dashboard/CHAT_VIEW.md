# Chat from one view: plan

Status: planned (2026-11-05), branch `chat-view`. Step 1 (recorded runs, their replay and the checks) is begun.

## Why

Chat works out "what is happening now" on every draw, from three feeds the page refreshes separately and six things
it keeps itself, matched by words and times:

- **The feeds:** the stored turns (`/api/files`, files.py), the actor's status (`/api/home`, data.py's `_status`), and
  what the harness recorded or queued of the user's messages (`/api/agent`'s `typed`, `taken_back`; the session's
  `queued`).
- **What the page keeps:** the messages sent from it and not yet stored (`sentHere`, matched by counting their words),
  those it saw arrive (`hadHere`), an Esc under way (`state.interrupting`), when each turn began, was first drawn and
  was last at work (`turnsBegan`, `turnsSeen`, `atWork`).
- **18 time windows** tie them together: `SAME_SEND_MS`, `UNSEEN_MS`, `HOLD_MS`, `FRESH_MS`, `ESC_GONE_MS`, `HAD_MS`,
  `GROW_MS`, `INTERRUPTING_MS`, `TAKEN_SECONDS`, `CHAT_SECONDS`, `SENT_SECONDS`, `PROMPT_SECONDS`, ...

When two feeds arrive a few hundred milliseconds apart, Chat draws a moment that never happened. The bugs fixed on
2026-11-04/05 were each one such moment: "Pending", then the turn jumping into place; a message drawn twice after
Esc (the restored copy at its old time); "Done" for a blink between a stored turn and its status, or between a turn
and the message held for its end; "Interrupting…" for seconds. Each fix added a window, and the next race showed
after it. The status (data.py) and the turns (files.py) are also two derivations of one lifecycle, from different
reads.

## The design

1. **One view, made on the server.** `chat_view.view(conn, channel, session, now)` reads the gatherer once (and the
   session's row) and returns the conversation as Chat shows it:
   - `turns`: as files.py makes them today, each with `began` (when its message was sent) and `cid` (the send, if
     from Chat);
   - `current`: the latest turn's state -- `opening` (sent, not yet stored), `working` (and what it does: thinking,
     a call, retrying), `asking`, `done`, `stopped` (interrupted, an error, a reason), `idle` (no turn) -- with `since`;
   - `waiting`: what waits for the agent's next step: queued in the session, held for the turn's end, sent from Chat
     and not yet in its record -- each with its `cid` if from Chat;
   - `taken_back`: the message Esc put back, with its `cid`;
   - `version`: the gatherer's newest row and the session's change count; the same version is not sent again.

   The state follows explicit events, in order: a user message stored -> `working`; `asked` -> `asking`; its answer
   -> `working`; a `reply_end` that ends the turn -> `done`, unless the session holds a message for that end (then
   `working`: it goes on with it); a hang-up before any words (499, reached nothing) -> the turn taken back; an
   interrupt or an error given up -> `stopped`. No time decides a state, except "not seen for long" (one window).

2. **Sends carry an id.** The page makes a `cid` per send; `/api/send` takes it and `chat_sent` keeps it. The view
   links a stored user message to the newest unlinked `chat_sent` of the same words before it -- in one place, once,
   by order, with no time window -- and the turn, the waiting message or the taken-back one carries the `cid`.

3. **One push per change.** The view goes to the page over its WebSocket as one message whenever the gatherer or the
   session changes. Turns and state always come from the same moment, so they cannot disagree.

4. **The page draws it.** What the page keeps: only its sends the view does not have yet (by `cid`) -- drawn as the
   turn they open (actor idle) or waiting (actor at a turn) -- dropped once the view has the `cid` anywhere, or as
   taken back. What goes: `heard()`/`heardCount`, the word-counting of `sentHere`, `hadHere`, `atWork` and the hold,
   `turnsBegan`; on the server, `typed()`/`_unstored` for Chat and the Chat-only parts of `_status`.

## Catching errors

- **Recorded runs** (`tests/chat_runs/*.json`): each a live run on a scratch home -- the gatherer's rows for the actor
  (events, reads, withdrawals, with their times), the session's states as the dashboard had them (sampled), and what
  the run did (sent, Esc) -- recorded by `tests/chat_runs/record.py`. Claude Code first: a send to an idle actor, Esc at
  0.3 s and resent, Esc while it answers, a message sent while it works and held for the turn's end, a tool call, a
  question; then Codex and Antigravity.
- **Replay** (`tests/chat_replay.py`): the gatherer rebuilt as it stood at each moment of a run, and the view made
  there -- in order, and again with one source late (the harness's record, the reads, the session) by a few hundred
  ms, which is how the bugs above came about.
- **Checks** (`tests/chat_check.py`), over the sequence of views: no `done` or `idle` between two `working` states of
  one turn unless it stopped; a `cid` in one place at a time; turns only added at the end, but for one taken back; the
  current state always the latest turn's; `began` never moves.
- Each later step runs them: a change that brings back a blink, a double or a jump fails a test, not a person.

## Steps

1. Recorded runs, their replay, the checks (the checks tested on made-up sequences until step 2).
2. `chat_view.py`, its model and route; the checks pass on every recorded run, late sources too.
3. Sends with a `cid`; the view's links.
4. The page draws the view (React); the legacy pieces above removed.
5. The old server paths for Chat removed; the actor list's status from the same view; DESIGN.md updated.
