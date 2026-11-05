"""Checks over the views Chat is drawn from, in the order a run made them (ag_dashboard/CHAT_VIEW.md): what a person
would see as a glitch -- a blink, a message twice, a turn jumping -- found by a test instead.

A view, as these read it (the shape `chat_view.view` makes, step 2 of the plan):

    {"turns": [{"n", "text", "cid"?, "began"?}, ...],      the conversation's turns, in order
     "opening": {"text", "cid"?, "began"} or None,          a turn sent, not yet stored
     "current": {"state", "turn"},                          the latest turn's state; its `n` ("opening": the opening)
     "waiting": [{"text", "cid"?}, ...],                    what waits for the agent's next step
     "taken_back": {"text", "cid"?} or None}                the message Esc put back

`check(views)` -> the problems, each a line saying when and what; [] for none.
"""

from typing import Dict, List, Optional, Tuple

#: The states of a turn at work, and those of one over.
AT_WORK = {"opening", "working", "asking"}
OVER = {"done", "idle"}
#: A turn over between two at work counts as a blink if it lasts less than this (seconds).
BLINK_SECONDS = 1.5


def _turns(v: dict) -> List[Tuple[int, str]]:
    return [(t["n"], t["text"]) for t in v.get("turns", [])]


def _cids(v: dict) -> Dict[str, List[str]]:
    """Each send's places in the view: the turns, the opening, the waiting, the taken back."""
    places: Dict[str, List[str]] = {}
    for t in v.get("turns", []):
        if t.get("cid"):
            places.setdefault(t["cid"], []).append(f"turn {t['n']}")
    for name in ("opening", "taken_back"):
        x = v.get(name)
        if x and x.get("cid"):
            places.setdefault(x["cid"], []).append(name)
    for w in v.get("waiting", []):
        if w.get("cid"):
            places.setdefault(w["cid"], []).append("waiting")
    return places


def check(views: List[Tuple[float, dict]], sends: Tuple[float, ...] = (), blink: float = BLINK_SECONDS,
          settled: bool = True) -> List[str]:
    """The problems in `views` ((at, view), in order): a turn over for a blink between two moments it is at work --
    the same turn, or the next with no message sent meanwhile (`sends`: when the run sent one; stopped, it is over); a
    send in two places at once; a turn that changes or goes from the middle of the conversation, or goes from its end
    other than taken back; the current state not the latest turn's; a turn's `began` moving (a turn taken back and
    sent again begins again); and, the run settled (`settled`: its last view, nothing at work), a send not yet sorted
    out -- still opening, or waiting from Chat."""
    out: List[str] = []
    began: Dict[Tuple[int, str], float] = {}
    work: Optional[Tuple[float, object]] = None           # (since, the turn) the latest at work
    over: Optional[Tuple[float, object]] = None           # when it went over after `work`, the turn
    prev: Optional[dict] = None
    t0 = views[0][0] if views else 0.0
    for at, v in views:
        when = f"{at - t0:+.2f}s"
        cur = v.get("current") or {}
        state, turn = cur.get("state"), cur.get("turn")
        # a send in one place at a time
        for cid, places in _cids(v).items():
            if len(places) > 1:
                out.append(f"{when}: send {cid} in {len(places)} places: {', '.join(places)}")
        # the current state is the latest turn's
        turns = _turns(v)
        latest = "opening" if v.get("opening") else (turns[-1][0] if turns else None)
        if turn != latest and not (state == "idle" and turn is None):
            out.append(f"{when}: the current state is turn {turn}'s, the latest is {latest}")
        # turns only added at the end -- the last one may go, taken back
        if prev is not None:
            before = _turns(prev)
            kept = before[:len(turns)]
            if turns[:len(kept)] != kept:
                out.append(f"{when}: turns changed: {before} -> {turns}")
            elif len(turns) < len(before):
                gone = before[len(turns):]
                back = (v.get("taken_back") or {}).get("text")
                if len(gone) > 1 or back != gone[0][1]:
                    out.append(f"{when}: turn {gone[0][0]} went without being taken back")
                for k in gone:                             # sent again, it is a turn of its own: its own start
                    began.pop(k, None)
        # a turn's start does not move
        for t in v.get("turns", []):
            k = (t["n"], t["text"])
            if t.get("began") is not None:
                if k in began and abs(began[k] - t["began"]) > 1e-6:
                    out.append(f"{when}: turn {t['n']} began at {began[k]}, now {t['began']}")
                began.setdefault(k, t["began"])
        # no blink: over, then at work again, for the same turn or the next, within `blink`
        if state in AT_WORK:
            sent = any(over is not None and over[0] < s <= at for s in sends)
            same = over is not None and turn == over[1]
            next_ = over is not None and not sent and (turn == "opening" or (
                isinstance(turn, int) and isinstance(over[1], int) and turn == over[1] + 1))
            if over is not None and at - over[0] < blink and (same or next_):
                out.append(f"{when}: turn {over[1]} shown over for {at - over[0]:.2f}s between two moments at work")
            work, over = (at, turn), None
        elif state in OVER and work is not None and over is None:
            over = (at, turn)
        elif state == "stopped":
            work = over = None
        prev = v
    if settled and views:
        at, v = views[-1]
        state = (v.get("current") or {}).get("state")
        left = [f"opening {v['opening'].get('cid')}"] if v.get("opening") else []
        left += [f"waiting {w.get('cid')}" for w in v.get("waiting", []) if w.get("how") == "chat"]
        if left and state not in ("working", "asking"):     # at work: what waits may still be taken
            out.append(f"{at - t0:+.2f}s: at the end, a send not sorted out: {', '.join(left)}")
    return out
