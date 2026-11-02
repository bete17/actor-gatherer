"""The dashboard's server before and after its move to FastAPI, compared: both run on one home (tests/web_home.py's, a
folder of recorded sessions, unless HOME is given), each asked every GET route of the old server's list -- with good
parameters and bad ones -- and the writes that change nothing (refused, or not found), and their answers compared: status,
content type, body (JSON as data, less `now` -- the time each was read -- and a preview's `token`).

    python tests/compare_servers.py [HOME] [--old REV]

The old server is server.py as it was at REV (default: the newest commit whose server.py has http.server's handler),
loaded from git beside the new one. Prints each request with what differs; exits 1 if any differs but those
`EXPECTED` says why."""
import argparse
import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import types
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tests"))

#: (method, path) -> why its answer differs, by design.
EXPECTED = {
    ("HEAD", "/api/home"): "a method neither serves: 501 both, http.server's its HTML error page, the new one's plain text",
    ("OPTIONS", "/api/home"): "a method neither serves: 501 both, http.server's its HTML error page, the new one's plain text",
}


def old_server_source(rev):
    """server.py at `rev`; None: the newest commit's that has http.server's handler."""
    def show(r):
        return subprocess.run(["git", "-C", ROOT, "show", f"{r}:ag_dashboard/server.py"], capture_output=True,
                              text=True, check=True).stdout
    if rev:
        return show(rev)
    log = subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "--", "ag_dashboard/server.py"],
                         capture_output=True, text=True, check=True).stdout.split()
    for r in log:
        src = show(r)
        if "BaseHTTPRequestHandler" in src:
            return src
    raise SystemExit("no commit has http.server's handler in ag_dashboard/server.py")


def old_server(source):
    """The old server module, beside the package's own (its relative imports the package's)."""
    import ag_dashboard
    mod = types.ModuleType("ag_dashboard.server_before_fastapi")
    mod.__file__ = os.path.join(os.path.dirname(ag_dashboard.__file__), "server.py")   # its static/ and vendor/
    mod.__package__ = "ag_dashboard"
    sys.modules[mod.__name__] = mod
    exec(compile(source, mod.__file__, "exec"), mod.__dict__)   # noqa: S102 - our own file, from git
    return mod


