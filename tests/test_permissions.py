"""The permissions Claude Code asks in its terminal before a tool runs: its PermissionRequest hook added for the run by
ag's launcher (`with_settings`), its reports recorded by the hook server as `asked` and settled as its thread calls its
model again or asks again (proxy_hook.py's `reported`, `moved_on`), what the dashboard shows of one (data.py's
`ask_view`), and its dialog answered from the page with keys (answers.py, sessions.py's `answer`, POST /api/answer)."""
import asyncio
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from harness_kit import AnswerError, ClaudeCode  # noqa: E402
from harness_kit.base import HOOK_PATH, Box, permission_summary  # noqa: E402
from harness_kit.claude import permission_asked, permission_dialog_keys, permission_hook_settings  # noqa: E402
from ag.integrations.harnesses.claude.ag_orchestrator import context_manager as claude_ag  # noqa: E402
from ag.integrations.harnesses.claude.setup import launch  # noqa: E402
from ag.integrations.harnesses.codex.ag_orchestrator.ag_clients import AgClients  # noqa: E402
from ag.integrations.tools.hook_server.hook_server import Answer  # noqa: E402
from ag_dashboard import answers, data, server, sessions  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402
from test_dashboard_answers import GathererBase  # noqa: E402
from test_dashboard_sessions import SessionsBase  # noqa: E402

#: What Claude Code 2.1.319's PermissionRequest hook POSTed for a Bash call, as it drew its dialog.
REPORT = {"session_id": "sess", "transcript_path": "/u/.claude/projects/-w/sess.jsonl", "cwd": "/w",
          "permission_mode": "default", "effort": {"level": "medium"}, "hook_event_name": "PermissionRequest",
          "tool_name": "Bash", "tool_input": {"command": "touch probe1.txt", "description": "Create empty file probe1.txt"},
          "permission_suggestions": [{"type": "addDirectories", "directories": ["/w"], "destination": "session"}]}
UP, TAB, ENTER = "\x1b[A", "\t", "\r"


class HarnessTest(unittest.TestCase):
    def test_its_report_is_a_permission_asked(self):
        [f] = ClaudeCode().hooked(REPORT, 5.0)
        self.assertEqual((f.type, f.at, f.data["kind"], f.data["call"]), ("asked", 5.0, "permission", f.key))
        self.assertTrue(f.key.startswith("permission:"))
        self.assertEqual((f.data["tool"], f.data["said"], f.data["agent"]), ("Bash", "Create empty file probe1.txt", None))
        self.assertEqual(f.data["input"], REPORT["tool_input"])
        self.assertEqual((f.data["view"]["shape"], f.data["view"]["command"]), ("shell", "touch probe1.txt"))
        self.assertFalse(f.data["async"])
        self.assertNotEqual(ClaudeCode().hooked(REPORT, 5.0)[0].key, f.key)    # the same call asked again: anew

    def test_a_subagent_s_and_other_hooks_reports(self):
        [f] = ClaudeCode().hooked({**REPORT, "agent_id": "a1"}, 1.0)
        self.assertEqual(f.data["agent"], "a1")
        self.assertEqual(ClaudeCode().hooked({**REPORT, "hook_event_name": "PostToolUse"}, 1.0), [])
        self.assertIsNone(permission_asked("not a report", 1.0))

    def test_what_a_call_is_for_without_a_description(self):
        edit = {**REPORT, "tool_name": "Edit", "tool_input": {"file_path": "/w/a.py", "old_string": "x", "new_string": "y"}}
        [f] = ClaudeCode().hooked(edit, 1.0)
        self.assertEqual((f.data["said"], f.data["view"]["shape"]), ("/w/a.py", "edit"))
        [f] = ClaudeCode().hooked({**REPORT, "tool_name": "mcp__x__y", "tool_input": {}}, 1.0)
        self.assertEqual(f.data["said"], "mcp__x__y")

    def test_a_long_input_is_clipped(self):
        [f] = ClaudeCode().hooked({**REPORT, "tool_name": "Write", "tool_input": {"file_path": "/w/b", "content": "z" * 9000}}, 1.0)
        self.assertLess(len(f.data["input"]["content"]), 4100)

    def test_its_dialog_s_keys(self):
        """2.1.319's dialog: 1 is Yes; Up from it wraps round to No, the last; Tab there takes why not."""
        self.assertEqual(permission_dialog_keys({"allow": True}), ["1"])
        self.assertEqual(permission_dialog_keys({"allow": True, "text": "ignored"}), ["1"])
        self.assertEqual(permission_dialog_keys({"allow": False}), [UP, ENTER])
        self.assertEqual(permission_dialog_keys({"allow": False, "text": "  "}), [UP, ENTER])
        self.assertEqual(permission_dialog_keys({"allow": False, "text": " use echo "}), [UP, TAB, "use echo", ENTER])
        for bad in ({}, {"allow": "yes"}, {"allow": False, "text": "two\nlines"}, None):
            with self.assertRaises(AnswerError):
                permission_dialog_keys(bad)
        self.assertEqual([permission_summary(c) for c in ({"allow": True}, {"allow": False}, {"allow": False, "text": "no"})],
                         ["Allowed", "Denied", "Denied: no"])

    def test_its_hook_settings(self):
        got = permission_hook_settings("http://127.0.0.1:4113/h/g/ag/hooked")
        self.assertEqual(got, {"hooks": {"PermissionRequest": [{"hooks": [
            {"type": "http", "url": "http://127.0.0.1:4113/h/g/ag/hooked", "timeout": 5}]}]}})
        self.assertEqual(ClaudeCode().permission_hooks("u"), permission_hook_settings("u"))


