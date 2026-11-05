"""The Editor panel (editor.py): the folders it lists, the files it opens -- shared with every other page editing them,
a Yjs document each -- their edits, saves and conflicts with the file on disk."""

import base64

from fastapi import APIRouter, Depends, Request
from starlette.responses import FileResponse, Response

from .. import chooser, editor
from .common import Body, Errors, Events, Parts, answer, event, local_only, queue_events

router = APIRouter(route_class=Errors)


LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost"})


def _here(request: Request) -> bool:
    """Whether the page asking is on this machine: the system's dialog opens on this machine's screen."""
    return bool(request.client) and request.client.host in LOOPBACK


@router.get("/api/edit/list", dependencies=[Depends(local_only)])
def listing(request: Request, srv: Parts, dir: str = "", root: str = "") -> Response:  # noqa: A002 - the query's name
    """editor.listing(D, R): the directory D under R, each entry with who edits it; `choose`, what the system's Open
    dialog is called (chooser.name: "Finder", ...) for a page on this machine that it opens on, else null -- said with
    an error too (400), so a folder that cannot be listed can still be left through the dialog."""
    choose = chooser.name() if _here(request) else None
    try:
        return answer({**srv.editors.listing(dir, root), "choose": choose})
    except editor.EditorError as exc:
        return answer({"error": str(exc), "choose": choose}, 400)


@router.get("/api/edit/about", dependencies=[Depends(local_only)])
def about(request: Request, path: str = "", root: str = "") -> Response:
    """editor.about(P, R): what the Editor opens the file P (under R) as -- edited, its text; else shown: an image, a
    PDF, a sound, a video, or what it is -- with `reveal`, what shows it where it is (chooser.shower: "Finder", ...) for
    a page on this machine, else null."""
    return answer({**editor.about(path, root), "reveal": chooser.shower() if _here(request) else None})


@router.get("/api/edit/raw/{rest:path}", dependencies=[Depends(local_only)])
def raw(rest: str, root: str = "/", download: str = "") -> FileResponse:
    """The bytes of the file /R (under the query's `root`), as editor.about says to serve them -- by its path, so what it
    names beside it (a page's images) is found beside it: as it is shown in the page (an image's, a PDF's for pdf.js, a
    video's, its ranges as they are asked for), or (download) saved. Sandboxed: a page or an SVG opened here, as any
    origin's, runs nothing that reaches the dashboard."""
    got = editor.about("/" + rest, root or "/")
    return FileResponse(got["real"], media_type=got["type"], filename=got["name"],
                        content_disposition_type="attachment" if download else "inline",
                        headers={"cache-control": "no-cache", "x-content-type-options": "nosniff",
                                 "content-security-policy": "sandbox"})


@router.post("/api/edit/reveal", dependencies=[Depends(local_only)])
def reveal(request: Request, body: Body) -> Response:
    """{path, root}: the file P (under R) shown where it is, in the system's file manager (chooser.reveal) -- for a page
    on this machine only: it opens on this machine's screen -> {}."""
    if not _here(request):
        raise chooser.ChooseError("It would open on the dashboard's machine, not this one")
    chooser.reveal(editor.resolve(str(body.get("path") or ""), str(body.get("root") or "")))
    return answer({})


@router.get("/api/edit/files", dependencies=[Depends(local_only)])
def file_list(dir: str = "", root: str = "") -> Response:  # noqa: A002 - the query's name
    """editor.file_list(D, R): {dir, files (paths from D), more, git}, the files under D (under R) for Go to file."""
    return answer(editor.file_list(dir, root))


@router.post("/api/edit/choose", dependencies=[Depends(local_only)])
def choose(request: Request, body: Body) -> Response:
    """{what ("file", "folder"), start}: the system's Open dialog (chooser.choose), opened at the folder S on this
    machine -- for a page on it only -- answered once it is: {path}, null if it was cancelled. 409: one is open already."""
    if not _here(request):
        raise chooser.ChooseError("The dialog would open on the dashboard's machine, not this one")
    try:
        return answer({"path": chooser.choose(str(body.get("what") or ""), str(body.get("start") or ""))})
    except chooser.Busy as exc:
        return answer({"error": str(exc)}, 409)


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


@router.post("/api/edit/create", dependencies=[Depends(local_only)])
def create(body: Body) -> Response:
    """{path, root, dir}: a new empty file -- or folder (dir true) -- at P under R, the folders above it made too ->
    {path (links followed), dir}; refused where anything is already."""
    return answer(editor.create(str(body.get("path") or ""), str(body.get("root") or ""), bool(body.get("dir"))))


@router.post("/api/edit/zone/clear")
def clear_zone(srv: Parts, body: Body) -> Response:
    """{path, root}: the conflict zone cleared -- the lines edited here the file's to change, as any other -> its
    state."""
    return answer(srv.editors.clear_zone(str(body.get("path") or ""), str(body.get("root") or "")))
