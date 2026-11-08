"""The Editor app (ag_apps/editor/; app_kit/DESIGN.md step 7): set up as the Browser and DocWriter are -- one per Editor
started, on a folder, its tools its attached actor's -- its panel and its routes over the host's files shared live
(app_kit.docs; the routes' own tests are test_dashboard_editor*.py), and each git project's preview beside the file --
the command its Execute runs in the checkout of the file open, and what it makes -- kept as its events (each project's
by its repository, shared by the gatherer's Editors), set by the user (its panel) or an agent (its tools, `ag
preview`), an agent's command run only once the user lets it; its runs told to its panels, its files served on its own
origin. The run logic is tested directly (runs.py); the rest through the dashboard as its host, its tool gateway and its
server."""
import contextlib
import importlib.util
import io
import json
import os
import queue
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import app_host, libs, livedocs, server, tool_gateway  # noqa: E402
from app_kit import AppError, Caller  # noqa: E402
from test_dashboard import HomeBase  # noqa: E402
from test_dashboard_app_host import insert_here  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GIT_ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}


def load(name: str):
    """A module of the app's, by its file (the host imports them as a package of its own)."""
    spec = importlib.util.spec_from_file_location(f"editor_{name}", os.path.join(ROOT, "ag_apps", "editor", f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = load("runs")


def git(cwd, *args):
    subprocess.run(["git", "-C", cwd, *args], check=True, capture_output=True, env={**os.environ, **GIT_ENV})


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def project(root: str) -> tuple:
    """A git project at root/proj, with src/plot.py (which writes out.svg) committed: (repo, plot)."""
    repo = os.path.join(root, "proj")
    os.makedirs(os.path.join(repo, "src"))
    plot = os.path.join(repo, "src", "plot.py")
    with open(plot, "w") as fh:
        fh.write("import sys\nprint('drawing', sys.argv[1:])\nopen('out.svg', 'w').write('<svg xmlns=\"http://www.w3.org/2000/svg\"/>')\n")
    git(repo, "init", "-q")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "init")
    return repo, plot


class RunsBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.realpath(self.tmp.name)
        self.repo, self.plot = project(self.root)
        self.told = queue.Queue()
        self.runs = R.Runs(lambda run, name, value: self.told.put((name, value)), env=lambda: dict(os.environ))
        self.addCleanup(self.runs.close)

    def run_now(self, command, show="", file=None, by="", wait=20):
        r = self.runs.start(self.repo, self.repo, command, show, file, by)
        self.runs.wait(r, wait)
        return r

    def tex(self, rel, text):
        p = os.path.join(self.repo, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as fh:
            fh.write(text)
        return p


class PlaceTest(RunsBase):
    def test_a_worktree_shares_its_repository_and_runs_in_its_own_checkout(self):
        self.assertEqual(R.place(self.plot), (self.repo, self.repo))
        wt = os.path.join(self.root, "proj-worktrees", "b")
        git(self.repo, "worktree", "add", "-q", "-b", "b", wt)
        self.assertEqual(R.place(os.path.join(wt, "src", "plot.py")), (self.repo, wt))
        plain = os.path.join(self.root, "plain")
        os.makedirs(plain)
        self.assertEqual(R.place(plain), (plain, plain))
        with self.assertRaises(R.PreviewError):
            R.place(os.path.join(plain, "nowhere", "x.py"))

    def test_the_file_open_is_named_in_the_checkout_quoted_for_the_shell(self):
        spaced = os.path.join(self.repo, "my file.py")
        self.assertEqual(R.expand("python3 {file} > {stem}.txt", spaced, self.repo, quote=True),
                         "python3 'my file.py' > 'my file'.txt")
        self.assertEqual(R.expand("{dir}/{name} {stem}.pdf", self.plot, self.repo), "src/plot.py src/plot.pdf")
        self.assertEqual(R.expand("make", None, self.repo), "make")
        with self.assertRaisesRegex(R.PreviewError, "open a file first"):
            R.expand("python3 {file}", None, self.repo)
        with self.assertRaises(R.PreviewError):
            R.expand("{file}", "/etc/hosts", self.repo)

    def test_a_guess_by_the_file_open_else_by_the_project(self):
        self.assertEqual(R.guess(self.plot, self.repo), {"command": "python3 {file}", "show": ""})
        paper = self.tex("paper/paper.tex", "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n")
        self.assertEqual(R.guess(paper, self.repo), {"command": "latexmk -pdf -synctex=1 -cd -interaction=nonstopmode "
                                                                "paper/paper.tex", "show": "paper/paper.pdf"})
        self.assertEqual(R.guess("/x/index.html", self.repo), {"command": "", "show": "{file}"})
        with open(os.path.join(self.repo, "package.json"), "w") as fh:
            json.dump({"scripts": {"dev": "vite"}}, fh)
        self.assertEqual(R.guess("/x/App.jsx", self.repo), {"command": "npm run dev", "show": "http://localhost:5173"})
        self.assertEqual(R.guess(None, os.path.join(self.repo, "src")), {"command": "", "show": ""})

    def test_latex_s_guess_builds_the_document_s_main_file_whichever_of_its_files_is_open(self):
        doc = "\\documentclass{article}\n\\begin{document}\n%s\n\\end{document}\n"
        main = self.tex("paper/main.tex", doc % "\\input{intro}\n\\include{sections/method}")
        intro = self.tex("paper/intro.tex", "\\section{Intro}\n% \\documentclass in a comment is not one\n")
        method = self.tex("paper/sections/method.tex", "\\section{Method}\n")
        notes = self.tex("paper/notes.tex", "Loose notes, in no document.\n")
        for f in (main, intro, method, notes):
            self.assertEqual(R.tex_main(f, self.repo), main, f)
        want = {"command": "latexmk -pdf -synctex=1 -cd -interaction=nonstopmode paper/main.tex", "show": "paper/main.pdf"}
        self.assertEqual(R.guess(method, self.repo), want)
        self.assertEqual(R.guess(None, self.repo, os.path.join(self.repo, "paper")), want)
        slides = self.tex("paper/slides.tex", doc % "\\input{talk}")
        talk = self.tex("paper/talk.tex", "\\begin{frame}Hi\\end{frame}\n")
        self.assertEqual(R.tex_main(slides, self.repo), slides)
        self.assertEqual(R.tex_main(talk, self.repo), slides)
        fig = self.tex("paper/figs/plot.tex", "% !TeX root = ../slides.tex\n\\begin{tikzpicture}\\end{tikzpicture}\n")
        self.assertEqual(R.tex_main(fig, self.repo), slides)
        self.tex("paper/figs/plot.tex", "%!TEX root=/etc/hosts\n")
        self.assertEqual(R.tex_main(fig, self.repo), main)
        lone = self.tex("other/lone.tex", "\\section{Alone}\n")
        self.assertIsNone(R.tex_main(lone, self.repo))
        spaced = self.tex("my paper/a b.tex", doc % "Hi")
        self.assertEqual(R.guess(spaced, self.repo)["command"].split(" ", 5)[-1], "'my paper/a b.tex'")


class RunTest(RunsBase):
    def test_a_command_runs_in_the_checkout_and_shows_the_file_it_made(self):
        r = self.run_now("python3 {file} --fast", "out.svg", self.plot)
        self.assertEqual((r.state, r.code), ("done", 0))
        self.assertIn("drawing ['--fast']", r.text())
        shows = r.view()["shows"]
        self.assertEqual((shows["rel"], shows["kind"], shows["exists"]), ("out.svg", "svg", True))
        seen = []
        while not seen or seen[-1][0] != "ended":                       # told a moment after it is over
            seen.append(self.told.get(timeout=10))
        self.assertEqual(seen[0][0], "run")
        self.assertEqual(seen[-1], ("ended", r.view()))
        self.assertIn("drawing", "".join(v["text"] for n, v in seen if n == "out"))
        body, kind = self.runs.file(self.runs.token(self.repo), "out.svg")
        self.assertEqual(kind, "image/svg+xml; charset=utf-8")
        with self.assertRaises(PermissionError):
            self.runs.file(self.runs.token(self.repo), "../elsewhere/secret.txt")
        with self.assertRaises(FileNotFoundError):
            self.runs.file("0" * 16, "out.svg")

    def test_a_failure_says_its_exit_code(self):
        r = self.run_now("echo half; exit 3")
        self.assertEqual((r.state, r.code, r.text()), ("failed", 3, "half\n"))

    def test_a_long_command_is_stopped_and_a_new_run_stops_the_one_before(self):
        with mock.patch.object(R, "TIMEOUT", 0.5):
            r = self.run_now("sleep 30", wait=8)
        self.assertEqual(r.state, "timed out")
        first = self.runs.start(self.repo, self.repo, "sleep 30", "", None, "")
        second = self.run_now("echo next")
        self.assertEqual((first.state, second.state), ("stopped", "done"))

    def test_a_server_is_ready_once_its_url_answers_and_is_stopped_with_what_it_started(self):
        port = free_port()
        r = self.runs.start(self.repo, self.repo, f"sh -c 'sleep 0.5; exec python3 -m http.server {port} --bind 127.0.0.1'",
                            f"http://127.0.0.1:{port}/", None, "")
        self.runs.wait(r, 20)
        self.assertEqual(r.state, "ready")
        self.assertTrue(r.view()["server"])
        self.assertEqual([x.id for x in self.runs.servers()], [r.id])
        self.runs.end(self.repo, "stopped")
        self.assertEqual(r.state, "stopped")
        with self.assertRaises(OSError):
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2).close()

    def test_nothing_to_run_shows_what_it_shows_as_it_is(self):
        r = self.run_now("", "src/plot.py")
        self.assertEqual((r.state, r.view()["shows"]["kind"]), ("done", "text"))
        with self.assertRaises(R.PreviewError):
            self.runs.start(self.repo, self.repo, "", "../elsewhere.html", None, "")

    def test_a_run_is_not_given_the_agent_session_it_was_started_from(self):
        with mock.patch.dict(os.environ, {"CLAUDE_CODE_SESSION_ID": "x", "AG_ACTOR": "y", "KEEP_ME": "1",
                                          "ANTHROPIC_BASE_URL": "http://127.0.0.1:4122/h/live"}):
            env = R.run_env()
        self.assertNotIn("CLAUDE_CODE_SESSION_ID", env)
        self.assertNotIn("AG_ACTOR", env)
        self.assertNotIn("ANTHROPIC_BASE_URL", env)
        self.assertEqual(env["KEEP_ME"], "1")


class SyncTeXTest(RunsBase):
    def test_a_line_to_its_place_in_the_pdf_and_back(self):
        if not (shutil.which("pdflatex") and shutil.which("synctex")):
            self.skipTest("no pdflatex and synctex here")
        tex = os.path.join(self.repo, "paper.tex")
        with open(tex, "w") as fh:
            fh.write("\\documentclass{article}\n\\begin{document}\nFirst page.\n\\newpage\nSecond page, its own line.\n\\end{document}\n")
        subprocess.run(["pdflatex", "-synctex=1", "-interaction=nonstopmode", "paper.tex"], cwd=self.repo,
                       capture_output=True, timeout=120, stdin=subprocess.DEVNULL)
        there = R.synctex(self.repo, {"pdf": "paper.pdf", "mode": "forward", "file": tex, "line": 5})
        self.assertTrue(there["ok"], there)
        self.assertEqual(there["page"], 2)
        back = R.synctex(self.repo, {"pdf": "paper.pdf", "page": 2, "x": there["h"] + 5, "y": there["v"] - 2})
        self.assertEqual((back["ok"], back["file"], back["line"]), (True, "paper.tex", 5))
        os.remove(os.path.join(self.repo, "paper.synctex.gz"))
        self.assertEqual(R.synctex(self.repo, {"pdf": "paper.pdf", "page": 1, "x": 100, "y": 100}),
                         {"ok": False, "reason": "no-synctex"})
        with self.assertRaises(R.PreviewError):
            R.synctex(self.repo, {"pdf": "../elsewhere.pdf", "page": 1, "x": 1, "y": 1})


class AppBase(HomeBase):
    """The Editor as the dashboard hosts it: an AppHost on the test's home (gatherer `g`), the project in it."""

    def setUp(self):
        super().setUp()
        self.root = os.path.realpath(self.tmp.name)
        self.repo, self.plot = project(self.root)
        self.host = self.new_host()
        self.i = self.host.open("editor", "g", self.repo)

    def new_host(self):
        h = app_host.AppHost(0, write=insert_here)
        self.addCleanup(h.close)
        self.hosts.append(h)                                # closed before the home goes (HomeBase's tearDown)
        return h

    def call(self, tool, args, channel=None, host=None):
        got = (host or self.host).call("editor", self.i, f"preview_{tool}", args, Caller(channel=channel, gatherer="g"))
        text = "".join(c.get("text", "") for c in got.content)
        return {"error": text} if got.is_error else json.loads(text)


class AppTest(AppBase):
    def test_one_per_editor_started_on_a_folder_the_preview_by_repository(self):
        self.assertIn("editor", self.host.apps)
        self.assertNotIn("preview", self.host.apps)                       # the Editor's own now, not an app of its own
        m = self.host.apps["editor"].manifest
        self.assertEqual((m.instances, m.offer, m.agent.start), ("many", "attached", True))   # as the Browser's, DocWriter's
        self.assertEqual((self.i.folder, self.i.title), (self.repo, "proj"))
        src = self.host.open("editor", "g", os.path.join(self.repo, "src"))
        self.assertNotEqual(src.id, self.i.id)                            # another, on its own folder
        with self.assertRaises(AppError):
            self.host.open("editor", "g", os.path.join(self.root, "nowhere"))
        wt = os.path.join(self.root, "proj-worktrees", "b")
        git(self.repo, "worktree", "add", "-q", "-b", "b", wt)
        self.call("set", {"path": self.repo, "command": "echo hi"})
        self.assertEqual(self.call("show", {"path": wt})["preview"]["command"], "echo hi")   # its worktrees share it
        got = self.host.call("editor", src, "preview_show", {"path": self.repo}, Caller(gatherer="g"))
        self.assertEqual(json.loads(got.content[0]["text"])["preview"]["command"], "echo hi")   # and the other Editor

    def test_the_user_sets_and_runs_it(self):
        about = self.call("show", {"path": self.plot})
        self.assertEqual((about["preview"], about["guess"]["command"]), (None, "python3 {file}"))
        self.call("set", {"path": self.plot, "command": "python3 {file}", "show": "out.svg"})
        got = self.call("run", {"path": self.plot, "file": self.plot, "wait": 20})
        self.assertEqual(got["run"]["state"], "done")
        self.assertIn("drawing", got["output"])
        self.assertFalse(got["preview"]["needs_ok"])

    def test_an_agent_s_command_runs_only_once_the_user_lets_it(self):
        self.host.attach("g", self.i.id, "c1")
        self.call("set", {"path": self.repo, "command": "echo from-agent"}, channel="c1")
        refused = self.call("run", {"path": self.repo, "wait": 5}, channel="c1")
        self.assertIn("the user has not let this command run yet", refused["error"])
        self.assertIn("let it run first", self.call("run", {"path": self.repo, "wait": 5})["error"])       # asked first
        self.assertIn("let it run first", self.call("run", {"path": self.repo, "ok": "echo other"})["error"])
        forged = self.call("run", {"path": self.repo, "ok": "echo from-agent"}, channel="c1")    # only the user's
        self.assertIn("the user has not let this command run yet", forged["error"])
        self.assertEqual(self.call("run", {"path": self.repo, "ok": "echo from-agent", "wait": 10})["output"], "from-agent\n")
        again = self.call("run", {"path": self.repo, "wait": 10}, channel="c1")                # let run: it may now
        self.assertEqual((again["run"]["state"], again["run"]["by"]), ("done", "c1"))
        self.call("set", {"path": self.repo, "command": "echo other"}, channel="c1")
        self.assertTrue(self.call("show", {"path": self.repo})["preview"]["needs_ok"])          # another: asked again

    def test_what_it_keeps_is_its_events_read_back_by_a_new_host(self):
        self.host.attach("g", self.i.id, "c1")
        self.call("set", {"path": self.repo, "command": "echo hi"}, channel="c1")
        self.call("run", {"path": self.repo, "ok": "echo hi", "wait": 10})
        self.host.flush()
        deadline = time.time() + 10
        while time.time() < deadline and not self.host.read("editor", self.i, ["editor.preview_ran"]):
            time.sleep(0.1)
        got = self.host.read("editor", self.i, ["editor.preview_set", "editor.preview_allowed", "editor.preview_ran"])
        self.assertEqual([e["type"] for e in got], ["editor.preview_set", "editor.preview_allowed", "editor.preview_ran"])
        self.assertEqual({e["payload"]["key"] for e in got}, {self.repo})
        again = self.new_host()
        row = self.call("show", {"path": self.repo}, host=again)["preview"]
        self.assertEqual((row["command"], row["set_by"], row["needs_ok"]), ("echo hi", "c1", False))
        self.call("clear", {"path": self.repo}, host=again)
        self.assertIsNone(self.call("show", {"path": self.repo}, host=again)["preview"])

    def test_each_project_keeps_its_own(self):
        other, _ = project(os.path.join(self.root, "x"))
        self.call("set", {"path": self.repo, "command": "echo mine"})
        self.assertIsNone(self.call("show", {"path": other})["preview"])
        self.assertEqual(self.call("show", {"path": self.repo})["preview"]["command"], "echo mine")
        self.assertIn("which project", self.call("show", {})["error"])  # the user's call names its file, an agent's its cwd

    def test_its_panels_hear_each_run_and_a_server_none_shows_is_stopped(self):
        sub, leave = self.host.subscribe("editor", self.i, [])
        self.call("set", {"path": self.repo, "command": "echo told"})
        self.call("run", {"path": self.repo, "wait": 10})
        heard = []
        while not sub.queue.empty():
            heard.append(sub.queue.get()[1])
        self.assertTrue(any("preview" in m for m in heard))
        self.assertTrue(any(m.get("run", {}).get("state") == "done" for m in heard))
        self.assertIn("told", "".join(m["out"]["text"] for m in heard if "out" in m))
        leave()                                                          # no panel of it open any more
        port = free_port()
        backend = self.host.backend("editor")
        B = sys.modules[type(backend).__module__]
        self.call("set", {"path": self.repo, "command": f"exec python3 -m http.server {port} --bind 127.0.0.1",
                          "show": f"http://127.0.0.1:{port}/"})
        with mock.patch.object(B, "IDLE", 0.3), mock.patch.object(B, "TICK", 0.1):
            backend.closed.set()                                         # its watch started again, on the short clock
            backend.closed = threading.Event()
            threading.Thread(target=backend._idle, daemon=True).start()
            got = self.call("run", {"path": self.repo, "wait": 20})
            r = backend.runs.latest(got["checkout"])
            deadline = time.time() + 15
            while not r.over.is_set() and time.time() < deadline:
                time.sleep(0.1)
        self.assertEqual(r.state, "stopped")


class ServedBase(AppBase):
    """The Editor through the dashboard's server."""

    def setUp(self):
        super().setUp()
        self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        self.httpd.app_host._write_fn = insert_here
        self.hosts.append(self.httpd.app_host)
        self.rows = [{"session_id": "c1", "gatherer": "g", "cwd": self.repo, "harness": "claude"}]
        self.httpd.sessions.list = lambda: [dict(r) for r in self.rows]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.serving(self.httpd)                          # stopped before the home goes
        self.port = self.httpd.server_port
        self.url = f"http://127.0.0.1:{self.port}"
        self.h = self.httpd.app_host
        self.inst = self.h.open("editor", "g", self.repo)

    def at_app(self, path, method="GET", body=None, origin=None):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        headers = {"Host": f"editor.localhost:{self.port}"}
        if origin:
            headers["Origin"] = origin
        conn.request(method, path, body, headers)
        r = conn.getresponse()
        raw = r.read()
        conn.close()
        return r.status, dict(r.getheaders()), raw


class ServedTest(ServedBase):
    """The Editor through the dashboard's server: its panel and its own routes on its origin, the libraries it shares,
    the gateway's tools and `ag preview` in an agent's shell."""

    def test_its_panel_s_routes_on_its_own_origin(self):
        q = f"gatherer=g&instance={self.inst.id}"
        self.h.call("editor", self.inst, "preview_set", {"path": self.repo, "command": "python3 {file}", "show": "out.svg"},
                    Caller(gatherer="g"))
        self.h.call("editor", self.inst, "preview_run", {"path": self.plot, "file": self.plot, "wait": 20}, Caller(gatherer="g"))
        status, _, raw = self.at_app(f"/api/preview/about?path={urllib.parse.quote(self.plot)}&{q}")
        about = json.loads(raw)
        self.assertEqual((status, about["run"]["state"]), (200, "done"))
        self.assertIn("drawing", about["output"])
        status, headers, raw = self.at_app(f"/api/preview/files/{about['token']}/out.svg?{q}")
        self.assertEqual(status, 200)
        self.assertTrue(raw.startswith(b"<svg"))
        csp = " ".join(v for k, v in headers.items() if k.lower() == "content-security-policy")
        self.assertIn("sandbox", csp)                                      # a page it shows: no script of the panel's
        self.assertIn("frame-ancestors 'self'", csp)
        self.assertEqual(self.at_app(f"/api/preview/files/{about['token']}/..%2F..%2Fhome%2Fdashboard.db?{q}")[0], 403)
        self.assertEqual(self.at_app(f"/api/preview/files/{'0' * 16}/out.svg?{q}")[0], 404)

    def test_its_panel_its_page_s_helpers_and_the_editor_bundle(self):
        status, _, raw = self.at_app("/")
        self.assertEqual(status, 200)
        for script in (b"page.js", b"editor.js", b"preview.js", b"editor-start.js", b"/_ag/app.js"):
            self.assertIn(script, raw)
        status, _, raw = self.at_app("/vendor/editor.js")
        self.assertEqual(status, 200)
        self.assertIn(b"agEditor", raw)
        self.assertIn(b"hlLines", raw)                                    # the dashboard's highlighter, in its bundle

    def test_the_host_s_shared_files_are_its_own_by_its_manifest(self):
        from app_kit import AppError
        backend = self.h.backend("editor")
        self.assertTrue(backend.host.docs().available)
        got = backend.host.docs().listing(self.repo, self.repo)
        self.assertIn("src", [e["name"] for e in got["entries"]])
        docwriter = self.h.backend("docwriter")                          # an app that does not ask for them
        with self.assertRaises(AppError):
            docwriter.host.docs()

    def test_pdf_js_is_shared_with_its_panel_and_the_dashboard(self):
        if not os.path.isfile(os.path.join(libs.PDFJS, "web", "viewer.html")):
            self.skipTest("pdf.js (DocWriter's build) is not here")
        for path, kind in (("web/viewer.html", "text/html"), ("build/pdf.mjs", "text/javascript")):
            status, headers, _ = self.at_app(f"/_ag/lib/pdfjs/{path}")
            self.assertEqual(status, 200, path)
            self.assertTrue(headers["content-type"].startswith(kind), path)
            resp = urllib.request.urlopen(f"{self.url}/vendor/pdfjs/{path}")
            self.assertTrue(resp.headers["Content-Type"].startswith(kind), path)
        for outside in ("..%2Findex.html", "..%2F..%2Feditor.js", "nothing.js"):
            self.assertEqual(self.at_app(f"/_ag/lib/pdfjs/{outside}")[0], 404, outside)
        self.assertEqual(self.at_app("/_ag/lib/marked.min.js")[0], 200)

    def test_its_actor_has_its_tools_from_the_gateway_another_none(self):
        self.assertNotIn("editor_preview_run", [t["name"] for t in tool_gateway.tools("g", ("c1",))])
        self.h.attach("g", self.inst.id, "c1")                            # the actor it was started with
        names = [t["name"] for t in tool_gateway.tools("g", ("c1",))]
        self.assertIn("editor_preview_run", names)
        got = tool_gateway.call(self.rows, "c1", "editor_preview_show", {})
        self.assertIsNone(json.loads(got["content"][0]["text"])["preview"])           # its folder's project, by its cwd
        self.assertNotIn("user's Editor", tool_gateway.instructions("g", channels=("c1",)))   # its own, not the gatherer's

    def run_cli(self, *args):
        from ag.cli import preview as cli
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, {"AG_DASHBOARD": self.url, "CLAUDE_CODE_SESSION_ID": "c1"}), \
                redirect_stdout(out), redirect_stderr(err):
            for v in ("CODEX_THREAD_ID", "AG_ACTOR"):
                os.environ.pop(v, None)
            code = cli.main(["--repo", self.repo, *args])
        return code, out.getvalue(), err.getvalue()

    def test_an_agent_sets_shows_and_runs_it_with_ag_preview(self):
        self.h.attach("g", self.inst.id, "c1")                            # its Editor's actor
        code, out, _ = self.run_cli()
        self.assertEqual(code, 0)
        self.assertIn("No preview is set for", out)
        code, out, _ = self.run_cli("set", "python3", "{file}", "--show", "out.svg")
        self.assertEqual(code, 0)
        self.assertIn("runs:   python3 {file}", out)
        self.assertIn("set by you", out)
        self.assertIn("The user has not let this command run yet", out)
        code, _, err = self.run_cli("run", "--file", self.plot)
        self.assertEqual(code, 1)
        self.assertIn("the user has not let this command run yet", err)
        self.h.call("editor", self.inst, "preview_run", {"path": self.repo, "ok": "python3 {file}", "file": self.plot,
                                                          "wait": 20}, Caller(gatherer="g"))   # the user lets it run

        code, out, _ = self.run_cli("run", "--file", self.plot, "--wait", "20")
        self.assertEqual(code, 0)
        self.assertIn("done", out)
        self.assertIn(f"It shows {os.path.join(self.repo, 'out.svg')}.", out)
        self.assertIn("drawing []", out)
        code, out, _ = self.run_cli("clear")
        self.assertIn("is cleared", out)

    def test_every_actor_is_told_of_ag_preview(self):
        from ag.ag_policies.proactive_context_manager.config import ProactiveContextManagerConfig
        guide = ProactiveContextManagerConfig().gatherer_guide
        self.assertIn("`ag preview set", guide)


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(livedocs.AVAILABLE, "pycrdt is not installed")
class EditToolsTest(ServedBase):
    """Its agents' tools -- editor_read, editor_edit, editor_write, editor_open -- on files open in it and not, as its
    mode says (live, review, handsoff); the guard on Claude Code's own edit tools; the agent told what the user chose."""

    def setUp(self):
        super().setUp()
        self.h.attach("g", self.inst.id, "c1")
        self.told = []
        insert = self.h.insert

        def kept(name, instance, events, channel=None):
            self.told += [(e, channel) for e in events if e.get("type") == "context_stream"]
            return insert(name, instance, events, channel)
        self.h.insert = kept
        self.own = f"http://editor.localhost:{self.port}"
        self.q = f"gatherer=g&instance={self.inst.id}"

    def tool(self, name, args, actor="c1"):
        got = tool_gateway.call(self.rows, actor, f"editor_{name}", args)
        return ("error: " if got.get("isError") else "") + "".join(c.get("text", "") for c in got["content"])

    def post(self, path, body):
        status, _, raw = self.at_app(f"/api/{path}?{self.q}", "POST", json.dumps(body), origin=self.own)
        got = json.loads(raw)
        self.assertEqual(status, 200, got)
        return got

    def disk(self):
        with open(self.plot) as fh:
            return fh.read()

    def opened(self, conn="p1"):
        """The file open in the Editor's panel: its stream, read until the end of the test."""
        q = urllib.parse.urlencode({"path": self.plot, "root": self.repo, "conn": conn, "client": 1})
        req = urllib.request.Request(f"{self.url}/api/edit/stream?{self.q}&{q}",
                                     headers={"Host": f"editor.localhost:{self.port}"})
        resp = urllib.request.urlopen(req, timeout=10)
        self.addCleanup(resp.close)
        got = queue.Queue()

        def read():
            name = None
            try:
                for raw in resp:
                    line = raw.decode().rstrip("\n")
                    if line.startswith("event: "):
                        name = line[7:]
                    elif line.startswith("data: "):
                        got.put((name, json.loads(line[6:])))
            except Exception:                        # noqa: BLE001 - closed
                pass
        threading.Thread(target=read, daemon=True).start()
        self.assertEqual(got.get(timeout=10)[0], "init")
        deadline = time.time() + 5                   # kept as the Editor's page
        while time.time() < deadline and not self.h.backend("editor").file_mode(self.plot):
            time.sleep(0.02)
        return got

    def test_a_file_no_editor_has_open_is_read_and_written_on_disk(self):
        new = os.path.join(self.repo, "notes", "a.md")
        self.assertIn("Made", self.tool("write", {"path": "notes/a.md", "content": "one\ntwo\n"}))   # from its folder
        with open(new) as fh:
            self.assertEqual(fh.read(), "one\ntwo\n")
        self.assertIn("Wrote", self.tool("edit", {"path": new, "old_string": "two", "new_string": "three"}))
        self.assertEqual(self.tool("read", {"path": new}), "     1\tone\n     2\tthree")
        self.assertIn("is in", self.tool("edit", {"path": self.plot, "old_string": "'", "new_string": '"'}))   # twice
        self.assertIn("not in", self.tool("edit", {"path": new, "old_string": "nine", "new_string": "ten"}))
        self.assertIsNone(self.h.guard("g", "c1", new))                   # its own tools may change it

    def test_live_its_edit_lands_in_the_open_file_and_on_disk_and_its_own_edit_tool_is_pointed_there(self):
        self.opened()
        self.assertIn("editor_edit", self.h.guard("g", "c1", self.plot))
        said = self.tool("edit", {"path": self.plot, "old_string": "print('drawing'", "new_string": "print('drew'"})
        self.assertIn("shows as it lands", said)
        self.assertIn("print('drew'", self.disk())
        self.assertIn("Open in the user's Editor (Live)", self.tool("read", {"path": self.plot}))
        self.assertIsNone(self.h.guard("g", "c2", self.plot))             # an actor not attached: its own tools

    def test_review_its_edit_is_a_proposal_and_it_is_told_what_the_user_chose(self):
        self.opened()
        self.post("mode", {"mode": "handsoff"})
        self.assertFalse(self.told)                  # an agent that has not used its tools: told by them, not now
        self.tool("read", {"path": self.plot})
        self.assertEqual(self.post("mode", {"mode": "review"})["mode"], "review")
        self.assertIn("set the Editor to Review", self.told[-1][0]["payload"]["text"])
        self.assertEqual(self.told[-1][1], "c1")
        was = self.disk()
        said = self.tool("edit", {"path": self.plot, "old_string": "import sys", "new_string": "import os, sys"})
        self.assertIn("Proposed", said)
        self.assertIn("Do not wait for the user: carry on with your task", said)   # proposed, and on it goes
        self.assertEqual(self.disk(), was)                                # until the user accepts
        self.assertIn("import os, sys", self.tool("read", {"path": self.plot}))   # its own, in
        self.assertIn("Review", self.h.guard("g", "c1", self.plot))
        state = self.post("edit/settle_all", {"path": self.plot, "root": self.repo, "take": "theirs", "channel": "c1"})
        self.assertFalse(state["conflicts"])
        self.assertTrue(self.disk().startswith("import os, sys\n"))
        self.assertIn("The user accepted the change you proposed", self.told[-1][0]["payload"]["text"])
        self.tool("edit", {"path": self.plot, "old_string": "import os, sys", "new_string": "import sys"})
        (c,) = [c for c in self.h.docs.state(self.plot, self.repo)["conflicts"]]
        self.post("edit/settle", {"path": self.plot, "root": self.repo, "conflict": c["id"], "take": "mine"})
        self.assertTrue(self.disk().startswith("import os, sys\n"))
        self.assertIn("rejected", self.told[-1][0]["payload"]["text"])
        self.assertEqual(self.h.backend("editor").mode(self.inst), "review")          # kept: its event
        self.h.backend("editor").modes.clear()
        self.assertEqual(self.h.backend("editor").mode(self.inst), "review")

    def test_hands_off_it_is_refused_and_a_write_around_it_is_asked_about(self):
        self.opened()
        self.post("mode", {"mode": "handsoff"})
        self.assertIn("ask the user first", self.h.guard("g", "c1", self.plot))
        self.assertIn("Ask them first", self.tool("edit", {"path": self.plot, "old_string": "import sys",
                                                            "new_string": "import os"}))
        with open(self.plot, "a") as fh:            # a shell's write, around the tools
            fh.write("# appended\n")
        deadline = time.time() + 10
        while time.time() < deadline and not self.h.docs.state(self.plot, self.repo)["conflicts"]:
            time.sleep(0.05)
        (c,) = self.h.docs.state(self.plot, self.repo)["conflicts"]
        self.assertEqual((c["asked"], c["theirs"]), (True, "# appended\n"))
        self.post("edit/settle", {"path": self.plot, "root": self.repo, "conflict": c["id"], "take": "mine"})
        self.assertNotIn("# appended", self.disk())                      # put back
        self.post("mode", {"mode": "live"})                              # merged again
        self.assertFalse(self.h.docs.state(self.plot, self.repo)["asking"])

    def test_open_shows_the_file_in_its_panel(self):
        self.assertIn("not open now", self.tool("open", {"path": self.plot, "line": 2}))
        with mock.patch.object(self.h, "panels_of", return_value=1), mock.patch.object(self.h, "tell") as tell:
            self.assertIn("Shown", self.tool("open", {"path": self.plot, "line": 2}))
        self.assertEqual(tell.call_args[0][1], {"show": {"path": self.plot, "line": 2}})
