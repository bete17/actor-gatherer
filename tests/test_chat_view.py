"""Chat's view (ag_dashboard/chat_view.py) where no recorded run reaches: a turn opening that a key typed into the
terminal stopped before the harness recorded anything of it -- a codex session's first message, stopped before the call
that makes its thread -- as the terminal's message box shows it after; a session whose process ended (its `ended`),
before a turn, as it worked, or after it was over; and whether a hang-up took its message back, recorded by a hook
before it said (`_took`)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import chat_replay  # noqa: E402
from ag_dashboard import chat_view  # noqa: E402

SENT = {"cid": "p1", "text": "Hello", "at": 100.0}


def session(stopped_at=None, box=None, sent=(SENT,)):
    return {"sent": list(sent), "queued": [], "ended": 0, "stopped_at": stopped_at, "box": box}


class StoppedOpeningTest(unittest.TestCase):
    def test_a_stop_key_and_an_empty_box_stop_the_turn_it_opens(self):
        got = chat_view.unstored(session(100.4, "empty"), now=101.0)
        self.assertEqual((got["current"]["state"], got["current"]["turn"]), ("stopped", "opening"))
        self.assertEqual((got["opening"]["text"], got["opening"]["stopped"]["kind"]), ("Hello", "interrupted"))
        self.assertIsNone(got["taken_back"])

    def test_a_stop_key_and_the_message_back_in_its_box_take_it_back(self):
        got = chat_view.unstored(session(100.4, "holds"), now=101.0)
        self.assertIsNone(got["opening"])
        self.assertEqual(got["current"]["state"], "idle")
        self.assertEqual((got["taken_back"]["text"], got["taken_back"]["cid"], got["taken_back"]["since"]),
                         ("Hello", "p1", 100.0))

    def test_no_stop_key_after_it_or_a_box_not_known_leave_it_opening(self):
        for s in (session(), session(99.0, "empty"), session(100.4, None), session(100.4, "away")):
            with self.subTest(s):
                got = chat_view.unstored(s, now=101.0)
                self.assertEqual((got["current"]["state"], got["opening"].get("stopped")), ("opening", None))

    def test_one_the_harness_has_is_not_stopped_by_the_box(self):
        opening = {"text": "Hello", "cid": "p1", "began": 100.0, "seen": True, "unseen": False}
        self.assertEqual(chat_view._stop_on(opening, session(100.4, "empty")), (opening, None))


class EndedSessionTest(unittest.TestCase):
    """A session's `ended` stays once its process has ended, as it is run again (a terminal opened again): only the
    turn that was at work as it ended is closed."""

    def views(self, ended_after):
        """The run's last turn at each moment it was at work, and at its end, made with the session ended
        `ended_after` seconds after that turn began: [(state without the end, state with it)]."""
        run = chat_replay.load("claude-tool-call")
        out, end = [], None
        for m in chat_replay.moments(run):                  # each moment's gatherer: valid until the next
            base = (m.session or {}).get("session") or session(sent=())
            plain = chat_view.view(m.conn, run["channel"], base, m.at)
            turns = plain["turns"]
            if len(turns) < 2:
                continue
            ended = dict(base, ended=turns[-1]["began"] + ended_after)
            got = chat_view.view(m.conn, run["channel"], ended, m.at)["current"]
            end = (plain["current"]["state"], got["state"], (got["stopped"] or {}).get("kind"))
            if end[0] == "working":
                out.append(end)
        out.append(end)
        self.assertIn("working", [p for p, _, _ in out])
        self.assertEqual(out[-1][0], "done")
        return out

    def test_an_end_before_the_turn_began_leaves_it_as_it_is(self):
        for plain, state, kind in self.views(-5.0):
            self.assertEqual((state, kind), (plain, None))

    def test_an_end_as_the_turn_worked_closes_it(self):
        for plain, state, kind in self.views(0.01):
            self.assertEqual((state, kind), ("stopped", "closed") if plain == "working" else ("done", None))

    def test_an_end_after_the_turn_was_over_leaves_it_done(self):
        self.assertEqual(self.views(60.0)[-1][1:], ("done", None))


class TookBackTest(unittest.TestCase):
    """`_took`: a hang-up (Esc) at 10.0 on the call of row 5, "Hello", stored at 9.0."""

    SHOWN = [(5, "Hello", 9.0)]

    def took(self, takes_back=True, shown=SHOWN, prompts=(), words="Hello", **b):
        hang_up = dict({"read": 1, "row": 5, "reached": "nothing", "withdrawn": None, "at": 10.0}, **b)
        return chat_view._took(hang_up, words, list(shown), list(prompts), takes_back)

    def test_as_the_hook_says(self):
        self.assertTrue(self.took(withdrawn=True))
        self.assertFalse(self.took(withdrawn=False))
        self.assertFalse(self.took(withdrawn=True, reached="text"))     # its words had come: the harness keeps it
        self.assertFalse(self.took(withdrawn=True, words=None))         # no user's message of its own

    def test_an_older_hook_hid_what_it_withdrew(self):
        for takes_back in (True, False):
            self.assertTrue(self.took(takes_back=takes_back, shown=[]))
            self.assertFalse(self.took(takes_back=takes_back, shown=[], reached="text"))

    def test_shown_by_an_older_hook_it_goes_by_the_harness_sending_it_again(self):
        again = [{"text": "Hello", "sent": 9.0}, {"text": "Hello", "sent": 12.0}]
        for reached in ("nothing", None):
            self.assertTrue(self.took(reached=reached, prompts=again))   # ag kept its row for the message sent again
            self.assertFalse(self.took(reached=reached, prompts=again[:1]))   # a later call of its turn, a side call
            self.assertFalse(self.took(reached=reached, prompts=again, shown=self.SHOWN + [(8, "Hello", 12.1)]))
            self.assertFalse(self.took(reached=reached, prompts=[{"text": "Bye", "sent": 12.0}]))
        self.assertFalse(self.took(reached="text", prompts=again))       # its words had come: the harness keeps it

    def test_shown_by_an_older_hook_of_a_harness_that_keeps_it_it_is_not_taken_back(self):
        self.assertFalse(self.took(takes_back=False, prompts=[{"text": "Hello", "sent": 12.0}]))

if __name__ == "__main__":
    unittest.main()
