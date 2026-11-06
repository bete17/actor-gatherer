"""The home -- every gatherer and its actors, as the list shows them -- and what the reader keeps of it: gatherers made,
hidden, named; actors saved, named, seen, and kept in folders."""

import harness_kit
from fastapi import APIRouter
from starlette.responses import Response

from .. import folders, hiding, naming, saved, seen, sessions, titles
from ..models import Home
from .common import Body, Errors, Parts, answer

router = APIRouter(route_class=Errors)


@router.get("/api/home", response_model=Home)
def the_home(srv: Parts) -> Response:
    """data.home(), each actor with its avatar (avatars.py's `assign`), and the shells open (sessions.py's `shells`):
    read now, a page's first (its stream's after it, shared)."""
    return answer(srv.home_view())


@router.post("/api/gatherers")
def new_gatherer(body: Body) -> Response:
    """{name}: a new gatherer (`ag new`), no session yet -> {name}."""
    return answer(sessions.new_gatherer(str(body.get("name") or "")))


@router.post("/api/hiding")
def hide(srv: Parts, body: Body) -> Response:
    """{gatherer, choice}: keep "hidden" / "shown" / "" for it (hiding.py) -> every choice."""
    kept = hiding.choose(str(body.get("gatherer") or ""), str(body.get("choice") or ""))
    srv.hub.ring(None, what="list")              # every open page's list
    return answer(kept)


@router.post("/api/title")
def title(srv: Parts, body: Body) -> Response:
    """{gatherer, title}: the reader's name for the gatherer ("": none), shown in its place (titles.py) -> every title."""
    kept = titles.give(str(body.get("gatherer") or ""), str(body.get("title") or ""))
    srv.hub.ring(None, what="list")
    return answer(kept)


@router.post("/api/saved")
def save(srv: Parts, body: Body) -> Response:
    """{gatherer, channel, saved}: the actor saved for later, or no longer (saved.py) -> every one saved."""
    kept = saved.choose(str(body.get("gatherer") or ""), str(body.get("channel") or ""), bool(body.get("saved")))
    srv.hub.ring(None, what="list")
    return answer(kept)


@router.post("/api/folders")
def folder(srv: Parts, body: Body) -> Response:
    """{gatherer, do, ...}: the gatherer's folders changed (folders.py) -> {folders: every gatherer's, made?}.

    new {name, parent?} (made: its id), rename {id, to}, move {id, parent?} (a folder put in another; none: at the
    top), delete {id} (what was in it moved up), file {channels, folder?} (actors put in a folder; none: at the top)."""
    g, do = str(body.get("gatherer") or ""), str(body.get("do") or "")
    parent = body.get("parent")
    parent = None if parent in (None, "") else parent
    made = None
    if do == "new":
        made = folders.make(g, str(body.get("name") or ""), parent)
    elif do == "rename":
        folders.rename(g, body.get("id"), str(body.get("to") or ""))
    elif do == "move":
        folders.move(g, body.get("id"), parent)
    elif do == "delete":
        folders.delete(g, body.get("id"))
    elif do == "file":
        channels = body.get("channels")
        if not isinstance(channels, list):
            raise ValueError("which actors? `channels`, a list")
        target = body.get("folder")
        folders.file(g, [str(c) for c in channels], None if target in (None, "") else target)
    else:
        raise ValueError("do what? One of new, rename, move, delete, file")
    srv.hub.ring(None, what="list")
    return answer({"folders": folders.stored(), **({"made": made} if made is not None else {})})


@router.post("/api/name")
def name(srv: Parts, body: Body) -> Response:
    """{gatherer, channel, name, harness?, cwd?}: the reader's name for the actor ("": none) -> {name, store, error,
    terminal}.

    A `name` event in its gatherer, put in by ag (naming.py), given to its harness's own store too (`store`: what was
    done there, `error`: why not), and -- where the dashboard runs its terminal -- typed there as the harness's own
    command once its turn is over (sessions.py's `rename`; `terminal`: held for it)."""
    g, c, given = str(body.get("gatherer") or ""), str(body.get("channel") or ""), naming.clean(body.get("name"))
    naming.record(g, c, given)
    harness = str(body.get("harness") or "") or None
    out = {"name": given, "store": None, "error": None, "terminal": False}
    try:
        out["store"] = naming.in_store(harness, c, given, str(body.get("cwd") or "") or None)
    except harness_kit.RenameError as exc:
        out["error"] = str(exc)
    rules = harness_kit.get(harness)
    command = rules.rename_command(given) if rules is not None else None
    out["terminal"] = bool(command) and srv.sessions.rename(c, command)
    srv.hub.ring(g, c)                           # every open page's home: one types it, once it may
    return answer(out)


@router.post("/api/seen")
def look(body: Body) -> Response:
    """{seen: [[gatherer, channel, last], ...]}: those actors looked at, each with its `last` (seen.py) -> every one
    seen. Not rung: a home costs every stream a read of every gatherer; the page that looked has it, the others with
    their next home (KEEPALIVE at most)."""
    return answer(seen.look(body.get("seen")))