def ask(port, method, path, headers=None, body=None):
    """(status, content type, body bytes) of one request."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    try:
        h = {"Host": f"127.0.0.1:{port}", **(headers or {})}
        conn.request(method, path, body=body, headers=h)
        r = conn.getresponse()
        return r.status, r.getheader("Content-Type"), r.read()
    finally:
        conn.close()


def comparable(kind, body):
    """The body as compared: JSON as data, without `now` (when it was read) and `token` (a preview's: each server
    makes its own); else the bytes."""
    if kind and kind.startswith("application/json"):
        try:
            value = json.loads(body)
        except ValueError:
            return body

        def strip(v):
            if isinstance(v, dict):
                return {k: strip(x) for k, x in v.items() if k not in ("now", "token")}
            if isinstance(v, list):
                return [strip(x) for x in v]
            return v
        return strip(value)
    return body


def requests(home_dir):
    """What to ask: (method, path, headers, body), every GET route of the old list with good parameters and bad."""
    from ag_dashboard import data, server
    q = urllib.parse.quote
    h = data.home([])
    g = h["gatherers"][0]["name"]
    agents = h["gatherers"][0]["agents"]
    c = agents[0]["channel"]
    c2 = agents[-1]["channel"]
    ag = data.agent(g, c)
    read_id = ag["reads"][-1]["read_id"] if ag.get("reads") and "read_id" in ag["reads"][-1] else 1
    rows = data.transcript(g, c)["items"]
    row = next((i["row_id"] for i in rows if i["row_id"] is not None), 1)
    built = server.page()
    asset = (built.split('src="/assets/', 1)[1].split('"', 1)[0]) if 'src="/assets/' in built else "none.js"
    style = (built.split('href="/assets/', 1)[1].split('"', 1)[0]) if 'href="/assets/' in built else "none.css"
    repo = ROOT
    local_only = ["/api/edit/list?dir=" + q(ROOT) + "&root=" + q(ROOT), f"/api/edit/place?gatherer={g}&channel={c}",
                  f"/api/projects?gatherer={g}", "/api/branches?root=" + q(ROOT), "/api/preview?path=" + q(repo),
                  "/preview/0123456789abcdef/x.html"]
    gets = [
        "/", "/index.html", f"/assets/{asset}", f"/assets/{style}", "/assets/nope.js", "/assets/..%2Findex.html",
        "/assets/", "/api/home", "/avatars/animal/bear.svg", "/avatars/animal/bear.svg?bare=1",
        "/avatars/animal/bear.svg?bare=", "/avatars/nope/x.svg", "/avatars/.svg", "/avatars/animal/bear.png",
        f"/api/agent?gatherer={g}&channel={c}", f"/api/agent?gatherer={g}&channel={c2}", f"/api/agent?gatherer={g}",
        f"/api/agent?channel={c}", f"/api/agent?gatherer={g}&channel=", f"/api/agent?gatherer=&channel={c}",
        f"/api/agent?gatherer=nope&channel={c}", f"/api/agent?gatherer={g}&channel=nope",
        f"/api/agent?gatherer={g}&channel={c}&channel=nope", f"/api/agent?gatherer={g}&gatherer=nope&channel={c}",
        f"/api/read?gatherer={g}&read_id={read_id}", f"/api/read?gatherer={g}&read_id=x",
        f"/api/read?gatherer={g}&read_id=-1", f"/api/read?gatherer={g}&read_id=", f"/api/read?gatherer={g}&read_id=+1",
        f"/api/read?gatherer={g}&read_id=%201", f"/api/read?gatherer={g}&read_id=999999", f"/api/read?read_id=1",
        f"/api/context?gatherer={g}&read_id={read_id}", f"/api/context?gatherer={g}&read_id=1.5",
        f"/api/history?gatherer={g}&channel={c}&from=1&to=5", f"/api/history?gatherer={g}&channel={c}&from=1",
        f"/api/history?gatherer={g}&channel={c}&from=1&to=", f"/api/history?gatherer={g}&channel={c}&from=1&to=x",
        f"/api/history?gatherer={g}&channel={c}", f"/api/history?gatherer={g}&channel={c}&from=x",
        f"/api/transcript?gatherer={g}&channel={c}", f"/api/transcript?gatherer={g}&channel={c}&after=1",
        f"/api/transcript?gatherer={g}&channel={c}&before={row + 5}", f"/api/transcript?gatherer={g}&channel={c}&after=",
        f"/api/transcript?gatherer={g}&channel={c}&after=x", f"/api/transcript?gatherer={g}&channel={c}&before=-2",
        f"/api/transcript?gatherer={g}",
        f"/api/files?gatherer={g}&channel={c}", f"/api/files?gatherer={g}&channel={c}&turn=1",
        f"/api/files?gatherer={g}&channel={c}&turn=1&cwd=/w/demo", f"/api/files?gatherer={g}&channel={c}&turn=x",
        f"/api/files?gatherer={g}&channel={c2}&turn=",
        f"/api/files/changes?gatherer={g}&channel={c}&path=/w/demo/a.py&since=0",
        f"/api/files/changes?gatherer={g}&channel={c}&path=/w/demo/a.py&since=1.5&cwd=/w/demo",
        f"/api/files/changes?gatherer={g}&channel={c}&path=/w/demo/a.py&since=.5",
        f"/api/files/changes?gatherer={g}&channel={c}&path=/w/demo/a.py&since=.",
        f"/api/files/changes?gatherer={g}&channel={c}&path=/w/demo/a.py&since=x",
        f"/api/files/changes?gatherer={g}&channel={c}&since=1",
        "/api/monitor?actors=" + q(json.dumps([[g, c, "/w/demo"], [g, c2], ["", "x"], "no"])), "/api/monitor",
        "/api/monitor?actors=not-json", "/api/monitor?actors=" + q(json.dumps({"a": 1})),
        f"/api/image?gatherer={g}&row_id={row}&id=x", f"/api/image?gatherer={g}&row_id=x&id=x",
        f"/api/image?gatherer={g}&row_id={row}",
        f"/api/outline?gatherer={g}", f"/api/outline?gatherer={g}&channel={c}", f"/api/outline?gatherer={g}&after=3",
        f"/api/outline?gatherer={g}&after=x", f"/api/outline?gatherer={g}&channel=", "/api/outline",
        f"/api/event?gatherer={g}&row_id={row}", f"/api/event?gatherer={g}&row_id=x", f"/api/event?gatherer={g}",
        f"/api/search?gatherer={g}&q=the", f"/api/search?gatherer={g}&channel={c}&q=parser", f"/api/search?gatherer={g}",
        f"/api/search?q=the", f"/api/extracts?gatherer={g}", "/api/extracts",
        "/api/terminal?session_id=nope", "/api/terminal",
        "/api/sessions", "/api/models?harness=claude", "/api/models?harness=codex", "/api/models", "/api/models?harness=x",
        "/api/views", "/views/mine.js", "/views/nope.js", "/views/../x.js", "/api/settings",
        "/vendor/marked.min.js", "/vendor/purify.min.js", "/vendor/xterm.js", "/vendor/addon-fit.js",
        "/vendor/addon-webgl.js", "/vendor/xterm.css", "/vendor/editor.js", "/vendor/nope.js", "/vendor/marked.LICENSE.md",
        "/vendor/pdfjs/build/pdf.mjs", "/vendor/pdfjs/web/viewer.html", "/vendor/pdfjs/../index.html", "/vendor/pdfjs/nope",
        *local_only, f"/api/projects?gatherer={g}&dirs=" + q(json.dumps([ROOT])), "/api/projects",
        f"/api/projects?gatherer={g}&dirs=bad", "/api/edit/place?gatherer=g", "/api/preview?path=/no/such",
        "/api/preview", "/api/edit/list", "/api/edit/list?dir=/no/such&root=/",
        "/api/preview/stream?path=/no/such",
        "/api/edit/stream?path=x&root=/", "/api/edit/stream?path=/etc/hosts&root=" + q(ROOT) + "&conn=c&client=x",
        "/preview/", "/preview/abc", "/preview/0123456789abcdef/",
        "/docwriter/w/0123456789abcdef/dw", "/docwriter/w/0123456789abcdef/", "/docwriter/w/0123456789abcdef",
        "/docwriter/w/0123456789abcdef/preview", "/docwriter/w/0123456789abcdef/assets/nope.js",
        "/docwriter/w/0123456789abcdef/pdfjs/web/viewer.html", "/docwriter/w/0123456789abcdef/mcp",
        "/docwriter/w/0123456789abcdef/kv?names=" + q('["a"]'), "/docwriter/w/0123456789abcdef/kv?names=x",
        "/docwriter/w/0123456789abcdef/api/files", "/docwriter/w/0123456789abcdef/api/preview?path=x",
        "/docwriter/w/0123456789abcdef/nope", "/docwriter/w/0123456789abcdeF/dw", "/docwriter/w/xyz/dw",
        "/docwriter/w/", "/docwriter/w/0123456789abcdef/stream?conn=",
        "/browser/w/0123456789abcdef/stream", "/browser/w/xyz/stream", "/browser/w/0123456789abcdef/nope",
        "/docwriter-mark.svg", "/nope", "/api/home/", "/api/nope", "/api", "//api/home",
    ]
    out = [("GET", p, {}, None) for p in gets]
    out += [("GET", p, {"Host": "evil.example"}, None) for p in local_only + ["/api/home"]]
    out += [("GET", "/api/edit/list?dir=" + q(ROOT) + "&root=" + q(ROOT), {"Host": "localhost:1"}, None)]
    js = {"Content-Type": "application/json"}
    evil = {**js, "Origin": "http://evil.example"}
    out += [
        ("POST", "/api/stop", {**js, "Origin": "http://evil.example"}, b'{"session_id": "x"}'),
        ("POST", "/api/stop", {"Content-Type": "text/plain"}, b'{"session_id": "x"}'),
        ("POST", "/api/stop", {**js, "Host": "evil.example"}, b'{"session_id": "x"}'),
        ("POST", "/api/stop", js, b"not json"),
        ("POST", "/api/stop", js, b"[1, 2]"),
        ("POST", "/api/stop", js, b""),
        ("POST", "/api/stop", {**js, "Content-Length": "40000000"}, b"{}"),
        ("POST", "/api/stop", {**evil, "Content-Length": "40000000"}, b"{}"),
        ("POST", "/api/discard", js, b'{"session_id": "nope"}'),
        ("POST", "/api/answer", js, b'{"session_id": "nope"}'),
        ("POST", "/api/actors/nope", js, b'{"actor": "x"}'),
        ("POST", "/api/actors/", js, b"{}"),
        ("POST", "/api/preview/nope", js, b'{"path": "/no/such"}'),
        ("POST", "/api/preview/show", js, b'{"path": "/no/such"}'),
        ("POST", "/api/edit/update", js, b'{"path": "x", "root": "/", "conn": "c", "update": "!!"}'),
        ("POST", "/api/edit/save", js, b'{"path": "x", "root": "/"}'),
        ("POST", "/api/history/delete", js, b'{"id": "../nope"}'),
        ("POST", "/api/nope", js, b"{}"),
        ("POST", "/api/home", js, b"{}"),
        ("POST", "/browser/w/0123456789abcdef/nav", js, b'{"url": "x"}'),
        ("POST", "/browser/w/0123456789abcdef/nav", js, b"not json"),
        ("POST", "/browser/w/0123456789abcdef/nope", js, b"{}"),
        ("POST", "/browser/w/xyz/nav", js, b"{}"),
        ("POST", "/browser/w/0123456789abcdef/nav", evil, b"{}"),
        ("POST", "/browser/w/0123456789abcdef/mcp", js, b"not json"),
        ("POST", "/browser/w/0123456789abcdef/nav", {**js, "Content-Length": "40000000"}, b"{}"),
        ("POST", "/docwriter/w/0123456789abcdef/doc/join", js, b"not json"),
        ("POST", "/docwriter/w/0123456789abcdef/doc/join", js, b'{"conn": "c", "tab": "t"}'),
        ("POST", "/docwriter/w/0123456789abcdef/nope", js, b"{}"),
        ("POST", "/docwriter/w/0123456789abcdef/mcp", js, b"not json"),
        ("POST", "/docwriter/w/0123456789abcdef/api/files", js, b"{}"),
        ("POST", "/docwriter/w/0123456789abcdef/doc/join", evil, b"{}"),
        ("PUT", "/docwriter/w/0123456789abcdef/api/files", js, b"{}"),
        ("DELETE", "/docwriter/w/0123456789abcdef/api/session", {"Origin": "http://evil.example"}, b"{}"),
        ("PATCH", "/docwriter/w/0123456789abcdef/doc/join", {}, b"{}"),
        ("PUT", "/api/home", js, b"{}"),
        ("DELETE", "/api/sessions", js, b""),
        ("HEAD", "/api/home", {}, None),
        ("OPTIONS", "/api/home", {"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"}, None),
    ]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("home", nargs="?", help="a home to serve (default: tests/web_home.py's, built in a temporary folder)")
    ap.add_argument("--old", help="the git revision of the old server.py")
    a = ap.parse_args()
    for name in ("ANTHROPIC_BASE_URL", "AG_ACTOR", "AG_DASHBOARD"):     # never this session's own
        os.environ.pop(name, None)
    tmp = None
    if a.home:
        home_dir = os.path.abspath(a.home)
    else:
        import web_home
        tmp = tempfile.mkdtemp(prefix="ag-compare-")
        home_dir = web_home.build(os.path.join(tmp, "ag"))
    try:
        os.environ["AG_HOME"] = home_dir
        from ag_dashboard import home as dashboard_home
        from ag_dashboard import server
        dashboard_home.HOME = home_dir
        views = os.path.join(home_dir, "dashboard", "views")
        os.makedirs(views, exist_ok=True)
        with open(os.path.join(views, "mine.js"), "w") as fh:
            fh.write("export default {};\n")
        old_mod = old_server(old_server_source(a.old))
        old = old_mod.serve("127.0.0.1", 0, live_updates=False)
        new = server.serve("127.0.0.1", 0, live_updates=False)
        for s in (old, new):
            threading.Thread(target=s.serve_forever, daemon=True).start()
        differ = expected = 0
        try:
            for method, path, headers, body in requests(home_dir):
                got = [ask(s.server_port, method, path, headers, body) for s in (old, new)]
                (s1, k1, b1), (s2, k2, b2) = got
                diffs = []
                if s1 != s2:
                    diffs.append(f"status {s1} -> {s2}")
                if k1 != k2:
                    diffs.append(f"type {k1!r} -> {k2!r}")
                if comparable(k1, b1) != comparable(k2, b2):
                    diffs.append(f"body {b1[:120]!r} -> {b2[:120]!r}")
                head = f"{method} {path}" + (f" {headers}" if headers else "")
                if not diffs:
                    print(f"same  {s1} {head}")
                elif (method, path.split("?")[0]) in EXPECTED:
                    expected += 1
                    print(f"KNOWN {head}: {'; '.join(diffs)} ({EXPECTED[(method, path.split('?')[0])]})")
                else:
                    differ += 1
                    print(f"DIFF  {head}: {'; '.join(diffs)}")
        finally:
            for s in (old, new):
                s.shutdown()
                s.server_close()
        total = len(requests(home_dir))
        print(f"\n{total} requests: {total - differ - expected} the same, {expected} different as expected, "
              f"{differ} different")
        return 1 if differ else 0
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
