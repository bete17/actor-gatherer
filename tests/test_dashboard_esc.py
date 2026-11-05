"""Esc in Chat, and a message Claude Code took back (ag_dashboard/page.html, from `untouched` to isInterrupting): when the
page may type Esc into an actor's terminal, when the message taken back is still in Claude Code's box untouched, and how
it is put in Chat's message box and taken out again -- run in Node, without the rest of the page."""
import json
import os
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ag_dashboard import data  # noqa: E402
import page_source  # noqa: E402

START = "// Whether the message Claude Code took back is in its input box untouched"
END = "// A turn its session has opened that ag has not stored yet"
# what the section uses of the page, stood in for; each case runs on a fresh page: [steps], each [name, ...arguments]
RUN = r"""
const store = {};
const sessionStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
let draftsNow = {};
const drafts = () => draftsNow;
const keepDraft = (k, t) => { if (t) draftsNow[k] = t; else delete draftsNow[k]; };
const box = { value: "", dataset: { draft: "g\u0000s" } };
const document = { getElementById: (id) => (id === "composer-text" ? box : null) };
const fitBox = () => {};
const state = { selected: ["g", "s"] };
const key = (g, c) => `${g}\u0000${c}`;
let openedNow = false;
const AT_WORK = ["opening", "working", "asking"];
const chatViewOf = () => (openedNow ? { current: { state: "opening" }, opening: { seen: true } } : null);   // its message sent, not stored
const mySends = () => [];
const posted = [];
const post = (url, body) => { posted.push([url, body]); return Promise.resolve({}); };
const setLive = () => {}, keepingPlace = () => {}, renderMain = () => {};
%s
const api = {
  canInterrupt: (info) => canInterrupt(info),
  untouched: (info) => untouched(info),
  refill: (info) => { refill(info, key(...state.selected)); return [box.value, drafts()[key(...state.selected)] || ""]; },
  type: (text) => { box.value = text; keepDraft(key(...state.selected), text); return text; },
  interrupt: (info) => { const got = interrupt(info); return [got, posted.length]; },
  opened: (v) => { openedNow = v; return v; },
  reload: () => { box.value = ""; draftsNow = {}; for (const k of Object.keys(refilledHere)) delete refilledHere[k]; return null; },
};
let input = "";
process.stdin.on("data", (d) => { input += d; }).on("end", () =>
  process.stdout.write(JSON.stringify(JSON.parse(input).map((steps) => steps.map(([f, ...a]) => api[f](...a))))));
"""


def section() -> str:
    text = page_source.script()
    return text[text.index(START):text.index(END)]


def run(*cases):
    """Each case a list of steps, run in order on a fresh page: each step's result."""
    got = subprocess.run(["node", "-e", RUN % section()], input=json.dumps(cases), capture_output=True, text=True,
                         timeout=30)
    if got.returncode:
        raise AssertionError(got.stderr)
    return json.loads(got.stdout)


def actor(status="running", terminal=True, starting=False, taken=None, stopped_at=None):
    return {"status": status, "taken_back": taken,
            "session": {"session_id": "s", "terminal": terminal, "status": "starting" if starting else "terminal",
                        "stopped_at": stopped_at}}


TAKEN = {"text": "and the columns?", "at": 100.0, "since": 50.0}


@unittest.skipUnless(shutil.which("node"), "the page's code runs in Node")
class EscTest(unittest.TestCase):
    def test_esc_goes_only_to_an_actor_at_work_in_a_terminal_the_dashboard_runs(self):
        got = run([["canInterrupt", actor("running")], ["canInterrupt", actor("asking")],
                   ["canInterrupt", actor("idle")],                                   # a build of its context: still idle
                   ["canInterrupt", dict(actor("idle"), building=True)],
                   ["canInterrupt", actor("running", terminal=False)],                # no terminal of the dashboard's
                   ["canInterrupt", actor("running", starting=True)],                 # starting: Esc is "No" to trust
                   ["opened", True], ["canInterrupt", actor("idle")]])                # its message sent, not yet stored
        self.assertEqual(got, [[True, True, False, False, False, False, True, True]])

    def test_once_a_second(self):
        [got] = run([["interrupt", actor("running")], ["interrupt", actor("running")], ["interrupt", actor("idle")]])
        self.assertEqual(got, [[True, 1], [False, 1], [False, 1]])

    def test_untouched_while_the_stop_key_is_the_last_typed_after_the_call_before(self):
        got = run([["untouched", actor(taken=TAKEN, stopped_at=60.0)], ["untouched", actor(taken=TAKEN, stopped_at=None)],
                   ["untouched", actor(taken=TAKEN, stopped_at=40.0)], ["untouched", actor(stopped_at=60.0)]])
        self.assertEqual(got, [[True, False, False, False]])

    def test_put_in_the_message_box_once_and_taken_out_once_gone(self):
        there, gone = actor("idle", taken=TAKEN, stopped_at=60.0), actor("idle")
        [put] = run([["refill", there], ["type", ""], ["refill", there],              # cleared: not put back
                     ["reload"], ["refill", there]])                                  # nor after a reload
        self.assertEqual(put, [["and the columns?", "and the columns?"], "", ["", ""], None, ["", ""]])
        [out] = run([["refill", there], ["refill", gone]])                            # sent or changed in the terminal
        self.assertEqual(out, [["and the columns?", "and the columns?"], ["", ""]])
        [kept] = run([["refill", there], ["type", "and the rows?"], ["refill", gone]])   # changed here: left as it is
        self.assertEqual(kept[-1], ["and the rows?", "and the rows?"])
        [mine] = run([["type", "my draft"], ["refill", there]])                      # something written: not replaced
        self.assertEqual(mine[-1], ["my draft", "my draft"])
        [elsewhere] = run([["refill", actor("idle", taken=TAKEN, stopped_at=None)]])  # not in Claude Code's box: not put
        self.assertEqual(elsewhere, [["", ""]])


FIXTURE = os.path.join(ROOT, "frontend", "src", "core", "ui", "harness-info.json")


class StoppedTest(unittest.TestCase):
    """A turn stopped short says so under it in its harness's own words (harness_kit's `stopped_says`): Claude Code's,
    codex's; a harness that says none its own, plain ones. Its cases run in Vitest (frontend/src/features/chat/
    Working.test.tsx) on the words in frontend/src/core/ui/harness-info.json; here, that those are harness_kit's."""

    def test_the_pages_tests_read_the_words_harness_kit_has(self):
        with open(FIXTURE, encoding="utf-8") as fh:
            fixture = json.load(fh)
        said = lambda info: {n: h.get("stopped") for n, h in info.items()}  # noqa: E731
        self.assertEqual(said(fixture), said(data.harness_info()),
                         "harness_kit's words for a stopped turn changed: write them to the page's tests' "
                         "harness-info.json")


if __name__ == "__main__":
    unittest.main()
