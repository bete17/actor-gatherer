"""Chat's view of an actor's conversation (CHAT_VIEW.md): what Chat draws, made from one read of the gatherer at one
moment, so its parts never disagree.

    view(conn, channel, session=None, now=None) -> {
      turns:      files.py's turns, each with `began` (when its message was sent) and `cid` (the send from Chat it is,
                  if one is: `send_id`), and each message written while it ran (`more`) with its `cid` too
      opening:    a turn sent and not stored yet -- {text, cid, began, seen} (`seen`: the harness's record has it) --
                  or None
      current:    {state, turn, doing, failing, asking}: the latest turn's state -- opening, working, asking, done,
                  stopped (`stopped`: how) or idle (no turn) -- and `turn` its n ("opening" for the opening)
      waiting:    what waits for the agent's next step: [{text, cid, how}] -- "queued" in the harness, held for its
                  turn's end; "chat", sent from Chat while it worked, not yet in its record; "dashboard", in the
                  dashboard's own queue for its terminal
      taken_back: the message Esc took back before any of its answer came (data.py's `taken_back`), {text, cid, at}
      version:    what changed it: the same version, the same view
    }

The state follows what the conversation and the harness's record say, in order (`_state`): a turn is at work from its
message on; it is over when its answer ends it (data.py's `turn_over`) -- unless the harness holds a message for its end,
which it goes on with; stopped when Esc or an error stopped it (its record, or a hang-up after its words came); asking
while it waits on the user. No time decides a state but a send not seen for UNSEEN_SECONDS.

A send from Chat is linked to the message it became once, in order (`_links`): the stored message of its words after
it -- or, a message taken back (Esc) and sent again, the send after the take-back, ag restoring the old row at its old
time. Its id is the send's (`send_id`) until sends carry one of their own (CHAT_VIEW.md, step 3).
"""

import time
from typing import Dict, List, Optional, Tuple

from . import data, files

OPENING, WORKING, ASKING, DONE, STOPPED, IDLE = "opening", "working", "asking", "done", "stopped", "idle"
#: A send from Chat the harness has not had for this long: said so (its terminal may be asking something first).
UNSEEN_SECONDS = 15.0
#: How much later than the message it became a send may say it was sent (seconds): none, as the dashboard keeps a send
#: before it types it (sessions.py's `send`); a gatherer's sends from before that were kept once typed, ~0.2 s after.
#: Small: the same words sent again soon after are another send.
SENT_BEFORE = 1.0
#: How far back the record's sends and queue are read.
RECORD_READ = 200


def send_id(at: float) -> str:
    """The id of a send from Chat (its `chat_sent`), until sends carry their own: when it was sent."""
    return f"chat:{at:.6f}"


def _said(text: Optional[str]) -> str:
    return data._said(text)


def _sends(conn, channel: str, session: Optional[dict]) -> List[dict]:
    """The messages sent from Chat, oldest first: [{cid, text, at}] -- as the gatherer keeps them (`chat_sent`), and as
    the dashboard has them in memory from the moment each came, before it typed it (the session's `sent`), one by its
    id. Not "/" commands, which the harness runs itself."""
    out: Dict[str, dict] = {}
    for _, f in data._facts(conn, channel, ("chat_sent",), RECORD_READ):
        if isinstance(f.get("at"), (int, float)) and f.get("text") and not str(f["text"]).startswith("/"):
            cid = f.get("cid") or send_id(f["at"])
            out[cid] = {"cid": cid, "text": f["text"], "at": float(f["at"])}
    for s in (session or {}).get("sent") or []:
        if s.get("cid") and s["cid"] not in out and s.get("text") and isinstance(s.get("at"), (int, float)):
            out[s["cid"]] = {"cid": s["cid"], "text": s["text"], "at": float(s["at"])}
    return sorted(out.values(), key=lambda s: s["at"])


