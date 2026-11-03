"""The terminals the dashboard runs: a session's (its harness's own UI) or a shell's -- opened, typed into, resized, and
what it prints streamed to the page."""

import base64
import time

from fastapi import APIRouter
from starlette.responses import Response

from .. import server
from .common import KEEPALIVE_EVENT, Body, Errors, Events, Parts, answer, blocking, event

router = APIRouter(route_class=Errors)
WAIT = 1.0                                       # the longest a terminal stream's thread waits for its output


@router.get("/api/terminal")
def terminal(srv: Parts, session_id: str = "") -> Response:
    """Server-sent events, until the page goes: what the session's (or the shell's: S its id) terminal prints.

    `out` {data (base64), at (where it ends), reset (all that is kept: start over -- a full screen then drawn all
    again, sessions.py's `redraw`)}, then `exit` {code} when its process ends; `none` when it has no terminal."""
    started = srv.sessions

    async def events():
        at, said = -1, time.monotonic()          # nothing yet: all that is kept
        while True:                              # waits of a second: once the page goes, none is left for long
            got = await blocking(started.output, session_id, at, WAIT)
            if got is None:
                yield event("none" if at < 0 else "exit", {"code": None})
                return
            out, end, reset, code = got
            if out or reset:
                yield event("out", {"data": base64.b64encode(out).decode("ascii"), "at": end, "reset": reset})
                at, said = end, time.monotonic()
            if reset:                            # what is kept may not hold all of its full screen
                await blocking(started.redraw, session_id)
            if code is not None:
                yield event("exit", {"code": code})
                return
            if not out and not reset and time.monotonic() - said >= server.KEEPALIVE:
                yield KEEPALIVE_EVENT
                said = time.monotonic()
    return Events(events())


@router.post("/api/terminal")
def open_terminal(srv: Parts, body: Body) -> Response:
    """{session_id | gatherer, channel, cols, rows, fullscreen?}: the session opened in a terminal, Claude Code's own
    UI (sessions.py's `terminal`), in its classic screen unless `fullscreen` -> the session."""
    started = srv.sessions
    sid = str(body.get("session_id") or "")
    if not sid and body.get("gatherer") and body.get("channel"):     # a session not started here
        sid = started.adopt(str(body["gatherer"]), str(body["channel"]))["session_id"]
    return answer(started.terminal(sid, int(body.get("cols") or 120), int(body.get("rows") or 32),
                                   bool(body.get("fullscreen"))))


@router.post("/api/terminal/input")
def typed(srv: Parts, body: Body) -> Response:
    """{session_id, data}: what was typed in it -> {}."""
    srv.sessions.type(str(body.get("session_id") or ""), str(body.get("data") or ""))
    return answer({})


@router.post("/api/terminal/resize")
def resize(srv: Parts, body: Body) -> Response:
    """{session_id, cols, rows}: its new size -> {}."""
    srv.sessions.resize(str(body.get("session_id") or ""), int(body.get("cols") or 0), int(body.get("rows") or 0))
    return answer({})


@router.post("/api/shells")
def shell(srv: Parts, body: Body) -> Response:
    """{gatherer, cwd, cols?, rows?}: a shell opened in `cwd`, listed under the gatherer (sessions.py's `shell`) -> the
    shell, its id the session_id its terminal is reached by."""
    return answer(srv.sessions.shell(str(body.get("gatherer") or ""), str(body.get("cwd") or ""),
                                     int(body.get("cols") or 120), int(body.get("rows") or 32)))


@router.post("/api/shells/close")
def close_shell(srv: Parts, body: Body) -> Response:
    """{id}: the shell's terminal closed, as a window is -> {}."""
    srv.sessions.close_shell(str(body.get("id") or ""))
    return answer({})
