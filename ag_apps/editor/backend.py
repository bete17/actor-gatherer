"""The Editor app (app.toml): a folder's files, each text file edited live -- shared with every other page that has it
open and with the file on disk, as the host shares them (app_kit.docs: Host.docs()) -- any other file shown, and
beside the file the project's preview (runs.py): a command run in the checkout, set by the user in the panel or by an
agent with its tools (or `ag preview`), run by either, and what it makes.

Moved from the dashboard as it was: its routes (api/editor.py's /api/edit/..., /api/branches, /api/files/changes)
are its panel's requests of this backend now, on the app's own origin; the Preview app's tools and runs are its own.
The panel's requests, each answered as JSON ({error} with a status, refused):

    edit/list, about, raw/<path>, files, choose, reveal, create     the folders, a file's kind and bytes, Go to
                                                                    file's list, the system's dialogs, a new file
    edit/stream, update, aware, save, settle, zone/clear            a file open (app_kit.docs: its events)
    edit/settle_all                                                 an actor's changes held there, all taken or not
    mode                                                            the Editor's mode: GET it, POST {mode}
    branches, branches/approve, branches/decide                     the actors on branches of the project shown
    files/changes                                                   an actor's changes to the file open
    preview/about, preview/files/<token>/<rel>, preview/synctex     the project's preview and what it made

Each Editor is on a folder (its instance's), started with an actor of its own, as the Browser and DocWriter are.

Its agents change files with its tools (`read`, `edit`, `write`, `open`: editor_*), not their own -- Claude Code's
Edit and Write on a file open in an Editor are refused (`guard`, the host's edit_guard), pointing at editor_edit. A
file no Editor has open is read and written on disk, whatever the mode. One open in one is changed through the host's
live documents, as its MODE says -- the strictest of the Editors that have it open:

    live        the change lands at once, in the agent's hue, and is written to the file; what meets the lines the
                user is editing (the conflict zone) is held for them, in a box (docs.put "live")
    review      each change a proposal, shown in place, the user accepting or rejecting it when they choose -- the
                file on disk as it was until they accept (docs.put "propose"); the agent does not wait for them: it
                carries on, reading the file with its proposals in, and is told what they chose when they do
    handsoff    refused: the user is editing it, the agent to ask them first

In review and handsoff, a write that does not come through the tools -- a shell command's, another harness's edit
tool's -- is asked about too, not merged in (docs.hold "ask"): Reject puts the user's lines back on the file. The
agent that made a change held is told what the user chose (a context_stream message, `_told_settled`); one attached to
an Editor that has used its file tools, when its mode changes (another learns it from its tools' answers, or the
guard, when it next changes a file: a message to an agent that never started would list it as one with a
conversation).

    editor.mode             {mode, by}: the Editor's mode (live until one is set)

The preview's settings are its events, each with the repository it is for (`key`), shared by the gatherer's Editors open:

    editor.preview_set      {key, command, show, by}: set by the user (by "") or an agent (its channel)
    editor.preview_allowed  {key, command}: a command an agent set, let run by the user
    editor.preview_cleared  {key}: none any more
    editor.preview_ran      {key, checkout, command, show, by, file, state, code, started, ended}: a run, once over

Who may run what: the user, anything -- a command an agent set, once they let it run (the panel's "Run it", which
passes it as `ok`: a call by an agent passing it is refused). An agent, only the command the user set or let run.
The panel hears of each run as it goes (`tell_panel`): {"run": view}, {"out": {id, text, reset?}}, {"preview":
{key, row}}. A server no panel has shown for IDLE is stopped. A LaTeX build's view, once it ends, has its problems
(runs.problems: from its log), which the panel lists and marks on the file's lines; an agent running it is told its
errors and warnings as `file:line: message` (runs.said_problems)."""

import base64
import json
import os
import tempfile
import threading
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import unquote

from app_kit import App, AppError, Caller, Instance, Response, ToolResult, context_stream

from . import chooser
from . import runs as R

USER = ""                   # `by` of what the user did, in the panel
IDLE = 600.0                # seconds a server is kept running with no Editor open
TICK = 30.0                 # seconds between looks for such a server
TAIL = 4000                 # the most characters of a run's output an agent's `preview_run` is told
EVENTS = ("editor.preview_set", "editor.preview_allowed", "editor.preview_cleared")
MODES = ("live", "review", "handsoff")      # strictest last
MODE_SAID = {"live": "Live", "review": "Review", "handsoff": "Hands off"}
STREAM = "Editor"                           # what the agents' messages from it say they come from
READ_LINES = 2000                           # the most lines editor_read gives at once
MAX_WRITE = 2_000_000                       # the largest file its tools write
TOLD_TEXT = 1500                            # the most characters of lines the user wrote in that an agent is told
RAW_HEADERS = {"cache-control": "no-cache", "x-content-type-options": "nosniff", "content-security-policy": "sandbox"}