def _record(conn, channel: str) -> Tuple[List[dict], List[dict]]:
    """What the harness's record says of the user's messages: (sent as a turn's first message -- [{text, sent}] --,
    queued and not yet sent nor taken out -- [{text, queued}])."""
    prompts, pending = [], {}
    for t, f in data._facts(conn, channel, ("message_queued", "message_sent", "message_withdrawn"), RECORD_READ):
        q = f.get("queued")
        if t == "message_queued" and q:
            pending[q] = {"text": f.get("text") or f.get("words") or "", "queued": f.get("at")}
        elif t in ("message_sent", "message_withdrawn"):
            pending.pop(q, None)
            if t == "message_sent" and f.get("how") == "prompt" and isinstance(f.get("at"), (int, float)):
                prompts.append({"text": f.get("words") or f.get("text") or "", "sent": float(f["at"])})
    return prompts, list(pending.values())


def _hang_ups(conn, channel: str) -> List[dict]:
    """The calls of the channel hung up on (Esc), oldest first: [{read, row, reached, withdrawn, at}] -- the read's newest
    row (its user's message, for a call that opened a turn), what of the answer had reached the harness and whether the
    hook had what the call stored withdrawn (the hook's `call_failed`: "text", "tool", "nothing"; True or False; None
    from a hook before it said), and when the hook stored it."""
    if "p_read_id" not in data._columns(conn, "events") or data.CHANNEL not in data._columns(conn, "_reads"):
        return []
    out = []
    for read, row_id, at, raw in conn.execute(
            f"SELECT e.p_read_id, r.row_id, e.inserted_at, e.payload_json FROM events e JOIN event_types t ON {data.BY_CHANNEL} "
            f"JOIN _reads r ON r.read_id = e.p_read_id WHERE ifnull(e.{data.CHANNEL}, '') = ? AND t.name = 'call_failed' "
            f"ORDER BY e.row_id", (channel,)):
        got = data._json(raw) or {}
        if got.get("status") == data.HUNG_UP:
            out.append({"read": read, "row": row_id, "reached": got.get("reached"), "withdrawn": got.get("withdrawn"),
                        "at": data._seconds(at) or 0.0})
    return out


def _words_of(conn, row_id: Optional[int]) -> Optional[str]:
    """The user's words of a stored user message (its `p_words`, else its text unwrapped by its harness's rules), None
    for any other row."""
    if row_id is None:
        return None
    cols = data._columns(conn, "events")
    words = "e.p_words" if "p_words" in cols else "NULL"
    r = conn.execute(f"SELECT t.name, {words}, e.text, e.{data.CHANNEL} FROM events e JOIN event_types t "
                     f"ON t.event_type_id = e.event_type_id WHERE e.row_id = ?", (row_id,)).fetchone()
    if r is None or r[0] != "user_message":
        return None
    if r[1] is not None:
        return r[1]
    import harness_kit
    return harness_kit.words(r[2] or "", data._harness(conn, r[3] or ""))[1]


def _messages(turns: List[dict]) -> List[tuple]:
    """The user's messages Chat shows, each (row, words, stored at): each turn's, and those written while it ran."""
    out = []
    for t in turns:
        out.append((t.get("row_id"), t.get("text") or "", t.get("at")))
        for m in t.get("more") or []:
            out.append((m.get("row_id"), m.get("text") or "", m.get("at")))
    return out


def _sorted_out(sends: List[dict], shown: List[tuple], backs: List[dict]) -> Tuple[Dict[int, dict], Dict[str, dict]]:
    """Each send from Chat, sorted out: (the send each shown message is, by its row; the sends Esc took back, by id, each
    with the hang-up that did). A message is the newest send of its words before it was stored (SENT_BEFORE), not
    another's -- one Esc took back and the harness sent again (ag keeps its old row, at its old time), the first send of
    its words after the latest hang-up that took it back. A hang-up that took its message back (`took`) took back the
    newest send of its words before it."""
    used: set = set()
    took: Dict[str, dict] = {}
    for b in backs:
        if not b["took"]:
            continue
        s = next((s for s in reversed(sends) if s["cid"] not in used and s["at"] <= b["at"]
                  and _said(s["text"]) == _said(b["words"])), None)
        if s is not None:
            used.add(s["cid"])
            took[s["cid"]] = b
    last_back = {}
    for b in backs:
        if b["took"]:
            last_back[b["row"]] = b["at"]
    links: Dict[int, dict] = {}
    for row_id, text, at in sorted(shown, key=lambda m: last_back.get(m[0], m[2] or 0.0)):
        same = [s for s in sends if s["cid"] not in used and _said(s["text"]) == _said(text)]
        if row_id in last_back:
            got = next((s for s in same if s["at"] >= last_back[row_id]), None)
        else:
            got = next((s for s in reversed(same) if at is None or s["at"] <= at + SENT_BEFORE), None)
        if got is not None:
            used.add(got["cid"])
            links[row_id] = got
    return links, took


