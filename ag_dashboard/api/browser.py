"""A Browser (browser.py): a page of the web its actor and the user both act in -- its state and screen streamed to the
page, what the user does in it, the MCP server its actor calls; and the user's Chrome's logins for every Browser.

Its Chrome is the dashboard's own, or the user's (config.toml's `[dashboard] browser_profile = "mine"`)."""

import json
from typing import Annotated

import harness_kit
from fastapi import APIRouter, Depends, Path, Request
from starlette.responses import Response

from .. import browser, editor, mcp
from .common import KEEPALIVE_EVENT, Answered, Body, Errors, Events, Parts, answer, blocking, event, failure, \
    not_found, send

KEY = r"^[0-9a-f]{16}$"
Key = Annotated[str, Path(pattern=KEY)]


class BrowserErrors(Errors):
    """A Browser's routes answer a Browser's error with its own status; what the user does in it (/browser/w/...) any
    other ValueError (a number that is not one...), TypeError or OSError 400 ("<type>: <error>"), the rest 500; its
    stream's, and /api/browser's, as any other route's."""

    def failed(self, request: Request, exc: Exception) -> Response:
        if isinstance(exc, browser.BrowserError):
            return failure(exc.status, str(exc))
        if request.method == "GET" or not request.scope["path"].startswith("/browser/w/"):
            return super().failed(request, exc)
        status = 400 if isinstance(exc, (ValueError, TypeError, OSError)) else 500
        return failure(status, f"{type(exc).__name__}: {exc}")


router = APIRouter(route_class=BrowserErrors)


async def _raw(request: Request) -> bytes:
    return await request.body()


async def _object(request: Request) -> dict:
    """A POST's JSON object (none: {}), else 400 -- a Browser's view sends one with each thing the user does."""
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise Answered(failure(400, "a JSON object, please"))
    return body


Raw = Annotated[bytes, Depends(_raw)]
Object = Annotated[dict, Depends(_object)]


def _browsers(srv) -> "browser.Browsers":
    """The dashboard's Browsers (server.py's `apps`), else None."""
    return srv.apps.get("browser")


def _browser(srv, key: str) -> "browser.Browser":
    bs = _browsers(srv)
    if bs is None:
        raise Answered(not_found())
    return bs.get(key)


def _num(body: dict, k: str):
    return None if body.get(k) is None else float(body[k])


@router.get("/browser/w/{key}/stream")
def stream(srv: Parts, key: Key, video: str = "") -> Response:
    """Server-sent events, until the page goes: a Browser's `state` {tabs, active, picks, acting, dialog, error, running,
    viewport, video} as it changes, and its screen, `frame` {data (a JPEG, base64), w, h (the page's size), seq}, as it
    does.

    With ?video=1 (the page decodes video), `video` chunks {t: key | delta, ts, d (base64), seq; a key's codec, w, h}
    instead where they can be (browser_video.py), every one from a key frame on, in order."""
    b = _browser(srv, key)
    viewer = b.join(video == "1")

    async def events():
        while True:
            got = await blocking(viewer.take, editor.GONE_CHECK)
            if got is None:
                return
            if not got:
                yield KEEPALIVE_EVENT
            for name, value in got:
                yield event(name, value)
    return Events(events(), close=lambda: b.leave(viewer))


@router.post("/browser/w/{key}/mcp")
def mcp_server(srv: Parts, key: Key, raw: Raw) -> Response:
    """The MCP server the Browser's actor calls (mcp.py): its tools, run in the Browser."""
    bs = _browsers(srv)
    if bs is None:
        return not_found()
    status, value = mcp.handle(raw, browser.TOOLS, lambda name, args: bs.call(key, name, args), browser.NAME)
    return answer(value, status) if value is not None else send(202, b"", "text/plain")


@router.post("/browser/w/{key}/input")
def user_input(srv: Parts, key: Key, body: Object) -> Response:
    """{events}: what the user typed, clicked and scrolled in its view -> {clipboard} for a copy among them."""
    b = _browser(srv, key)
    return answer(b.input(body.get("events") if isinstance(body.get("events"), list) else []))


@router.post("/browser/w/{key}/nav")
def nav(srv: Parts, key: Key, body: Object) -> Response:
    """{url | action}: the active tab taken to `url`, or back, forward, reloaded (`action`) -> {done}."""
    b = _browser(srv, key)
    return answer({"done": b.navigate(str(body.get("url") or ""), str(body.get("action") or ""))})


@router.post("/browser/w/{key}/resize")
def resize(srv: Parts, key: Key, body: Object) -> Response:
    """{width, height, dpr}: the view's new size -> {}."""
    b = _browser(srv, key)
    b.resize(int(body.get("width") or 0), int(body.get("height") or 0), float(body.get("dpr") or 1))
    return answer({})


@router.post("/browser/w/{key}/hover")
def hover(srv: Parts, key: Key, body: Object) -> Response:
    """{x, y}: where the user's pointer is in it -> {}."""
    b = _browser(srv, key)
    b.hover(_num(body, "x"), _num(body, "y"))
    return answer({})


@router.post("/browser/w/{key}/pick")
def pick(srv: Parts, key: Key, body: Object) -> Response:
    """{x, y | box}: what the user picked in it, for its actor -> the pick."""
    b = _browser(srv, key)
    box = body.get("box")
    return answer(b.pick(_num(body, "x"), _num(body, "y"), box if isinstance(box, list) and len(box) == 4 else None))


