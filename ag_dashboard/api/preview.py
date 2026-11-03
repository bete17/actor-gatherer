"""A project's preview (preview.py): the command its Execute button runs and what it shows, its runs streamed, the
files it shows served sandboxed, and pdf.js to show a PDF in."""

from fastapi import APIRouter, Depends
from starlette.responses import Response

from .. import preview
from .common import Body, Errors, Parts, answer, failure, local_only, not_found, queue_events, send

router = APIRouter(route_class=Errors)


@router.get("/api/preview", dependencies=[Depends(local_only)])
def about(srv: Parts, path: str = "") -> Response:
    """The project of the file or folder P (in the Editor): its preview -- the command its Execute button runs, and
    what it shows -- or a guess at one, and its checkout's latest run (preview.py)."""
    if srv.previews is None:
        return not_found()
    return answer(srv.previews.about(path))


@router.get("/api/preview/stream", dependencies=[Depends(local_only)])
def preview_stream(srv: Parts, path: str = "") -> Response:
    """Server-sent events, until the page goes: the runs of P's checkout -- `run` (its state), `out` {id, text,
    reset?} (its output, as it comes) -- and `preview` (the project's, as an actor or another page sets it)."""
    if srv.previews is None:
        return not_found()
    try:
        watcher, leave = srv.previews.watch(path)
    except preview.PreviewError as exc:
        return failure(400, str(exc))
    return queue_events(watcher.queue, leave)


@router.get("/preview/{rest:path}", dependencies=[Depends(local_only)])
def preview_file(srv: Parts, rest: str) -> Response:
    """A file of the checkout the token names (/preview/<token>/<path>), which a preview shows (preview.py's `file`):
    HTML and SVG sandboxed -- an origin of their own, so a page previewed cannot call the dashboard's API -- the rest
    as they are."""
    if srv.previews is None:
        return not_found()
    token, _, rel = rest.partition("/")
    try:
        body, kind = srv.previews.file(token, rel)
    except FileNotFoundError:
        return not_found()
    except PermissionError as exc:
        return send(403, str(exc).encode(), "text/plain")
    headers = {"x-content-type-options": "nosniff"}
    if kind.startswith(("text/html", "image/svg+xml", "application/xhtml")):
        headers["content-security-policy"] = "sandbox allow-scripts allow-forms allow-modals allow-popups"
    return send(200, body, kind, headers=headers)


@router.get("/vendor/pdfjs/{rel:path}")
def pdfjs(rel: str) -> Response:
    """pdf.js and its viewer (DocWriter's copy), which a preview shows a PDF in."""
    got = preview.viewer_file(rel)
    return send(200, *got) if got else not_found()


def preview_op(previews: preview.Runs, op: str, body: dict):
    """What the page, or an actor's `ag preview <op>` (`actor` in the body: its id, "" a shell not an actor's), asked of
    a project's preview."""
    path = str(body.get("path") or "")
    by = preview.READER if "actor" not in body else (str(body.get("actor") or "") or "cli")
    if op == "show":
        return previews.about(path)
    if op == "set":
        return previews.set(path, str(body.get("command") or ""), str(body.get("show") or ""), by)
    if op == "clear":
        return previews.clear(path)
    if op == "run":
        try:
            wait = min(float(body.get("wait") or 0), 600.0)
        except (TypeError, ValueError):
            wait = 0.0
        return previews.run(path, str(body["file"]) if body.get("file") else None,
                            str(body["ok"]) if body.get("ok") is not None else None, by, wait)
    if op == "stop":
        return previews.stop(path)
    if op == "synctex":
        return preview.synctex(preview.place(path)[1], body)
    raise preview.PreviewError(f"no `ag preview {op}`: one of show, set, clear, run, stop")


@router.post("/api/preview/{op:path}")
def preview_post(srv: Parts, op: str, body: Body) -> Response:
    """{path, actor?, ...}: the project's preview (preview.py), from the page or -- with `actor`, its id or "" -- an
    actor's `ag preview` -> as GET /api/preview.

    show; set {command, show}; clear; run {file?, ok? (the command an actor set, let run), wait?} -> with the run's
    output, its end; stop; synctex {pdf, mode?, file?, line?, column?, page?, x?, y?}: between the PDF it shows and its
    source."""
    if srv.previews is None:
        return not_found()
    return answer(preview_op(srv.previews, op, body))