def _over(conn, channel: str, tables: set) -> bool:
    """Whether the latest turn is over (data.py's `turn_over`) -- once the answer to its latest call has ended, as its
    `reply_end` says (OVER, or a stop that does not go on), with nothing of the user's or a tool's stored since: ag stores
    the answer's events one by one as the next call carries them back, and its reasoning, stored before its words, is
    no turn under way again."""
    over, _ = data.turn_over(conn, channel, tables)
    if "p_answer_id" not in data._columns(conn, "events") or data.replies(conn, channel, tables):
        return over                                      # an answer under way: its stop, as turn_over has it
    row = conn.execute(
        f"SELECT max(CASE WHEN t.name = 'reply_end' THEN e.row_id END), "
        f"max(CASE WHEN t.name = 'model_call' AND json_extract(e.payload_json, '$.kind') = 'turn' THEN e.row_id END), "
        f"max(CASE WHEN t.name IN ('user_message', 'tool_output') THEN e.row_id END) "
        f"FROM events e JOIN event_types t ON {data.BY_CHANNEL} WHERE ifnull(e.{data.CHANNEL}, '') = ? "
        f"AND t.name IN ('reply_end', 'model_call', 'user_message', 'tool_output')", (channel,)).fetchone()
    end, call, said = row[0], row[1] or 0, row[2] or 0
    if end is None or end < call or end < said:
        return over
    stop = (data._json(conn.execute("SELECT payload_json FROM events WHERE row_id = ?", (end,)).fetchone()[0]) or {}).get("stop")
    return stop in data.OVER or stop not in data.GOES_ON


def _stop_on(opening: Optional[dict], session: Optional[dict]) -> tuple:
    """A turn opening that the harness has recorded nothing of, a key that stops a turn typed into its terminal since
    (the session's `stopped_at`), as the terminal's message box shows it after: empty -- the harness stopped it, before
    any call that would record it (a codex session's first message: its thread is made by that call) -- the opening
    stopped; holding it -- the harness took it back into its box -- the opening gone, taken back. (opening, taken back)."""
    stop, box = (session or {}).get("stopped_at"), (session or {}).get("box")
    if opening is None or opening.get("seen") or not stop or stop <= opening["began"]:
        return opening, None
    if box == "empty":
        return dict(opening, unseen=False, stopped={"kind": "interrupted", "at": stop, "text": None, "status": None,
                                                   "reason": None}), None
    if box == "holds":
        return None, {"text": opening["text"], "at": stop, "cid": opening.get("cid"), "since": opening["began"]}
    return opening, None


