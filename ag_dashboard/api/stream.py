"""The page's one stream of the home and the actors it shows (live.py wakes it)."""

import json
import threading
import time
from typing import Optional

from fastapi import APIRouter
from starlette.responses import Response

from .. import chat_view, data, server
from .common import KEEPALIVE_EVENT, Errors, Events, Parts, blocking, event

router = APIRouter(route_class=Errors)


def pairs(raw: Optional[str]) -> list:
    """A stream's `also`: [[gatherer, channel], ...] as JSON, each a pair of strings; what is not one is left out."""
    try:
        got = json.loads(raw) if raw else []
    except ValueError:
        return []
    if not isinstance(got, list):
        return []
    return [tuple(p) for p in got if isinstance(p, list) and len(p) == 2 and all(isinstance(x, str) for x in p)
            and p[0]][:server.MAX_ALSO]


def signature(value) -> str:
    """What a stream compares to send only a change: the value, less the time it was read at."""
    if isinstance(value, dict):
        value = {k: v for k, v in value.items() if k != "now"}
    return json.dumps(value, sort_keys=True, default=str)


@router.get("/api/stream")
def stream(srv: Parts, gatherer: Optional[str] = None, channel: Optional[str] = None,
           also: Optional[str] = None) -> Response:
    """Server-sent events, until the page goes: `home` (data.home()) and, with `gatherer` and `channel`, `agent`
    (data.agent(G, C)) and `chat` (what Chat shows of it: chat_view.py's `view`, made from one read) at once, then again
    each time they change -- `chat` also as time alone changes it (a send not seen for long), checked every KEEPALIVE.

    Woken by ag's notifications or the fallback check (live.py) -- what the harness's own record of a session says (the
    user writing to it as it works, a question answered in its terminal, Esc) among them, as ag's hook records it --
    and every KEEPALIVE seconds a comment, or `home` if the time alone changed it (Running/Idle). `also` (JSON
    [[G2, C2], ...]): the page's other actors, its other panes, each sent the same way as `actor` {gatherer, channel,
    agent, chat}: one stream for all a page shows, as a browser keeps few open."""
    others = pairs(also)
    watch = srv.hub.watch(gatherer, channel, others)
    sent, gone = {}, threading.Event()

    def agent_of(g: str, c: str) -> dict:
        try:
            return data.agent(g, c, srv.calls.get())
        except Exception as exc:  # noqa: BLE001 - the page shows it; the stream stays up
            return {"error": f"{type(exc).__name__}: {exc}"}

    def chat_of(g: str, c: str) -> dict:
        try:
            return chat_view.of(g, c, srv.sessions.chat_row(c))
        except Exception as exc:  # noqa: BLE001 - the page shows it; the stream stays up
            return {"error": f"{type(exc).__name__}: {exc}"}

    def next_events() -> list:
        """What to send next: the changes once woken (or KEEPALIVE passed), as events; a comment if none."""
        woken = watch.wake.wait(server.KEEPALIVE)
        if gone.is_set():                        # the page went: nothing more to read for it
            return []
        if woken:
            time.sleep(server.COALESCE)
        home, agent, changed = watch.take()
        out = []                                 # (event, what it is kept as, value)
        if home or not woken:                    # unwoken: the time alone may have changed it
            out.append(("home", "home", srv.home_view(woken)))
        if agent and gatherer and channel is not None:
            out.append(("agent", "agent", agent_of(gatherer, channel)))
        if (agent or not woken) and gatherer and channel is not None:
            out.append(("chat", "chat", chat_of(gatherer, channel)))
        for i in sorted(changed):
            g, c = others[i]
            out.append(("actor", ("actor", g, c), {"gatherer": g, "channel": c, "agent": agent_of(g, c),
                                                   "chat": chat_of(g, c)}))
        chunks = []
        for name, kept, value in out:
            sig = signature(value)
            if sent.get(kept) != sig:
                chunks.append(event(name, value))
                sent[kept] = sig
        if not chunks and not woken:
            chunks.append(KEEPALIVE_EVENT)
        return chunks

    async def events():
        while True:
            for chunk in await blocking(next_events):
                yield chunk

    def close() -> None:
        """The stream let go: the hub rings it no more, and its wait (in a thread) ends now."""
        gone.set()
        srv.hub.drop(watch)
        watch.wake.set()
    return Events(events(), close=close)
