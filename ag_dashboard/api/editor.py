"""The Editor panel (editor.py): the folders it lists, the files it opens -- shared with every other page editing them,
a Yjs document each -- their edits, saves and conflicts with the file on disk."""

import base64

from fastapi import APIRouter, Depends
from starlette.responses import Response

from .. import editor
from .common import Body, Errors, Events, Parts, answer, event, local_only, queue_events

router = APIRouter(route_class=Errors)


@router.get("/api/edit/list", dependencies=[Depends(local_only)])
def listing(srv: Parts, dir: str = "", root: str = "") -> Response:  # noqa: A002 - the query's name
    """editor.listing(D, R): the directory D under R, each entry with who edits it."""
    return answer(srv.editors.listing(dir, root))


@router.get("/api/edit/place", dependencies=[Depends(local_only)])
def place(gatherer: str, channel: str, cwd: str = "") -> Response:
    """{dir}: where the actor's work is, the Editor opened from its pane -- the folder holding what it changed lately
    (editor.place); null, none."""
    return answer({"dir": editor.place(gatherer, channel, cwd)})


@router.get("/api/edit/stream", dependencies=[Depends(local_only)])
def edit_stream(srv: Parts, path: str = "", root: str = "", conn: str = "", client: str = "") -> Response:
    """Server-sent events, until the page goes: the file P (under R) opened for editing (editor.py), shared with every
    other page editing it.

    `init` {epoch, update (the document, a Yjs update, base64), sv (its state vector), aware (the other pages'
    cursors)}, then `update` {update, disk (true: the file's own change on disk)}, `aware` {update}, `left` {client}
    and `state` {dirty, missing, error, changed, saved, editors, conflicts: [{id, from, to (UTF-16), base, theirs, at,
    zone}], zone: [[from, to], ...] (the conflict zone)} as they come; `failed` {error} when it cannot be opened."""
    try:
        room, joined = srv.editors.join(path, root, conn, int(client) if client.isdigit() else 0)
    except (editor.EditorError, OSError) as exc:
        failed = str(exc)

        async def refused():
            yield event("failed", {"error": failed})
        return Events(refused())
    return queue_events(joined.queue, lambda: room.leave(joined))


@router.post("/api/edit/update")
def update(srv: Parts, body: Body) -> Response:
    """{path, root, conn, update}: the page's edit of an open file (a Yjs update, base64) -> its state."""
    return answer(srv.editors.edit(str(body.get("path") or ""), str(body.get("root") or ""),
                                   str(body.get("conn") or ""),
                                   base64.b64decode(str(body.get("update") or ""), validate=True)))


@router.post("/api/edit/aware")
def aware(srv: Parts, body: Body) -> Response:
    """{path, root, conn, update}: the page's cursor in it (a y-protocols awareness update) -> {}."""
    srv.editors.aware(str(body.get("path") or ""), str(body.get("root") or ""), str(body.get("conn") or ""),
                      base64.b64decode(str(body.get("update") or ""), validate=True))
    return answer({})


@router.post("/api/edit/save")
def save(srv: Parts, body: Body) -> Response:
    """{path, root}: the file written as its document has it -> its state."""
    return answer(srv.editors.save(str(body.get("path") or ""), str(body.get("root") or "")))


@router.post("/api/edit/settle")
def settle(srv: Parts, body: Body) -> Response:
    """{path, root, conflict, take}: a conflict with the file on disk settled -- the lines kept (take "mine"), the
    file's in their place ("theirs"), or both -> its state."""
    return answer(srv.editors.settle(str(body.get("path") or ""), str(body.get("root") or ""),
                                     str(body.get("conflict") or ""), str(body.get("take") or "")))


@router.post("/api/edit/zone/clear")
def clear_zone(srv: Parts, body: Body) -> Response:
    """{path, root}: the conflict zone cleared -- the lines edited here the file's to change, as any other -> its
    state."""
    return answer(srv.editors.clear_zone(str(body.get("path") or ""), str(body.get("root") or "")))
