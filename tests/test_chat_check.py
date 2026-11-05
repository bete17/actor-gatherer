"""The checks over Chat's views (tests/chat_check.py), on made-up sequences: each glitch they are for found, and what
happens in a conversation as it should not taken for one."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from chat_check import check  # noqa: E402


def view(turns, state, turn=None, opening=None, waiting=(), taken_back=None):
    """A view: `turns` [(n, text, extra)] or [(n, text)], the latest turn's `state`."""
    ts = [dict(n=t[0], text=t[1], **(t[2] if len(t) > 2 else {})) for t in turns]
    latest = "opening" if opening else (ts[-1]["n"] if ts else None)
    return {"turns": ts, "opening": opening, "current": {"state": state, "turn": latest if turn is None else turn},
            "waiting": list(waiting), "taken_back": taken_back}


ONE = [(0, "hello", {"cid": "a", "began": 100.0})]
TWO = ONE + [(1, "and now", {"cid": "b", "began": 110.0})]


class ChecksTest(unittest.TestCase):
    def test_a_turn_as_it_goes_is_fine(self):
        views = [(100.0, view([], "idle", turn=None, opening={"text": "hello", "cid": "a", "began": 100.0})),
                 (100.0, view([], "opening", opening={"text": "hello", "cid": "a", "began": 100.0})),
                 (100.3, view(ONE, "working")), (103.0, view(ONE, "done")),
                 (110.0, view(ONE, "opening", opening={"text": "and now", "cid": "b", "began": 110.0})),
                 (110.3, view(TWO, "working")), (113.0, view(TWO, "done"))]
        self.assertEqual(check(views[1:], sends=(100.0, 110.0)), [])

    def test_a_blink_of_done_between_two_moments_at_work(self):
        views = [(100.3, view(ONE, "working")), (100.4, view(ONE, "done")), (100.5, view(ONE, "working"))]
        got = check(views)
        self.assertEqual(len(got), 1)
        self.assertIn("turn 0 shown over for 0.10s", got[0])

    def test_the_next_turn_begun_at_once_with_no_message_sent_is_a_blink(self):
        # the turn ends, and the message held for its end opens the next at once
        views = [(100.3, view(ONE, "working")), (103.0, view(ONE, "done")), (103.04, view(TWO, "working"))]
        self.assertEqual(len(check(views)), 1)
        self.assertEqual(check(views, sends=(103.02,)), [])             # sent then: a new turn, not a blink

    def test_stopped_is_over_for_good(self):
        views = [(100.3, view(ONE, "working")), (100.6, view(ONE, "stopped")), (101.0, view(TWO, "working"))]
        self.assertEqual(check(views), [])

    def test_a_send_in_two_places(self):
        v = view(ONE, "working", waiting=[{"text": "hello", "cid": "a"}])
        got = check([(100.0, v)])
        self.assertEqual(got, ["+0.00s: send a in 2 places: turn 0, waiting"])

    def test_a_turn_taken_back_may_go_and_no_other(self):
        back = view([], "idle", turn=None, taken_back={"text": "hello", "cid": "a"})
        self.assertEqual(check([(100.3, view(ONE, "working")), (100.6, back)]), [])
        gone = view([], "idle", turn=None)
        self.assertEqual(check([(100.3, view(ONE, "working")), (100.6, gone)]),
                         ["+0.30s: turn 0 went without being taken back"])
        changed = view([(0, "hullo")], "done")
        self.assertIn("turns changed", check([(100.3, view(ONE, "done")), (100.6, changed)])[0])

    def test_the_current_state_is_the_latest_turn_s(self):
        self.assertEqual(check([(100.0, view(TWO, "working", turn=0))]),
                         ["+0.00s: the current state is turn 0's, the latest is 1"])

    def test_a_turn_s_start_does_not_move(self):
        moved = [(0, "hello", {"cid": "a", "began": 100.4})]
        got = check([(100.3, view(ONE, "working")), (100.6, view(moved, "working"))])
        self.assertEqual(got, ["+0.30s: turn 0 began at 100.0, now 100.4"])


if __name__ == "__main__":
    unittest.main()
