"""NOTIFICATIONS an app sends the user (app_kit's notices.py, Host.notify; the dashboard's app_host.py, api/apps.py,
data.py's `app_notices`): what one may say, which are open from an instance's records -- as an agent's `asked` is
until its `ask_settled` -- the host's checks (the `notify` capability), its records, the routes, an app in its own
process sending one, the page told as each is written, and no agent ever shown one."""
import json
import os
import sqlite3
import sys
import threading
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag.ag_harness.store import operations as store  # noqa: E402
from ag_dashboard import app_host, data, home as dashboard_home, server  # noqa: E402
import app_kit  # noqa: E402
from app_kit import AppError, notices  # noqa: E402
from channels import ch  # noqa: E402
from test_dashboard_app_host import BACKEND, NOTES, ROOT, HostBase, insert_here, write_app  # noqa: E402

BELL = NOTES.replace('name = "notes"', 'name = "bell"').replace('label = "Notes"', 'label = "Bell"').replace(
    "notes.added", "bell.added").replace('reads = ["user_message"]', 'reads = ["user_message"]\nnotify = true').replace(
    "[[events]]", """[[tools]]
name = "ring"
description = "Notify the user."
input_schema = { type = "object", properties = { title = { type = "string" } } }

[[tools]]
name = "hush"
description = "Clear a notification."
input_schema = { type = "object", properties = { which = { type = "string" } } }

[[events]]""")

#: A backend that notifies the user from a tool call ("ring") and clears one ("hush") -- run in its own process too.
BELL_BACKEND = BACKEND.replace("notes.added", "bell.added").replace('''        raise AppError("no such tool")''', '''        if tool == "ring":
            return ToolResult.text(self.host.notify(instance, args["title"], args.get("text", ""), args.get("key"),
                                                    args.get("show", ["ag"]), args.get("where")))
        if tool == "hush":
            self.host.clear_notice(instance, args["which"])
            return ToolResult.text("hushed")
        raise AppError("no such tool")''')
assert BELL_BACKEND != BACKEND

FAR_BELL = BELL.replace('name = "bell"', 'name = "far_bell"').replace(
    'python = "backend:NotesApp"', f'command = ["{sys.executable}", "-m", "app_kit.remote", "backend:NotesApp"]'
).replace("bell.added", "far_bell.added")


class MadeTest(unittest.TestCase):
    """What one may say, as the host checks it before recording it."""

    def test_a_title_one_line_each_and_show_where_it_pops_up(self):
        got = notices.made("  New message\nfrom Leo ", "a\n\nline", key="dm:leo", show=["system", "ag"], where={"c": "D1"})
        self.assertEqual((got["title"], got["text"], got["key"], got["show"], got["where"]),
                         ("New message from Leo", "a line", "dm:leo", ["ag", "system"], {"c": "D1"}))
        self.assertEqual(len(got["id"]), 12)
        self.assertEqual(notices.made("x")["show"], ["ag"])                 # popped up in the dashboard, by default
        self.assertEqual(notices.made("x", show=["system"])["show"], ["system"])
        self.assertEqual(notices.made("x", show=())["show"], [])             # quiet: only listed
        self.assertTrue(notices.made("t" * 500)["title"].endswith("…"))
        self.assertEqual(len(notices.made("t" * 500)["title"]), app_kit.manifest.NOTICE_TITLE_CHARS)

    def test_what_is_refused(self):
        for args, says in [(("",), "a title"), ((None,), "a title"), ((5,), "title is text"),
                           (("t", "", None, ["loud"]), "show is some of"), (("t", "", "", ["ag"]), "a key is text"),
                           (("t", "", None, ["ag"], {"x": "y" * 5000}), "at most"),
                           (("t", "", None, ["ag"], {1, 2}), "where is JSON")]:
            with self.subTest(args=args), self.assertRaises(AppError) as ctx:
                notices.made(*args)
            self.assertIn(says, str(ctx.exception))

    def test_settled_by_its_id_or_by_a_key(self):
        self.assertEqual(notices.settled("0123456789ab", "cleared"), {"id": "0123456789ab", "how": "cleared"})
        self.assertEqual(notices.settled("dm:leo", "dismissed"), {"key": "dm:leo", "how": "dismissed"})
        with self.assertRaises(AppError):
            notices.settled("  ", "cleared")