class LauncherTest(unittest.TestCase):
    EXTRA = permission_hook_settings("http://h/ag/hooked")

    def test_its_own_settings_before_the_prompt(self):
        args, note = launch.with_settings(["--model", "m", "--", "hi"], self.EXTRA)
        self.assertEqual(args[:2], ["--model", "m"])
        self.assertEqual((args[2], json.loads(args[3]), args[4:]), ("--settings", self.EXTRA, ["--", "hi"]))
        self.assertIsNone(note)
        self.assertEqual(launch.with_settings([], self.EXTRA)[0][0], "--settings")

    def test_settings_given_get_the_hook_added(self):
        """DocWriter's guard comes as `--settings` with a PreToolUse hook: both kept, in one."""
        given = {"hooks": {"PreToolUse": [{"matcher": "Edit", "hooks": [{"type": "command", "command": "g"}]}],
                           "PermissionRequest": [{"hooks": [{"type": "command", "command": "mine"}]}]}, "model": "x"}
        for args in (["--settings", json.dumps(given), "--", "--settings"], [f"--settings={json.dumps(given)}"]):
            out, note = launch.with_settings(args, self.EXTRA)
            value = out[1] if out[0] == "--settings" else out[0].split("=", 1)[1]
            got = json.loads(value)
            self.assertEqual(got["model"], "x")
            self.assertEqual(got["hooks"]["PreToolUse"], given["hooks"]["PreToolUse"])
            self.assertEqual(got["hooks"]["PermissionRequest"],
                             given["hooks"]["PermissionRequest"] + self.EXTRA["hooks"]["PermissionRequest"])
            self.assertEqual(out[2:], args[2:])                             # after `--`: the prompt's, untouched

    def test_a_settings_file_is_read_and_one_that_can_t_be_kept(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"hooks": {}}, fh)
        self.addCleanup(os.unlink, fh.name)
        out, _ = launch.with_settings(["--settings", fh.name], self.EXTRA)
        self.assertEqual(json.loads(out[1])["hooks"], self.EXTRA["hooks"])
        args = ["--settings", "/no/such.json"]
        out, note = launch.with_settings(args, self.EXTRA)
        self.assertEqual(out, args)
        self.assertIn("can't be read", note)

    def launched(self, **settings):
        class Servers:
            def running(self):
                return []

            def start(self, *args, **kwargs):
                return SimpleNamespace(url="http://127.0.0.1:4113")
        launcher = launch.ClaudeLauncher({**launch.ClaudeLauncher.defaults, "upstream": "https://api.anthropic.com",
                                          **settings}, "/tmp/home")
        launcher.servers = Servers()
        run = SimpleNamespace(args=["--", "hi"], command=["claude"], env={}, gatherer="g", adaptor="", dry_run=False)
        env = {k: v for k, v in os.environ.items() if k != "CLAUDE_CONFIG_DIR"}     # no /c/<folder>/ in its URLs
        with mock.patch.object(launch, "probe", lambda *a: None), mock.patch.dict(os.environ, env, clear=True):
            return launcher.launch(run)

    def test_the_run_reports_to_its_hook_server(self):
        out = self.launched()
        i = out.argv.index("--settings")
        hooks = json.loads(out.argv[i + 1])["hooks"]["PermissionRequest"]
        self.assertEqual(hooks[0]["hooks"][0]["url"], "http://127.0.0.1:4113/h/g" + HOOK_PATH)
        self.assertEqual(out.argv[-2:], ["--", "hi"])
        self.assertNotIn("--settings", self.launched(permission_hook=False).argv)


