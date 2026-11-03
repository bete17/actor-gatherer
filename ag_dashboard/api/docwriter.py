"""A DocWriter (docwriter.py): its page and pdf.js viewer (vendor/docwriter/), its settings, what it keeps, the page's
one stream, its documents opened, edited and saved, the message to its actor, the MCP server its actor calls, its edit
guard, and DocWriter's own /api routes."""

import base64
import json
from typing import Annotated

import harness_kit
from fastapi import APIRouter, Depends, Path, Request
from starlette.responses import Response

from .. import docwriter, mcp
from .common import Answered, Body, Errors, Parts, answer, failure, not_found, queue_events, send

Key = Annotated[str, Path(pattern=r"^[0-9a-f]{16}$")]
WRITES = ["POST", "PUT", "PATCH", "DELETE"]


class DocWriterErrors(Errors):
    """A DocWriter's routes (/docwriter/w/...) answer its own errors with their status, any other ValueError (a session's
    among them) or OSError 400 ("<type>: <error>"), the rest 500; /api/docwriter's and its mark's as any other route's."""

    def failed(self, request: Request, exc: Exception) -> Response:
        if not request.scope["path"].startswith("/docwriter/w/"):
            return super().failed(request, exc)
        if isinstance(exc, docwriter.DocWriterError):
            return failure(exc.status, str(exc))
        status = 400 if isinstance(exc, (ValueError, OSError)) else 500
        return failure(status, f"{type(exc).__name__}: {exc}")


router = APIRouter(route_class=DocWriterErrors)


def _writers(srv) -> "docwriter.DocWriters":
    """The dashboard's DocWriters (server.py's `apps`), else not found."""
    dws = srv.apps.get("docwriter")
    if dws is None:
        raise Answered(not_found())
    return dws


async def _raw(request: Request) -> bytes:
    return await request.body()


async def _json(request: Request):
    """The request's JSON (none: {}), else 400 -- any JSON: DocWriter's own routes take what they take."""
    try:
        return json.loads(await request.body() or b"{}")
    except ValueError:
        raise Answered(failure(400, "a JSON body, please")) from None


Raw = Annotated[bytes, Depends(_raw)]
Json = Annotated[object, Depends(_json)]


def _query(request: Request) -> dict:
    return dict(request.query_params)


@router.get("/docwriter/w/{key}/dw")
def config(srv: Parts, key: Key) -> Response:
    """A DocWriter's settings (dw): its key, folder, actor, ..."""
    return answer(_writers(srv).config(key))


@router.get("/docwriter/w/{key}/kv")
def kept(srv: Parts, key: Key, names: str = "") -> Response:
    """What a DocWriter keeps (kv), of ?names=[...] (JSON)."""
    return answer(_writers(srv).kv(key, [str(n) for n in json.loads(names or "[]")]))


@router.get("/docwriter/w/{key}/stream")
def stream(srv: Parts, key: Key, conn: str = "") -> Response:
    """Server-sent events, until the page goes: a DocWriter page's one stream -- its documents' changes, the actor's tool
    calls for it to run, the live notices (docwriter.py's `join_page`)."""
    page, leave = _writers(srv).join_page(key, conn)
    return queue_events(page.queue, leave)


@router.get("/docwriter/w/{key}/api/preview")
def preview(srv: Parts, key: Key, path: str = "") -> Response:
    """A file of the DocWriter's folder, its bytes as they are, for its preview."""
    body, kind = _writers(srv).preview(key, path)
    return send(200, body, kind, headers={"x-content-type-options": "nosniff"})


@router.get("/docwriter/w/{key}/mcp")
def mcp_get(srv: Parts, key: Key) -> Response:
    """The MCP server its actor calls has no stream of its own (mcp.py): 405."""
    _writers(srv)
    return send(405, b"POST only", "text/plain")


@router.get("/docwriter/w/{key}/api/{rest:path}")
def api_get(srv: Parts, key: Key, rest: str, request: Request) -> Response:
    """DocWriter's own /api routes, read (docwriter.py's `api`): JSON."""
    status, value = _writers(srv).api(key, "GET", rest, _query(request), None)
    return answer(value, status)


@router.get("/docwriter/w/{key}")
def page(srv: Parts, key: Key) -> Response:
    """A DocWriter's page."""
    return built(srv, key, "")


@router.get("/docwriter/w/{key}/{rest:path}")
def built(srv: Parts, key: Key, rest: str) -> Response:
    """A DocWriter's page ("") or its preview's ("preview"), and its build's files (assets/, pdfjs/: its pdf.js
    viewer)."""
    _writers(srv)
    if rest in ("", "preview") or rest.startswith(("assets/", "pdfjs/")):
        got = docwriter.asset(rest)
        return send(200, *got) if got else not_found()
    return not_found()


@router.post("/docwriter/w/{key}/mcp")
def mcp_server(srv: Parts, key: Key, raw: Raw) -> Response:
    """The MCP server its actor calls (mcp.py): its tools, run by the DocWriter's page."""
    dws = _writers(srv)
    status, value = mcp.handle(raw, dws.tools.tools(), lambda name, args: dws.tools.call(key, name, args),
                               docwriter.MCP_NAME)
    return answer(value, status) if value is not None else send(202, b"", "text/plain")