def _state(conn, channel: str, tables: set, turns: List[dict], opening: Optional[dict], held: List[dict],
           session: Optional[dict], backs: List[dict]) -> dict:
    """The latest turn's state (module doc): from what its record says it stopped on, else its newest call -- hung up on
    after its answer had begun: stopped (the harness keeps the turn, interrupted); before, on the message of a turn
    taken back: the turn before it, over -- else whether its answer ended it (data.py's `turn_over`)."""
    out = {"state": IDLE, "turn": None, "doing": None, "failing": None, "asking": None, "stopped": None}
    if opening is not None and opening.get("stopped"):
        return dict(out, state=STOPPED, turn="opening", stopped=opening["stopped"])
    if opening is not None:
        return dict(out, state=OPENING, turn="opening")
    if not turns:
        return out
    latest = turns[-1]
    out["turn"] = latest["n"]
    if latest.get("stopped"):
        return dict(out, state=STOPPED, stopped=latest["stopped"])
    if session is not None and session.get("ended"):
        return dict(out, state=STOPPED, stopped={"kind": "closed"})
    newest = (data._newest_reads(conn, channel, 1) or [None])[0]
    hung = backs[-1] if backs and newest is not None and backs[-1]["read"] == newest["read_id"] else None
    if hung is not None and (latest.get("began") or 0.0) > hung["at"]:
        hung = None                                      # its message sent again since: before the call that takes it
    if hung is not None:
        shown = {m[0] for m in _messages(turns)}
        if hung["took"] and hung["row"] not in shown:
            return dict(out, state=DONE)                 # its message taken back: the turn before was over
        return dict(out, state=STOPPED, stopped={"kind": "interrupted", "at": hung["at"], "text": None, "status": None,
                                                 "reason": None})
    asking = data.record_of(conn, channel).asking()
    if asking:
        return dict(out, state=ASKING, asking=asking)
    over = _over(conn, channel, tables)
    if over and not held:                                # held: the harness goes on with it as the turn ends
        return dict(out, state=DONE)
    return dict(out, state=WORKING, doing=latest.get("now"), failing=data.failing(conn, channel))


def view(conn, channel: str, session: Optional[dict] = None, now: Optional[float] = None) -> dict:
    """Chat's view of the channel's conversation (module doc). `session`: the dashboard's row of the actor's session
    (sessions.py's: `queued`, `ended`, `sent`, ...), if it has one."""
    now = time.time() if now is None else now
    tables = data._tables(conn)
    got = files.files_of(conn, channel)
    turns = [dict(t) for t in got.get("turns") or []]
    sends = _sends(conn, channel, session)
    prompts, held = _record(conn, channel)
    shown = {m[0] for m in _messages(turns)}
    backs = []
    for b in _hang_ups(conn, channel):                   # each took its message back: Esc before any of its answer, the
        words = _words_of(conn, b["row"])                # hook withdrawing what it stored (an older hook: it is hidden)
        withdrew = b["withdrawn"] if b["withdrawn"] is not None else b["row"] not in shown
        backs.append(dict(b, words=words, took=b["reached"] == "nothing" and words is not None and bool(withdrew)))
    links, took = _sorted_out(sends, _messages(turns), backs)
    for t in turns:
        s = links.get(t.get("row_id"))
        prompt = next((p for p in prompts if _said(p["text"]) == _said(t.get("text"))
                       and t.get("at") is not None and abs(p["sent"] - t["at"]) <= SENT_BEFORE), None)
        t["cid"] = s["cid"] if s else None
        t["began"] = s["at"] if s else (prompt["sent"] if prompt else t.get("at"))
        t["more"] = [dict(m, cid=(links.get(m.get("row_id")) or {}).get("cid")) for m in t.get("more") or []]
    back, _ = data.taken_back(conn, channel, tables, data.record_of(conn, channel), now)
    if back is not None:                                 # the send it was: the one the newest hang-up took back
        s = next((s for s in reversed(sends) if s["cid"] in took and _said(s["text"]) == _said(back["text"])), None)
        back = {"text": back["text"], "at": back.get("at"), "cid": s["cid"] if s else None, "since": back.get("since")}
    done = {s["cid"] for s in links.values()} | set(took)
    pending = [s for s in sends if s["cid"] not in done]
    stored = max((t.get("began") or 0.0 for t in turns), default=0.0)
    pending = [s for s in pending if s["at"] > stored - SENT_BEFORE]   # older: never stored (a send that went nowhere)
    at_work = bool(turns) and _state(conn, channel, tables, turns, None, held, session, backs)["state"] in (WORKING, ASKING)
    # the record's sends of a turn's first message, not stored yet: the harness has it
    fresh = [p for p in prompts if p["sent"] > stored + 0.001 and not any(
        _said(p["text"]) == _said(t.get("text")) and t.get("at") is not None and t["at"] >= p["sent"] - 1 for t in turns)]
    opening, waiting = None, []
    for s in pending:
        if any(_said(q["text"]) == _said(s["text"]) for q in held):
            continue                                     # the harness holds it: below, as its queue has it
        if opening is None and not at_work:
            seen = any(_said(p["text"]) == _said(s["text"]) for p in fresh)
            opening = {"text": s["text"], "cid": s["cid"], "began": s["at"], "seen": seen,
                       "unseen": not seen and now - s["at"] > UNSEEN_SECONDS}
        else:
            waiting.append({"text": s["text"], "cid": s["cid"], "how": "chat"})
    if opening is None and not at_work:                  # sent in its terminal: the harness's record has it
        p = next((p for p in fresh if not any(_said(p["text"]) == _said(s["text"]) for s in sends)), None)
        if p is not None:
            opening = {"text": p["text"], "cid": None, "began": p["sent"], "seen": True, "unseen": False}
    shown = _messages(turns)
    opening, stopped_back = _stop_on(opening, session)
    back = back or stopped_back
    for q in held:                                       # held by the harness -- not one stored since it was queued, which
        if any(_said(text) == _said(q["text"]) and at is not None and q.get("queued") is not None   # it has sent, its
               and at >= q["queued"] - SENT_BEFORE for _, text, at in shown):                      # record yet to say
            continue
        s = next((s for s in pending if _said(s["text"]) == _said(q["text"])), None)
        waiting.append({"text": q["text"], "cid": s["cid"] if s else None, "how": "queued"})
    # held, sent with its turn's end, not stored yet: waits on
    for m in data.meanwhile(conn, channel):
        if m["sent"] is not None and m["sent"] > stored - SENT_BEFORE and not any(
                _said(text) == _said(m["text"]) and at is not None and at >= m["sent"] - SENT_BEFORE for _, text, at in shown):
            s = next((s for s in pending if _said(s["text"]) == _said(m["text"])), None)
            waiting.append({"text": m["text"], "cid": s["cid"] if s else None, "how": "queued"})
    for text in (session or {}).get("queued") or []:
        waiting.append({"text": text, "cid": None, "how": "dashboard"})
    current = _state(conn, channel, tables, turns, opening, held, session, backs)
    top = conn.execute("SELECT max(row_id) FROM events").fetchone()[0] or 0
    withdrawn = conn.execute("SELECT count(*) FROM _withdrawn").fetchone()[0] if "_withdrawn" in tables else 0
    return {"turns": turns, "opening": opening, "current": current, "waiting": waiting, "taken_back": back,
            "version": [top, withdrawn, (session or {}).get("ended"), len((session or {}).get("queued") or []),
                        len(sends), bool(opening and opening.get("unseen"))]}