class FakeClient:
    def __init__(self):
        self.records = []

    async def request(self, op, body=None, timeout=None):
        if op == "latest":
            return {"events": []}
        if op == "insert":
            self.records += body["events"]
            return {"rows": []}
        return {"context": body.get("events") or [], "note": "ok"}

    async def stop(self):
        pass


def turn():
    return [{"role": "system", "content": [{"type": "text", "text": "# Environment\n - Primary working directory: /w\n"}]},
            {"role": "user", "content": [{"type": "text", "text": "go"}]}]


class HookTest(unittest.TestCase):
    """The hook server's side: a report recorded, answered at once; the ask settled as its thread goes on."""

    def setUp(self):
        self.client = FakeClient()
        self.hook = claude_ag.ClaudeContextManager(ag_clients=AgClients(lambda gatherer: self.client), log=lambda g, l: None)

    def run_all(self, *requests):
        async def go():
            out = []
            for r in requests:
                out.append(await self.hook(r))
                if self.hook.under_way:
                    await asyncio.gather(*list(self.hook.under_way))
            return out
        return asyncio.run(go())

    @staticmethod
    def report(**extra):
        return SimpleNamespace(method="POST", path=HOOK_PATH, label="g", headers={}, body={**REPORT, **extra}, state={})

    @staticmethod
    def model_call(agent=None):
        headers = {"X-Claude-Code-Session-Id": "sess", **({"x-claude-code-agent-id": agent} if agent else {})}
        return SimpleNamespace(method="POST", path="/v1/messages", label="g", headers=headers, state={},
                               body={"model": "m", "tools": [{"name": "Bash"}], "messages": turn(), "metadata": {}})

    def facts(self, kind):
        return [e for e in self.client.records if e["type"] == kind]

    def test_recorded_and_answered_at_once_deciding_nothing(self):
        [got] = self.run_all(self.report())
        self.assertEqual(got, Answer(200, {}))
        [asked] = self.facts("asked")
        self.assertEqual((asked["payload"]["kind"], asked["payload"]["tool"]), ("permission", "Bash"))
        self.assertEqual(asked["id"], f"asked:{asked['payload']['call']}")
        self.assertEqual(self.facts("ask_settled"), [])

    def test_settled_as_its_turn_calls_its_model_again(self):
        self.run_all(self.report(), self.model_call())
        [asked], [settled] = self.facts("asked"), self.facts("ask_settled")
        self.assertEqual((settled["payload"]["call"], settled["payload"]["how"]), (asked["payload"]["call"], "answered"))
        self.run_all(self.model_call())
        self.assertEqual(len(self.facts("ask_settled")), 1)                  # settled once

    def test_a_subagent_s_by_its_own_calls_alone(self):
        self.run_all(self.report(agent_id="a1"), self.model_call(), self.model_call("a2"))
        self.assertEqual(self.facts("ask_settled"), [])                       # the session's, another agent's: not it
        self.run_all(self.model_call("a1"))
        self.assertEqual(len(self.facts("ask_settled")), 1)

    def test_asked_again_the_last_one_was_answered(self):
        """It draws one dialog at a time, the next once the last is answered."""
        self.run_all(self.report(), self.report(agent_id="a1"), self.report())
        first, sub, last = self.facts("asked")
        self.assertEqual([e["payload"]["call"] for e in self.facts("ask_settled")], [first["payload"]["call"]])

    def test_a_report_with_no_session_or_another_hook_s_records_nothing(self):
        bare = SimpleNamespace(method="POST", path=HOOK_PATH, label="g", headers={}, body={"hook_event_name": "x"}, state={})
        self.assertEqual(self.run_all(bare, self.report(hook_event_name="PostToolUse")), [Answer(200, {})] * 2)
        self.assertEqual(self.client.records, [])