@router.post("/docwriter/w/{key}/doc/join")
def doc_join(srv: Parts, key: Key, body: Json) -> Response:
    """{conn, tab}: a document opened by the page (its stream's `conn`) -> its state."""
    return answer(_writers(srv).join_doc(key, str(body.get("conn") or ""), str(body.get("tab") or "")))


@router.post("/docwriter/w/{key}/doc/leave")
def doc_leave(srv: Parts, key: Key, body: Json) -> Response:
    """{conn, tab}: a document left by the page -> {}."""
    _writers(srv).leave_doc(key, str(body.get("conn") or ""), str(body.get("tab") or ""))
    return answer({})


@router.post("/docwriter/w/{key}/doc/update")
def doc_update(srv: Parts, key: Key, body: Json) -> Response:
    """{tab, conn, update}: the page's edit of a document (a Yjs update, base64) -> {}."""
    _writers(srv).edit_doc(key, str(body.get("tab") or ""), str(body.get("conn") or ""),
                           base64.b64decode(str(body.get("update") or ""), validate=True))
    return answer({})


@router.post("/docwriter/w/{key}/doc/save")
def doc_save(srv: Parts, key: Key, body: Json) -> Response:
    """{tab, conn, text}: a document saved, as the page has it -> its state."""
    return answer(_writers(srv).save_doc(key, str(body.get("tab") or ""), str(body.get("conn") or ""),
                                         str(body.get("text") or "")))


@router.post("/docwriter/w/{key}/kv")
def keep(srv: Parts, key: Key, body: Json) -> Response:
    """{set: {name: value}}: what a DocWriter keeps, set -> {}."""
    _writers(srv).kv_set(key, body.get("set") if isinstance(body.get("set"), dict) else {})
    return answer({})


@router.post("/docwriter/w/{key}/send")
def send_message(srv: Parts, key: Key, body: Json) -> Response:
    """{text}: the message to its actor -> the session."""
    return answer(_writers(srv).send(key, str(body.get("text") or "")))


@router.post("/docwriter/w/{key}/record")
def record(srv: Parts, key: Key, body: Json) -> Response:
    """{type, payload}: what the author decided, recorded in the actor's gatherer -> {}."""
    _writers(srv).record(key, str(body.get("type") or ""), body.get("payload"))
    return answer({})


@router.post("/docwriter/w/{key}/fs")
def fs(srv: Parts, key: Key, body: Json) -> Response:
    """{op, ...}: the page's file calls in the DocWriter's folder -> what each answers."""
    return answer(_writers(srv).fs(key, body))


@router.post("/docwriter/w/{key}/tools/list")
def tools_list(srv: Parts, key: Key, body: Json) -> Response:
    """{tools}: the tools the page runs for its actor -> {}."""
    _writers(srv).tools.listed(body.get("tools"))
    return answer({})


@router.post("/docwriter/w/{key}/tools/result")
def tools_result(srv: Parts, key: Key, body: Json) -> Response:
    """{id, result}: a tool's answer, from the page -> {}."""
    _writers(srv).tools.answered(str(body.get("id") or ""), body.get("result"))
    return answer({})


@router.post("/docwriter/w/{key}/guard")
def guard(srv: Parts, key: Key, body: Json) -> Response:
    """{path}: its edit guard, asked by its actor's harness before an edit -> {deny: why not, or null}."""
    return answer({"deny": _writers(srv).guard(key, str(body.get("path") or ""))})


@router.api_route("/docwriter/w/{key}/api/{rest:path}", methods=WRITES)
def api_write(srv: Parts, key: Key, rest: str, request: Request, body: Json) -> Response:
    """DocWriter's own /api routes, written (docwriter.py's `api`): JSON."""
    status, value = _writers(srv).api(key, request.method, rest, _query(request), body)
    return answer(value, status)


@router.api_route("/docwriter/w/{key}", methods=WRITES)
def other_root(srv: Parts, key: Key, body: Json) -> Response:
    """Nothing else: not found (once its body is found JSON)."""
    _writers(srv)
    return not_found()


@router.api_route("/docwriter/w/{key}/{rest:path}", methods=WRITES)
def other(srv: Parts, key: Key, rest: str, body: Json) -> Response:
    """Nothing else: not found (once its body is found JSON)."""
    _writers(srv)
    return not_found()


@router.post("/api/docwriter")
def create(srv: Parts, body: Body) -> Response:
    """{gatherer, cwd, harness?, model?}: a new DocWriter on `cwd`, its actor a new session of `harness` in the
    gatherer (docwriter.py's `create`) -> its settings: {key, ...}."""
    dws = srv.apps.get("docwriter")
    if dws is None:
        return not_found()
    return answer(dws.create(str(body.get("gatherer") or ""), str(body.get("cwd") or ""),
                             str(body.get("harness") or harness_kit.DEFAULT), str(body.get("model") or "") or None))


@router.get("/docwriter-mark.svg")
def mark() -> Response:
    """DocWriter's mark, which its page asks for at the root."""
    got = docwriter.asset("docwriter-mark.svg")
    return send(200, *got) if got else not_found()