@router.post("/browser/w/{key}/unpick")
def unpick(srv: Parts, key: Key, body: Object) -> Response:
    """{id}: a pick taken back -> {}."""
    b = _browser(srv, key)
    b.unpick(str(body.get("id") or ""))
    return answer({})


@router.post("/browser/w/{key}/dialog")
def dialog(srv: Parts, key: Key, body: Object) -> Response:
    """{accept, text?}: the page's dialog (alert, confirm, prompt) answered -> {done}."""
    b = _browser(srv, key)
    return answer({"done": b.answer_dialog(bool(body.get("accept")),
                                           body.get("text") if isinstance(body.get("text"), str) else None)})


@router.post("/browser/w/{key}/copy")
def copy(srv: Parts, key: Key, body: Object) -> Response:
    """{cut?}: what is selected in it, copied (or cut) -> {text?, html?}."""
    b = _browser(srv, key)
    return answer(b.copy(bool(body.get("cut"))))


@router.post("/browser/w/{key}/choose")
def choose(srv: Parts, key: Key, body: Object) -> Response:
    """{n, index | value}: a choice in a drop-down's list or a picker the view showed -> {}."""
    b = _browser(srv, key)
    b.choose(int(body.get("n") or 0), None if body.get("index") is None else int(body["index"]),
             None if body.get("value") is None else str(body["value"]))
    return answer({})


@router.post("/browser/w/{key}/find")
def find(srv: Parts, key: Key, body: Object) -> Response:
    """{q, back?, again?}: the text found in the page -> {count, index}."""
    b = _browser(srv, key)
    return answer(b.find(str(body.get("q") or ""), bool(body.get("back")), bool(body.get("again"))))


@router.post("/browser/w/{key}/file")
def upload(srv: Parts, key: Key, body: Object) -> Response:
    """{name, data (base64)}: a file for the page -> {id}."""
    b = _browser(srv, key)
    return answer({"id": b.upload(str(body.get("name") or ""), str(body.get("data") or ""))})


@router.post("/browser/w/{key}/chosen")
def chosen(srv: Parts, key: Key, body: Object) -> Response:
    """{n, ids}: the files for its file chooser (none: closed) -> {given}."""
    b = _browser(srv, key)
    ids = body.get("ids") if isinstance(body.get("ids"), list) else []
    return answer({"given": b.chosen(int(body.get("n") or 0), ids)})


@router.post("/browser/w/{key}/drop")
def drop(srv: Parts, key: Key, body: Object) -> Response:
    """{x, y, ids}: those files dropped on the page there -> {given}."""
    b = _browser(srv, key)
    ids = body.get("ids") if isinstance(body.get("ids"), list) else []
    return answer({"given": b.drop(_num(body, "x") or 0.0, _num(body, "y") or 0.0, ids)})


@router.post("/browser/w/{key}/reveal")
def reveal(srv: Parts, key: Key, body: Object) -> Response:
    """{i}: a download, shown in its folder -> {}."""
    b = _browser(srv, key)
    b.reveal(int(body.get("i") or 0))
    return answer({})


@router.post("/browser/w/{key}/tab")
def tab(srv: Parts, key: Key, body: Object) -> Response:
    """{action: switch | close | new, index?, url?}: a tab switched to, closed, or opened -> {}."""
    b = _browser(srv, key)
    action, i = str(body.get("action") or ""), int(body.get("index") or 0)
    if action == "switch":
        b.switch(i)
    elif action == "close":
        b.close_tab(i)
    elif action == "new":
        b.new_tab(str(body.get("url") or ""))
    else:
        raise browser.BrowserError("switch, close or new")
    return answer({})


@router.post("/browser/w/{key}/where")
def where(srv: Parts, key: Key, body: Object) -> Response:
    """{i}: where the element of the agent's action i (the view's list of them) is on the screen now -> {box}, null if
    it is gone, in another tab, or out of view."""
    b = _browser(srv, key)
    return answer({"box": b.where(int(body.get("i") or 0))})


@router.post("/browser/w/{key}/{what}")
def other(srv: Parts, key: Key, what: Annotated[str, Path(pattern=r"^[a-z]+$")], body: Object) -> Response:
    """Nothing else: not found (once its body and the Browser are found good, as the routes above take them)."""
    _browser(srv, key)
    return not_found()


@router.post("/api/browser")
def create(srv: Parts, body: Body) -> Response:
    """{gatherer, cwd, harness?, model?}: a new Browser, its actor a new session of `harness` in the gatherer, in `cwd`
    (browser.py's `create`) -> {key, channel, ...}."""
    bs = _browsers(srv)
    if bs is None:
        return not_found()
    return answer(bs.create(str(body.get("gatherer") or ""), str(body.get("cwd") or ""),
                            str(body.get("harness") or harness_kit.DEFAULT), str(body.get("model") or "") or None))


@router.post("/api/browser/logins")
def logins(srv: Parts, body: Body) -> Response:
    """{action?: sites | import, sites?}: the user's Chrome's logins, for every Browser of the dashboard --
    browser.py's `login_sites`, the sites it has cookies for (Chrome asking the user to allow it); `import_logins`,
    those sites' cookies copied."""
    bs = _browsers(srv)
    if bs is None:
        return not_found()
    if body.get("action") == "import":
        return answer(bs.import_logins(body.get("sites") or []))
    return answer(bs.login_sites())