class StillOpenTest(unittest.TestCase):
    """Which are open, from an instance's records in order: as an agent's `asked` until its `ask_settled`."""

    def n(self, id_, key=None, at=1.0):
        return ("app_notified", "i1", {"id": id_, "key": key, "title": f"t{id_}", "text": "", "show": ["ag"],
                                       "where": None, "at": at})

    def test_settled_replaced_closed(self):
        open_ = notices.still_open([self.n("a"), self.n("b", "k", 2.0), self.n("c", "k", 3.0), self.n("d", at=4.0),
                                    ("app_notice_settled", "i1", {"id": "a", "how": "cleared"})])
        self.assertEqual([x["id"] for x in open_["i1"]], ["c", "d"])          # b's place taken by c, of its key
        self.assertEqual(notices.newest(open_["i1"]), 4.0)
        by_key = notices.still_open([self.n("b", "k"), self.n("e", "k2"), ("app_notice_settled", "i1", {"key": "k"})])
        self.assertEqual([x["id"] for x in by_key["i1"]], ["e"])
        self.assertEqual(notices.still_open([self.n("a"), ("app_closed", "i1", {})]), {})
        self.assertEqual(notices.still_open([self.n("a"), ("app_notice_settled", "i1", {"id": "a"})]), {})
        self.assertEqual(notices.newest([]), None)