class ViewTest(GathererBase):
    def asked(self, **extra):
        f = ClaudeCode().hooked({**REPORT, **extra}, time.time())[0]
        self.add([("asked", {"at": f.at, **f.data}, None)])
        return f.key

    def test_what_the_page_is_given(self):
        key = self.asked()
        got = data.asking_of("g", "s1")
        self.assertEqual({k: got[k] for k in ("id", "kind", "call", "tool", "said", "agent", "async")},
                         {"id": key, "kind": "permission", "call": None, "tool": "Bash",
                          "said": "Create empty file probe1.txt", "agent": None, "async": False})
        self.assertEqual((got["input"], got["view"]["shape"]), (REPORT["tool_input"], "shell"))
        self.add([("ask_settled", {"at": time.time(), "call": key, "how": "answered", "result": None}, None)])
        self.assertIsNone(data.asking_of("g", "s1"))

    def test_the_answer_s_keys_and_words(self):
        ask = {"kind": "permission", "harness": "claude", "id": "permission:x"}
        self.assertEqual(answers.keys(ask, {"allow": False, "text": "not now"}), [UP, TAB, "not now", ENTER])
        self.assertEqual((answers.summary(ask, {"allow": True}), answers.expected(ask, {"allow": True})), ("Allowed", []))
        with self.assertRaises(AnswerError):
            answers.expected(ask, {})


class TypedTest(SessionsBase):
    """Typed into the dashboard's terminal for the session (the fake ag echoes each read); its dialog as its screen
    shows it, stood in for (`_box`)."""

    def typed(self):
        return [x["typed"] for x in self.logged() if "typed" in x]

    def started(self):
        sid = self.s.create("g", self.work)["session_id"]
        self.s.terminal(sid, 100, 30)
        self.until(lambda: "fake terminal" in self.s.output(sid, -1)[0].decode("utf-8", "replace"))
        return sid

    def ask(self, **extra):
        return {"id": "permission:k1", "kind": "permission", "harness": "claude", "call": None, "at": time.time(), **extra}

    def test_allowed_then_its_dialog_seen_closed(self):
        sid = self.started()
        boxes = iter([Box.AWAY, Box.AWAY, Box.EMPTY])                         # asking; the keys not taken yet; closed
        with mock.patch.object(sessions.Sessions, "_box", lambda *a: next(boxes, Box.EMPTY)):
            sent = self.s.answer(sid, self.ask(), {"allow": True})
            self.assertEqual((sent["call"], sent["summary"], sent["expect"]), ("permission:k1", "Allowed", []))
            self.until(lambda: self.typed() == ["1"])
            self.until(lambda: self.session(sid)["answer"].get("closed"))

    def test_denied_with_why_each_key_on_its_own(self):
        sid = self.started()
        with mock.patch.object(sessions.Sessions, "_box", lambda *a: Box.AWAY):
            self.s.answer(sid, self.ask(), {"allow": False, "text": "use echo"})
            self.until(lambda: len(self.typed()) == 4)
            self.assertEqual(self.typed(), [UP, TAB, "use echo", ENTER])
            time.sleep(0.4)
            self.assertNotIn("closed", self.session(sid)["answer"])            # its dialog still shown: not settled here

    def test_refused_where_no_dialog_shows_or_its_terminal_opened_since(self):
        sid = self.started()
        with mock.patch.object(sessions.Sessions, "_box", lambda *a: Box.EMPTY):
            with self.assertRaisesRegex(sessions.SessionError, "doesn't show it asking"):
                self.s.answer(sid, self.ask(), {"allow": True})
        with mock.patch.object(sessions.Sessions, "_box", lambda *a: Box.AWAY):
            with self.assertRaisesRegex(sessions.SessionError, "opened after it asked"):
                self.s.answer(sid, self.ask(at=time.time() - 60), {"allow": True})
            with self.assertRaises(answers.AnswerError):
                self.s.answer(sid, self.ask(), {"allow": "yes"})
        self.assertEqual(self.typed(), [])