def _body(raw: bytes) -> dict:
    try:
        got = json.loads(raw or b"{}")
    except ValueError:
        raise AppError("a JSON object, please") from None
    if not isinstance(got, dict):
        raise AppError("a JSON object, please")
    return got


def _b64(text) -> bytes:
    try:
        return base64.b64decode(str(text or ""), validate=True)
    except ValueError:
        raise AppError("an update in base64, please") from None


def _said(got: dict, by: str) -> dict:
    """A tool's answer about the preview, as an agent is told it: a LaTeX build's problems as `file:line: message`."""
    run = got.get("run")
    if by != USER and run and "problems" in run:
        got = {**got, "run": {**run, "problems": R.said_problems(run["problems"])}}
    return got


def _opt(body: dict, key: str) -> Optional[str]:
    return body[key] if isinstance(body.get(key), str) else None


class EditorApp(App):
    def start(self, host) -> None:
        super().start(host)
        self.runs = R.Runs(self._told)
        self.rows: Dict[Tuple[str, str], Optional[dict]] = {}   # (gatherer, repository) -> its preview (None: none)
        self.keys: Dict[str, Instance] = {}                      # repository -> the instance last asked of it
        self.lock = threading.Lock()
        self.closed = threading.Event()
        self.modes: Dict[str, str] = {}                          # instance id -> its mode, as its events say
        self.pages: Dict[str, Dict[str, tuple]] = {}             # a file open (real path) -> {conn: (instance id, root)}
        self.used: set = set()                                   # the agents that used its file tools (channels)
        threading.Thread(target=self._idle, name="editor-preview-idle", daemon=True).start()

    def stop(self) -> None:
        self.closed.set()
        self.runs.close()

    def open(self, instance: Instance, args: dict) -> Instance:
        """An Editor on a folder: the one it shows first (its title, the folder's name)."""
        folder = instance.folder or ""
        if not os.path.isdir(folder):
            raise AppError(f"no directory {folder or '(none)'}: the Editor shows a folder")
        return Instance(id=instance.id, app=instance.app, gatherer=instance.gatherer, folder=instance.folder,
                        title=os.path.basename(folder.rstrip("/")) or folder, data=dict(instance.data))

    def _editors(self, gatherer: str):
        """The gatherer's Editors open (the host's instances of this app)."""
        return [i for i in self.host.instances() if i.gatherer == gatherer]

    # -- its panel's requests

    def request(self, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                body: bytes) -> Response:
        here = query.get("_here") == "1"
        try:
            if path.startswith("preview/"):
                return self._preview_request(instance, method, path[len("preview/"):], query, body)
            if path.startswith("edit/raw/"):
                return self._raw("/" + unquote(path[len("edit/raw/"):]).lstrip("/"), query)
            if path == "edit/stream" and method == "GET":
                return self._stream(instance, query)
            if path == "mode":
                if instance is None:
                    raise AppError("which Editor? (its gatherer and instance)", 404)
                if method == "POST":
                    self.set_mode(instance, str(_body(body).get("mode") or ""))
                return Response.json({"mode": self.mode(instance), "modes": list(MODES)})
            if path in ("edit/settle", "edit/settle_all") and method == "POST":
                return Response.json(self._settle(path, _body(body)))
            if method == "GET":
                return Response.json(self._get(path, query, here))
            if method == "POST":
                return Response.json(self._post(path, _body(body), here))
        except chooser.Busy as exc:
            return Response.json({"error": str(exc)}, 409)
        except chooser.ChooseError as exc:
            return Response.json({"error": str(exc)}, 400)
        except R.PreviewError as exc:
            return Response.json({"error": str(exc)}, 400)
        except AppError as exc:
            if path == "edit/list":                 # a folder that cannot be listed can still be left by the dialog
                return Response.json({"error": str(exc), "choose": chooser.name() if here else None}, exc.status)
            return Response.json({"error": str(exc)}, exc.status)
        return Response.json({"error": f"{path}: no such request"}, 404)

    def _get(self, path: str, q: Dict[str, str], here: bool):
        docs = self.host.docs()
        if path == "edit/list":
            return {**docs.listing(q.get("dir", ""), q.get("root", "")), "choose": chooser.name() if here else None}
        if path == "edit/about":
            return {**docs.about(q.get("path", ""), q.get("root", "")), "reveal": chooser.shower() if here else None}
        if path == "edit/files":
            return docs.files(q.get("dir", ""), q.get("root", ""))
        if path == "branches":
            return docs.branches(q.get("root", ""))
        if path == "files/changes":
            try:
                since = float(q.get("since") or 0)
            except ValueError:
                raise AppError("since: seconds, please") from None
            return docs.changes(q.get("gatherer", ""), q.get("channel", ""), q.get("path", ""), since,
                                q.get("cwd", ""))
        raise AppError(f"{path}: no such request", 404)

    def _post(self, path: str, b: dict, here: bool):
        docs = self.host.docs()
        p, root = str(b.get("path") or ""), str(b.get("root") or "")
        if path == "edit/update":
            return docs.edit(p, root, str(b.get("conn") or ""), _b64(b.get("update")))
        if path == "edit/aware":
            docs.aware(p, root, str(b.get("conn") or ""), _b64(b.get("update")))
            return {}
        if path == "edit/save":
            return docs.save(p, root)
        if path == "edit/zone/clear":
            return docs.clear_zone(p, root)
        if path == "edit/create":
            return docs.create(p, root, bool(b.get("dir")))
        if path == "edit/reveal":
            if not here:
                raise chooser.ChooseError("It would open on the dashboard's machine, not this one")
            chooser.reveal(docs.resolve(p, root))
            return {}
        if path == "edit/choose":
            if not here:
                raise chooser.ChooseError("The dialog would open on the dashboard's machine, not this one")
            return {"path": chooser.choose(str(b.get("what") or ""), str(b.get("start") or ""))}
        if path == "branches/approve":
            docs.approve(str(b.get("session_id") or ""), bool(b.get("approve")))
            return {}
        if path == "branches/decide":
            docs.decide(str(b.get("session_id") or ""), p, str(b.get("take") or ""))
            return {}
        raise AppError(f"{path}: no such request", 404)

    def _raw(self, path: str, q: Dict[str, str]) -> Response:
        """The bytes of the file, as the host's `about` says to serve them -- by its path, so what it names beside it
        (a page's images) is found beside it: inline (an image, a PDF for pdf.js, a video, in ranges), or (download)
        to be saved. Sandboxed: a page or an SVG opened here runs nothing that reaches the dashboard or the panel."""
        got = self.host.docs().about(path, q.get("root") or "/")
        return Response.file_at(got["real"], got["type"], got["name"], bool(q.get("download")), RAW_HEADERS)

    def _stream(self, instance: Optional[Instance], q: Dict[str, str]) -> Response:
        """The file opened by the page (app_kit.docs's `open`), its events until it goes; `failed` if it cannot be.
        Kept as one of its Editor's pages while it is open: how it takes the file's changes on disk is its mode's."""
        client, path, root, conn = q.get("client", ""), q.get("path", ""), q.get("root", ""), q.get("conn", "")
        docs = self.host.docs()
        try:
            hold = "ask" if instance is not None and self.mode(instance) != "live" else "merge"
            joined = docs.open(path, root, conn, int(client) if client.isdigit() else 0, hold)
            real = docs.resolve(path, root)
        except AppError as exc:
            said = [[("failed", {"error": str(exc)})]]
            return Response.stream(lambda wait: said.pop() if said else None)
        with self.lock:
            self.pages.setdefault(real, {})[conn] = (instance.id if instance else "", root)

        def close() -> None:
            with self.lock:
                got = self.pages.get(real, {})
                got.pop(conn, None)
                if not got:
                    self.pages.pop(real, None)
            joined.close()
        return Response.stream(joined.take, close)

    # -- its mode

    def mode(self, instance: Instance) -> str:
        """The Editor's mode, as its events say (live until one is set)."""
        with self.lock:
            if instance.id in self.modes:
                return self.modes[instance.id]
        got = self.host.read(instance, ["editor.mode"], limit=5000)
        mode = next((e["payload"].get("mode") for e in reversed(got) if (e["payload"] or {}).get("mode") in MODES),
                    "live")
        with self.lock:
            self.modes[instance.id] = mode
        return mode

    def set_mode(self, instance: Instance, mode: str, by: str = USER) -> None:
        """The Editor's mode, set: kept as its event, its pages' hold on their files changed to it, its panels and
        its agents told."""
        if mode not in MODES:
            raise AppError(f"mode {mode!r}: {', '.join(MODES)}")
        if mode == self.mode(instance):
            return
        with self.lock:
            self.modes[instance.id] = mode
            mine = [(real, conn, root) for real, got in self.pages.items() for conn, (i, root) in got.items()
                    if i == instance.id]
        self.host.insert(instance, [{"type": "editor.mode", "payload": {"mode": mode, "by": by}}])
        docs = self.host.docs()
        for real, conn, root in mine:
            try:
                docs.hold(real, root, conn, "merge" if mode == "live" else "ask")
            except AppError:
                pass                                # closed meanwhile
        try:
            self.host.tell_panel(instance, {"mode": mode})
        except AppError:
            pass
        said = {"live": "Live: your edits to files open there (editor_edit, editor_write) land at once, shown to the "
                        "user as they land, and are written to the file; one to lines the user is editing is held "
                        "for them to settle.",
                "review": "Review: your edits to files open there (editor_edit, editor_write) are proposals the user "
                          "accepts or rejects in their own time -- propose and carry on with your task, without "
                          "waiting for them. The file on disk changes only when they accept; editor_read shows your "
                          "proposals in, so your next edits build on them.",
                "handsoff": "Hands off: do not change files open there; ask the user first (editor_edit and "
                            "editor_write refuse them)."}[mode]
        for channel in self.host.attached(instance):
            if channel not in self.used:
                continue
            try:
                self.host.insert(instance, [context_stream(STREAM, "the user",
                                                           f"The user set the Editor to {said}")], channel)
            except AppError:
                pass

    def _open_in(self, real: str) -> List[Tuple[Instance, str]]:
        """The Editors that have the file open now, each with the folder its page opened it under."""
        with self.lock:
            got = dict(self.pages.get(real, {}))
        by_id = {i.id: i for i in self.host.instances()}
        out, seen = [], set()
        for i, root in got.values():
            if i in by_id and i not in seen:
                seen.add(i)
                out.append((by_id[i], root))
        return out

    def file_mode(self, real: str) -> Optional[str]:
        """How an agent's change to the file lands: the strictest mode of the Editors that have it open; None, no
        Editor has it open (its tools write the file on disk)."""
        modes = [self.mode(i) for i, _ in self._open_in(real)]
        return max(modes, key=MODES.index) if modes else None

    # -- the project's preview, from its events

    def row(self, instance: Instance, key: str) -> Optional[dict]:
        """The project's preview, as the gatherer's Editors' events say, the latest last."""
        with self.lock:
            if (instance.gatherer, key) in self.rows:
                return self.rows[(instance.gatherer, key)]
        row: Optional[dict] = None
        found = [e for i in self._editors(instance.gatherer) or [instance] for e in self.host.read(i, list(EVENTS), limit=5000)]
        for e in sorted(found, key=lambda e: e["row_id"]):
            p = e["payload"] or {}
            if p.get("key") != key:
                continue
            if e["type"] == "editor.preview_set":
                row = {"command": p.get("command", ""), "show": p.get("show", ""), "set_by": p.get("by", USER),
                       "set_at": p.get("at", 0), "allowed": p.get("command") if p.get("by", USER) == USER else
                       (row or {}).get("allowed")}
            elif e["type"] == "editor.preview_allowed" and row is not None and row["command"] == p.get("command"):
                row["allowed"] = p["command"]
            elif e["type"] == "editor.preview_cleared":
                row = None
        with self.lock:
            self.rows[(instance.gatherer, key)] = row
        return row

    @staticmethod
    def shown(row: Optional[dict]) -> Optional[dict]:
        """The preview as said: `needs_ok` with it -- a command an agent set that the user has not let run yet."""
        if row is None:
            return None
        return {**row, "needs_ok": bool(row["command"]) and row["set_by"] != USER and row["allowed"] != row["command"]}

    def _keep(self, instance: Instance, key: str, kind: str, payload: dict, row: Optional[dict]) -> None:
        with self.lock:
            self.rows[(instance.gatherer, key)] = row
        self.host.insert(instance, [{"type": kind, "payload": {"key": key, **payload, "at": time.time()}}])
        self._tell(instance.gatherer, {"preview": {"key": key, "row": self.shown(row)}})

    def _tell(self, gatherer: str, message: dict) -> None:
        """`message` to the panels of the gatherer's Editors (each takes what is its project's)."""
        for i in self._editors(gatherer):
            try:
                self.host.tell_panel(i, message)
            except AppError:
                pass

    def place(self, instance: Instance, path: Optional[str]) -> tuple:
        """(key, checkout) of the path: its repository (its worktrees share its preview), and the checkout holding it."""
        if not path:
            raise R.PreviewError("which project? a file or folder of it, please")
        key, checkout = R.place(path)
        with self.lock:
            self.keys[key] = instance
        return key, checkout

    def about(self, instance: Instance, path: Optional[str]) -> dict:
        key, checkout = self.place(instance, path)
        row = self.shown(self.row(instance, key))
        p = os.path.realpath(path) if path else None
        file = p if p and os.path.isfile(p) else None
        run = self.runs.latest(checkout)
        return {"key": key, "checkout": checkout, "name": os.path.basename(key) or key,
                "git": R.repository(checkout) is not None, "preview": row,
                "guess": R.guess(file, checkout, None if file else (p or checkout)) if row is None else None,
                "run": run.view() if run else None, "token": self.runs.token(checkout)}

    # -- its agents' own edit tools, on a file open in it

    def guard(self, instance: Instance, path: str, caller: Caller) -> Optional[str]:
        real = os.path.realpath(os.path.expanduser(path or ""))
        mode = self.file_mode(real)
        if mode is None:
            return None
        if mode == "handsoff":
            return (f"{path} is open in the user's Editor, set to Hands off: do not change it; ask the user first.")
        return (f"{path} is open in the user's Editor: change it with editor_edit (or editor_write for the whole "
                f"file) instead, so your change goes through the Editor"
                + (" -- shown to the user as it lands." if mode == "live" else
                   " -- it is set to Review: your change is a proposal the user reviews in their own time, and you "
                   "carry on meanwhile."))

    # -- its tools

    def call(self, instance: Instance, tool: str, args: dict, caller: Caller) -> ToolResult:
        if tool in ("read", "edit", "write", "open"):
            if caller.channel:
                self.used.add(caller.channel)
            try:
                return getattr(self, f"_tool_{tool}")(instance, args, caller)
            except AppError as exc:
                return ToolResult.error(str(exc))
        by = USER if caller.channel is None else caller.channel
        path = str(args.get("path") or "") or (caller.folder if caller.channel else "") or None
        try:
            if tool == "preview_show":
                return ToolResult.json(_said(self.about(instance, path), by))
            if tool == "preview_set":
                key, _ = self.place(instance, path)
                command, show = str(args.get("command") or "").strip(), str(args.get("show") or "").strip()
                if not command and not show:
                    raise R.PreviewError("a command to run, or what to show, or both")
                if "\n" in show:
                    raise R.PreviewError("what to show is one path, or one URL")
                old = self.row(instance, key)
                row = {"command": command, "show": show, "set_by": by, "set_at": time.time(),
                       "allowed": command if by == USER else (old or {}).get("allowed")}
                self._keep(instance, key, "editor.preview_set", {"command": command, "show": show, "by": by}, row)
                return ToolResult.json(_said(self.about(instance, path), by))
            if tool == "preview_clear":
                key, _ = self.place(instance, path)
                self._keep(instance, key, "editor.preview_cleared", {}, None)
                return ToolResult.json(_said(self.about(instance, path), by))
            if tool == "preview_run":
                return ToolResult.json(_said(self.run(instance, path, args, by), by))
            if tool == "preview_stop":
                _, checkout = self.place(instance, path)
                self.runs.end(checkout, "stopped")
                return ToolResult.json(_said(self.about(instance, path), by))
        except R.PreviewError as exc:
            return ToolResult.error(str(exc))
        raise AppError(f"{tool}: no such tool")

    def _path(self, args: dict, caller: Caller) -> str:
        """The tool's file: absolute, or from the agent's folder; its links followed."""
        p = str(args.get("path") or args.get("file_path") or "").strip()
        if not p:
            raise AppError("which file? (path)")
        p = os.path.expanduser(p)
        if not os.path.isabs(p):
            p = os.path.join(caller.folder or os.getcwd(), p)
        return os.path.realpath(p)

    def _where(self, real: str) -> Tuple[Optional[str], Optional[str]]:
        """(mode, root) of the file: as its Editors open it, else (None, None) -- not open in one."""
        got = self._open_in(real)
        if not got:
            return None, None
        return max((self.mode(i) for i, _ in got), key=MODES.index), got[0][1]

    def _tool_read(self, instance: Instance, args: dict, caller: Caller) -> ToolResult:
        real = self._path(args, caller)
        mode, root = self._where(real)
        note = ""
        if mode is not None:
            text = self.host.docs().view(real, root, caller.channel if mode == "review" else None)
            mine = sum(1 for c in self.host.docs().state(real, root)["conflicts"] if _held_by(c, caller.channel))
            note = (f"Open in the user's Editor ({MODE_SAID[mode]}): as it is there, with what they typed and have "
                    f"not saved" + (f"; your {mine} change{'s' if mine != 1 else ''} waiting for them shown in"
                                    if mine and mode == "review" else
                                    f"; {mine} change{'s' if mine != 1 else ''} of yours held for them, not in"
                                    if mine else "") + ".")
        else:
            text = _read_file(real)
        lines = text.splitlines()
        try:
            start = max(int(args.get("offset") or 1), 1)
            n = max(int(args.get("limit") or READ_LINES), 1)
        except (TypeError, ValueError):
            raise AppError("offset and limit: line numbers") from None
        shown = lines[start - 1:start - 1 + n]
        body = "\n".join(f"{k:>6}\t{line}" for k, line in enumerate(shown, start))
        more = len(lines) - (start - 1 + len(shown))
        tail = f"\n({more} more lines: offset {start + len(shown)})" if more > 0 else ""
        return ToolResult.text((note + "\n" if note else "") + (body or "(empty)") + tail)

    def _tool_edit(self, instance: Instance, args: dict, caller: Caller) -> ToolResult:
        real = self._path(args, caller)
        old, new = args.get("old_string"), args.get("new_string")
        if not isinstance(old, str) or not isinstance(new, str):
            raise AppError("old_string and new_string, please")
        if old == new:
            raise AppError("old_string and new_string are the same: nothing to change")
        every = bool(args.get("replace_all"))

        def edited(text: str) -> str:
            if not old:
                raise AppError("old_string is empty: to write a whole file, editor_write")
            n = text.count(old)
            if n == 0:
                raise AppError(f"old_string is not in {real}" + (" as it is in the Editor: read it again"
                                                                  if self._where(real)[0] else ""))
            if n > 1 and not every:
                raise AppError(f"old_string is in {real} {n} times: give more of the lines around it to say which, "
                               f"or replace_all")
            return text.replace(old, new) if every else text.replace(old, new, 1)
        return self._change(instance, real, edited, caller)

    def _tool_write(self, instance: Instance, args: dict, caller: Caller) -> ToolResult:
        real = self._path(args, caller)
        content = args.get("content")
        if not isinstance(content, str):
            raise AppError("content, please: the whole file")
        return self._change(instance, real, lambda text: content, caller, create=True)

    def _change(self, instance: Instance, real: str, edited, caller: Caller, create: bool = False) -> ToolResult:
        """An agent's change to the file -- `edited(text)`, the whole of it as the agent wants it -- as its mode says
        (module doc)."""
        mode, root = self._where(real)
        if mode is None:                            # no Editor has it open: on disk
            exists = os.path.isfile(real)
            if not exists and not create:
                raise AppError(f"{real}: no such file (editor_write makes one)")
            text = _read_file(real) if exists else ""
            wanted = edited(text)
            if len(wanted.encode("utf-8")) > MAX_WRITE:
                raise AppError(f"too large: the most it writes is {MAX_WRITE} bytes")
            _write_file(real, wanted)
            return ToolResult.text(f"{'Wrote' if exists else 'Made'} {real}: no Editor has it open, so it is written "
                                   f"on disk.")
        if mode == "handsoff":
            raise AppError(f"{real} is open in the user's Editor, set to Hands off: they are editing it. Ask them "
                           f"first.")
        docs = self.host.docs()
        how = "propose" if mode == "review" else "live"
        seen = docs.view(real, root, caller.channel if how == "propose" else None)
        wanted = edited(seen)
        if len(wanted.encode("utf-8")) > MAX_WRITE:
            raise AppError(f"too large: the most it writes is {MAX_WRITE} bytes")
        by = {"gatherer": caller.gatherer, "channel": caller.channel, "via": "editor", "instance": instance.id}
        got = docs.put(real, root, seen, wanted, by, how)
        if how == "propose":
            n = len(got["proposed"])
            return ToolResult.text(
                f"Proposed: {real} is open in the user's Editor, set to Review, so your change is a proposal there "
                f"({n} of yours in this file now). Do not wait for the user: carry on with your task. They review "
                f"proposals in their own time, and you are told what they choose when they do. Your next edits build "
                f"on it (editor_read shows the file with your proposals in); until they accept, the file on disk is "
                f"without it, so a test or build you run sees it as it was.")
        said = f"Edited {real}: it is open in the user's Editor, where your change shows as it lands"
        if got["landed"]:
            said += ", and it is written to the file"
        if got["held"]:
            k = len(got["held"])
            said += (f". {k} of your changes touch lines the user is editing: held for them to settle, not in the "
                     f"file yet. You will be told what they choose")
        return ToolResult.text(said + ".")

    def _tool_open(self, instance: Instance, args: dict, caller: Caller) -> ToolResult:
        real = self._path(args, caller)
        if not os.path.exists(real):
            raise AppError(f"{real}: no such file")
        try:
            line = int(args.get("line") or 0)
        except (TypeError, ValueError):
            raise AppError("line: a line number") from None
        if self.host.panels(instance) == 0:
            raise AppError("the user's Editor is not open now: say where to look instead")
        self.host.tell_panel(instance, {"show": {"path": real, "line": line}})
        return ToolResult.text(f"Shown in the user's Editor: {real}" + (f", line {line}" if line else "") + ".")

    # -- a change held, settled by the user: its agent told

    def _settle(self, path: str, b: dict) -> dict:
        """A conflict settled (edit/settle) -- or every change of one actor's held in the file (edit/settle_all:
        {take: theirs or mine, channel}) -- the agent whose changes they were told what the user chose."""
        docs = self.host.docs()
        p, root = str(b.get("path") or ""), str(b.get("root") or "")
        held = {c["id"]: c for c in docs.state(p, root)["conflicts"]}
        if path == "edit/settle":
            ids = [str(b.get("conflict") or "")]
        else:
            channel = _opt(b, "channel")
            ids = [c["id"] for c in held.values() if _held_by(c, channel) and (c["agent"] or {}).get("why") == "approve"]
        take, state, done, failed = str(b.get("take") or ""), None, [], ""
        for cid in ids:
            try:
                state = docs.settle(p, root, cid, take, _opt(b, "text"), _opt(b, "theirs"), _opt(b, "mine"))
                done.append(cid)
            except AppError as exc:
                if path == "edit/settle":
                    raise
                failed = str(exc)                   # (one changed since: the rest still settled)
        if state is None:
            state = docs.state(p, root)
        if failed:
            state = {**state, "error": failed}
        real = docs.resolve(p, root)
        for cid in done:
            c = held.get(cid)
            if c is not None and _held_by(c, None):
                self._told_settled(real, c, take, _opt(b, "text"))
        return state

    def _told_settled(self, real: str, c: dict, take: str, text: Optional[str]) -> None:
        """The agent whose change `c` was told what the user chose -- in its Editor, if it is still attached."""
        a = c["agent"] or {}
        i = next((x for x in self.host.instances() if x.id == a.get("instance")), None)
        if i is None or a.get("channel") not in self.host.attached(i):
            i = next((x for x in self.host.instances() if a.get("channel") in self.host.attached(x)), None)
        if i is None:
            return
        what = "proposed" if a.get("why") == "approve" else "made to lines they were editing"
        lines = (c.get("theirs") or "").strip("\n").splitlines()
        first = lines[0][:80] if lines else "(a deletion)"
        said = {"theirs": "accepted", "mine": "rejected",
                "both": "kept both their lines and yours, yours after theirs, for", "edited": "edited, then accepted"}
        msg = f"The user {said.get(take, take)} the change you {what} in {real} (\"{first}\"...)."
        if take == "edited" and text is not None:
            msg += f" It reads now:\n{text[:TOLD_TEXT]}"
        if take == "mine":
            msg += " The file keeps its lines there."
        try:
            self.host.insert(i, [context_stream(STREAM, "the user", msg)], a["channel"])
        except AppError:
            pass

    def run(self, instance: Instance, path: Optional[str], args: dict, by: str) -> dict:
        key, checkout = self.place(instance, path)
        row = self.shown(self.row(instance, key))
        if row is None:
            raise R.PreviewError(f"no preview is set for {key}: set one (editor_preview_set, or `ag preview set`), "
                                 f"or in the Editor")
        if row["needs_ok"]:
            if by != USER:
                who = "the user" if row["set_by"] == USER else f"actor {row['set_by']}"
                raise R.PreviewError(f"the user has not let this command run yet ({row['command']!r}, set by {who}): "
                                     f"they are asked when they next run it in the Editor, and once they let it run, "
                                     f"your run runs it too")
            if args.get("ok") != row["command"]:
                raise R.PreviewError("this command was set by an agent: let it run first")
            allowed = {**self.row(instance, key), "allowed": row["command"]}
            self._keep(instance, key, "editor.preview_allowed", {"command": row["command"]}, allowed)
        file = str(args.get("file") or "") or None
        if file is None and path and os.path.isfile(path):
            file = os.path.realpath(path)
        r = self.runs.start(key, checkout, row["command"], row["show"], file, by)
        try:
            wait = min(float(args.get("wait") or 0), 600.0)
        except (TypeError, ValueError):
            wait = 0.0
        if wait > 0:
            self.runs.wait(r, wait)
        got = self.about(instance, path)
        got["run"], got["output"] = r.view(), r.text()[-TAIL:]
        return got

    def _preview_request(self, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                         body: bytes) -> Response:
        if instance is None:
            return Response.json({"error": "which Editor? (its gatherer and instance)"}, 404)
        if path == "about":
            got = self.about(instance, query.get("path") or None)
            r = self.runs.latest(got["checkout"])
            got["output"] = r.text() if r else ""
            got["dropped"] = r.dropped if r else 0
            return Response.json(got)
        if path.startswith("files/"):
            token, _, rel = path[len("files/"):].partition("/")
            try:
                data, kind = self.runs.file(token, unquote(rel))
            except FileNotFoundError:
                return Response(404, b"not found")
            except PermissionError as exc:
                return Response(403, str(exc).encode())
            headers = {"Content-Type": kind}
            if kind.startswith(("text/html", "image/svg+xml", "application/xhtml")):
                headers["Content-Security-Policy"] = "sandbox allow-scripts allow-forms allow-modals allow-popups"
            return Response(200, data, headers)
        if path == "synctex" and method == "POST":
            ask = _body(body)
            _, checkout = self.place(instance, ask.get("path") or None)
            return Response.json(R.synctex(checkout, ask))
        return Response(404, b"not found")

    # -- runs, told and kept

    def _told(self, run: "R.Run", name: str, value: dict) -> None:
        with self.lock:
            instance = self.keys.get(run.key)
        if instance is None:
            return
        if name == "ended":
            self.host.insert(instance, [{"type": "editor.preview_ran", "payload": {"key": run.key, **{
                k: value.get(k) for k in ("checkout", "command", "show", "by", "file", "state", "code", "started",
                                          "ended")}}}])
            return
        self._tell(instance.gatherer, {name: value})

    def _idle(self) -> None:
        """A server no Editor of its project has shown for IDLE: stopped."""
        while not self.closed.wait(TICK):
            now = time.time()
            for r in self.runs.servers():
                with self.lock:
                    instance = self.keys.get(r.key)
                try:
                    shown = instance is not None and any(self.host.panels(i) > 0 for i in self._editors(instance.gatherer))
                except AppError:
                    shown = False
                if shown:
                    r.unwatched = None
                elif r.unwatched is None:
                    r.unwatched = now
                elif now - r.unwatched > IDLE:
                    self.runs._kill(r, "stopped")