def of(gatherer: str, channel: str, session: Optional[dict] = None, now: Optional[float] = None) -> dict:
    """`view`, of the gatherer as it is now -- with no database for it yet (made by its first call), of the session's
    sends alone (`unstored`)."""
    conn = data._connect(gatherer)
    if conn is None:
        return unstored(session, now)
    try:
        return view(conn, channel, session, now)
    finally:
        conn.close()


def unstored(session: Optional[dict], now: Optional[float] = None) -> dict:
    """The view of a conversation nothing of which is stored yet: the session's first send from Chat opening its turn
    (not seen by the harness: its record is in no database yet), the rest waiting; no turn else."""
    now = time.time() if now is None else now
    sends = sorted(((session or {}).get("sent") or []), key=lambda s: s.get("at") or 0)
    opening = None
    if sends:
        s = sends[0]
        opening = {"text": s["text"], "cid": s.get("cid"), "began": s["at"], "seen": False,
                   "unseen": now - s["at"] > UNSEEN_SECONDS}
    opening, back = _stop_on(opening, session)
    waiting = [{"text": s["text"], "cid": s.get("cid"), "how": "chat"} for s in sends[1:]]
    waiting += [{"text": t, "cid": None, "how": "dashboard"} for t in (session or {}).get("queued") or []]
    stopped = (opening or {}).get("stopped")
    current = {"state": STOPPED if stopped else OPENING if opening else IDLE, "turn": "opening" if opening else None,
               "doing": None, "failing": None, "asking": None, "stopped": stopped}
    return {"turns": [], "opening": opening, "current": current, "waiting": waiting, "taken_back": back,
            "version": [0, 0, (session or {}).get("ended"), len(waiting), len(sends), bool(opening and opening["unseen"])]}