@unittest.skipUnless(sessions.TERMINALS, "a terminal needs a Unix pseudo-terminal")
class EndpointTest(SessionsBase):
    def setUp(self):
        super().setUp()
        self.httpd = server.serve("127.0.0.1", 0)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def post(self, body, path="/api/answer"):
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as exc:
            return exc.code, json.load(exc)

    def test_the_page_answers_a_permission_by_its_id(self):
        sid = self.post({"gatherer": "g", "cwd": self.work}, "/api/sessions")[1]["session_id"]
        self.post({"session_id": sid, "cols": 100, "rows": 30}, "/api/terminal")
        self.until(lambda: os.path.exists(self.log) and self.logged())
        time.sleep(0.3)
        os.makedirs(os.path.join(dashboard_home.HOME, "gatherers", "g"), exist_ok=True)
        conn = sqlite3.connect(os.path.join(dashboard_home.HOME, "gatherers", "g", "context.db"))
        conn.executescript("""CREATE TABLE event_types (event_type_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
            CREATE TABLE events (row_id INTEGER PRIMARY KEY, inserted_at TEXT NOT NULL, event_id TEXT, event_type_id INTEGER NOT NULL,
              payload_json TEXT NOT NULL, tokens INTEGER NOT NULL, text TEXT, counted INTEGER, p_channel, p_answer_id);""")
        now = datetime.now(timezone.utc).isoformat()
        f = ClaudeCode().hooked({**REPORT, "session_id": sid}, time.time())[0]
        bash = {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_b", "name": "Bash", "input": REPORT["tool_input"]}]}
        for typ, payload, answer in (("reply_part", {"type": "tool_call", "payload": bash}, "m"),   # its turn waits on
                                     ("reply_end", {"stop": "tool_use"}, "m"),                       # the call it asks
                                     ("asked", {"at": f.at, **f.data}, None)):                       # to run
            conn.execute("INSERT OR IGNORE INTO event_types (name, created_at) VALUES (?, ?)", (typ, now))
            conn.execute("INSERT INTO events (inserted_at, event_type_id, payload_json, tokens, p_channel, p_answer_id) "
                         "VALUES (?, (SELECT event_type_id FROM event_types WHERE name = ?), ?, 1, ?, ?)",
                         (now, typ, json.dumps(payload), sid, answer))
        conn.commit()
        conn.close()
        with mock.patch.object(sessions.Sessions, "_box", lambda *a: Box.AWAY):
            self.assertEqual(self.post({"session_id": sid, "id": "permission:other", "choice": {"allow": True}})[0], 400)
            code, got = self.post({"session_id": sid, "id": f.key, "choice": {"allow": True}})
        self.assertEqual((code, got["summary"], got["call"]), (200, "Allowed", f.key))
        self.until(lambda: [x["typed"] for x in self.logged() if "typed" in x] == ["1"])


if __name__ == "__main__":
    unittest.main()