class HostTest(HostBase):
    """The host's checks, its records, what the home reads of them, and the page told."""

    def setUp(self):
        super().setUp()
        write_app(self.apps_dir, "bell", BELL, BELL_BACKEND)
        self.host.find()
        self.told = []
        self.host.told = self.told.append
        self.i = self.host.open("bell", "g", self.folder)
        self.host.attach("g", self.i.id, "c1")

    def open_now(self):
        self.host.flush()
        conn = sqlite3.connect(f"file:{dashboard_home.db_path('g')}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            return data.app_notices(conn)
        finally:
            conn.close()

    def test_only_an_app_asking_notify_may(self):
        notes = self.host.open("notes", "g", self.folder)
        with self.assertRaises(AppError) as ctx:
            self.host.notify("notes", notes, "hello")
        self.assertIn("capabilities.notify", str(ctx.exception))
        with self.assertRaises(AppError):
            self.host.notify("notes", self.i, "not its instance")
        self.assertEqual(app_kit.Manifest.__dataclass_fields__["capabilities"].default_factory().notify, False)
        self.assertIn(app_kit.CAPABILITIES["notify"], self.host.hosted("bell").manifest.capabilities.asked())

    def test_sent_open_until_settled_and_the_page_told(self):
        bound = app_host.Bound(self.host, "bell")
        first = bound.notify(self.i, "Build failed", "3 tests", key="build", where={"run": 7})
        got = self.open_now()
        self.assertEqual(list(got), [self.i.id])
        self.assertEqual(got[self.i.id]["app"], "bell")
        n = got[self.i.id]["notices"][0]
        self.assertEqual((n["id"], n["title"], n["text"], n["where"], n["show"]), (first, "Build failed", "3 tests",
                                                                                   {"run": 7}, ["ag"]))
        self.assertEqual(got[self.i.id]["last"], n["at"])
        self.assertIn("g", self.told)                                      # written: the page told
        again = bound.notify(self.i, "Build failed again", key="build")    # its key: in the first one's place
        self.assertEqual([x["id"] for x in self.open_now()[self.i.id]["notices"]], [again])
        other = bound.notify(self.i, "Deploy done")
        bound.clear_notice(self.i, "build")                                # cleared by the app, by its key
        self.assertEqual([x["id"] for x in self.open_now()[self.i.id]["notices"]], [other])
        self.host.settle_notice("g", self.i.id, other, by="user")          # dismissed by the user
        self.assertEqual(self.open_now(), {})
        settled = self.host.read("bell", self.i, ["app_notice_settled"])
        self.assertEqual([(e["payload"].get("key") or e["payload"].get("id"), e["payload"]["how"], e["payload"]["by"])
                          for e in settled], [("build", "cleared", "app"), (other, "dismissed", "user")])

    def test_its_instance_closed_settles_all_and_the_home_has_them(self):
        app_host.Bound(self.host, "bell").notify(self.i, "Waiting on you")
        self.host.flush()
        g = next(x for x in data.home([])["gatherers"] if x["name"] == "g")
        self.assertEqual([n["title"] for n in g["apps"][self.i.id]["notices"]], ["Waiting on you"])
        self.host.close_instance("g", self.i.id)
        self.assertEqual(self.open_now(), {})

    def test_no_agent_is_shown_one(self):
        """A notification is the user's: a record, never in an agent's context -- the one attached to the app's either."""
        app_host.Bound(self.host, "bell").notify(self.i, "Secret pop-up", "for the user only")
        self.host.flush()
        ctx, _ = self.m._context("g", store.high_water(self.m._conn("g")), ch("c1"), 244800)
        self.assertNotIn("Secret pop-up", json.dumps(ctx.items))
        self.assertIn("app_notified", data.RECORDS + data.APP_RECORDS)


class ServedTest(HostBase):
    """The routes, and an app in its own process sending and clearing one through the host."""

    def setUp(self):
        super().setUp()
        write_app(self.apps_dir, "bell", BELL, BELL_BACKEND)
        write_app(self.apps_dir, "far_bell", FAR_BELL, BELL_BACKEND.replace("bell.added", "far_bell.added"))
        env = unittest.mock.patch.dict(os.environ, {"PYTHONPATH": ROOT})
        env.start()
        self.addCleanup(env.stop)
        self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        self.httpd.app_host._write_fn = insert_here
        self.hosts.append(self.httpd.app_host)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.serving(self.httpd)
        self.port = self.httpd.server_port

    def api(self, method, path, body=None):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
        conn.request(method, path, json.dumps(body) if body is not None else None,
                     {"Host": f"127.0.0.1:{self.port}", **({"Content-Type": "application/json"} if body is not None else {})})
        r = conn.getresponse()
        got = json.loads(r.read() or b"null")
        conn.close()
        return r.status, got

    def notices_of(self, inst):
        self.httpd.app_host.flush()
        g = next(x for x in data.home([])["gatherers"] if x["name"] == "g")
        return [n["title"] for n in (g.get("apps") or {}).get(inst, {}).get("notices", [])]

    def test_a_panel_sends_clears_and_the_reader_dismisses(self):
        _, inst = self.api("POST", "/api/apps/open", {"app": "bell", "gatherer": "g", "folder": self.folder})
        where = {"app": "bell", "gatherer": "g", "instance": inst["id"]}
        status, got = self.api("POST", "/api/apps/notify", {**where, "title": "Quiet", "key": "q", "show": []})
        self.assertEqual(status, 200, got)
        self.httpd.app_host.flush()
        g = next(x for x in data.home([])["gatherers"] if x["name"] == "g")
        self.assertEqual([n["show"] for n in g["apps"][inst["id"]]["notices"]], [[]])   # only listed
        self.api("POST", "/api/apps/notices/settle", {**where, "which": "q", "by": "app"})
        status, got = self.api("POST", "/api/apps/notify", {**where, "title": "From the panel", "key": "p"})
        self.assertEqual(status, 200)
        self.assertEqual(self.notices_of(inst["id"]), ["From the panel"])
        self.assertEqual(self.api("POST", "/api/apps/notify", {**where, "title": ""})[0], 400)
        self.assertEqual(self.api("POST", "/api/apps/notices/settle", {**where, "which": "p", "by": "app"})[0], 200)
        self.assertEqual(self.notices_of(inst["id"]), [])
        _, second = self.api("POST", "/api/apps/notify", {**where, "title": "Again"})
        self.assertEqual(self.api("POST", "/api/apps/notices/settle",
                                  {"gatherer": "g", "instance": inst["id"], "which": second["id"]})[0], 200)
        self.assertEqual(self.notices_of(inst["id"]), [])
        _, notes = self.api("POST", "/api/apps/open", {"app": "notes", "gatherer": "g", "folder": self.folder})
        status, got = self.api("POST", "/api/apps/notify", {"app": "notes", "gatherer": "g", "instance": notes["id"],
                                                            "title": "no"})
        self.assertEqual(status, 403)

    def test_an_app_in_its_own_process_sends_and_clears(self):
        _, inst = self.api("POST", "/api/apps/open", {"app": "far_bell", "gatherer": "g", "folder": self.folder})
        call = {"app": "far_bell", "gatherer": "g", "instance": inst["id"]}
        status, got = self.api("POST", "/api/apps/call", {**call, "tool": "ring",
                                                          "args": {"title": "Far away", "show": ["system"], "key": "f"}})
        self.assertEqual((status, got["isError"]), (200, False), got)
        self.assertEqual(self.notices_of(inst["id"]), ["Far away"])
        self.api("POST", "/api/apps/call", {**call, "tool": "ring", "args": {"title": "Quiet", "show": [], "key": "q"}})
        self.httpd.app_host.flush()
        g = next(x for x in data.home([])["gatherers"] if x["name"] == "g")
        self.assertEqual([n["show"] for n in g["apps"][inst["id"]]["notices"]], [["system"], []])   # as sent, from afar
        self.api("POST", "/api/apps/call", {**call, "tool": "hush", "args": {"which": "q"}})
        status, got = self.api("POST", "/api/apps/call", {**call, "tool": "ring", "args": {"title": ""}})
        self.assertTrue(got["isError"])
        self.assertIn("a title", got["content"][0]["text"])
        status, got = self.api("POST", "/api/apps/call", {**call, "tool": "hush", "args": {"which": "f"}})
        self.assertEqual((status, got["isError"]), (200, False), got)
        self.assertEqual(self.notices_of(inst["id"]), [])


if __name__ == "__main__":
    unittest.main()