def _held_by(c: dict, channel: Optional[str]) -> bool:
    """Whether a conflict of the file's state is an actor's change put in through an Editor -- that actor's."""
    a = c.get("agent") or {}
    return bool(a.get("put") and a.get("via") == "editor" and (channel is None or a.get("channel") == channel))


def _read_file(real: str) -> str:
    try:
        with open(real, "rb") as fh:
            raw = fh.read(MAX_WRITE + 1)
    except FileNotFoundError:
        raise AppError(f"{real}: no such file") from None
    except IsADirectoryError:
        raise AppError(f"{real} is a folder") from None
    except OSError as exc:
        raise AppError(f"{real}: {exc.strerror or exc}") from None
    if len(raw) > MAX_WRITE:
        raise AppError(f"{real} is too large to read here ({MAX_WRITE} bytes at most)")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        raise AppError(f"{real} is not UTF-8 text") from None


def _write_file(real: str, text: str) -> None:
    """`text` written in place of the file (whoever reads it meanwhile reads all of the old or all of the new), its
    mode kept; the folders above it made."""
    folder = os.path.dirname(real)
    os.makedirs(folder, exist_ok=True)
    try:
        mode = os.stat(real).st_mode & 0o7777
    except FileNotFoundError:
        mode = 0o644
    fd, temp = tempfile.mkstemp(prefix="." + os.path.basename(real) + ".", suffix=".ag-edit", dir=folder)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(text.encode("utf-8"))
        os.chmod(temp, mode)
        os.replace(temp, real)
    except BaseException:
        if os.path.exists(temp):
            os.unlink(temp)
        raise
