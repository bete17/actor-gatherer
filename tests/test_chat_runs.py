"""The recorded runs of actors (tests/chat_runs/*.json), replayed (tests/chat_replay.py): each rebuilds the gatherer as
it stood, moment by moment, in time and with a source late; and Chat's view, made at each moment, passes the checks
(tests/chat_check.py) -- once there is a view to make (ag_dashboard/CHAT_VIEW.md, step 2)."""

import importlib.util
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import chat_replay  # noqa: E402
from chat_check import check  # noqa: E402

#: How late a source may come, in the replays with one late: as much as a page's feeds were seen to lag.
LATE = 0.4


def count(conn, table: str) -> int:
    return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


class RecordedRunsTest(unittest.TestCase):
    def test_there_are_runs(self):
        self.assertGreaterEqual(len(chat_replay.names()), 5)

    def test_each_replays_to_what_was_recorded(self):
        for name in chat_replay.names():
            with self.subTest(name):
                run = chat_replay.load(name)
                times, events = [], []
                for m in chat_replay.moments(run):
                    times.append(m.at)
                    events.append(count(m.conn, "events"))
                self.assertEqual(times, sorted(times))
                self.assertEqual(events, sorted(events))               # stored rows are only added
                self.assertEqual(events[-1], len(run["events"]))
                self.assertEqual(count(m.conn, "_reads"), len(run["_reads"]))

    def test_each_replays_with_a_source_late(self):
        for name in chat_replay.names():
            run = chat_replay.load(name)
            for source in chat_replay.SOURCES:
                with self.subTest(name, late=source):
                    last = list(chat_replay.moments(run, late={source: LATE}))[-1]
                    self.assertEqual(count(last.conn, "events"), len(run["events"]))
        with self.assertRaises(ValueError):
            list(chat_replay.moments(chat_replay.load(chat_replay.names()[0]), late={"nope": 1}))

    def test_a_message_taken_back_is_withdrawn_and_sent_again_restored(self):
        run = chat_replay.load("claude-esc-and-resend")
        withdrawn = [count(m.conn, "_withdrawn") for m in chat_replay.moments(run)]
        self.assertTrue(any(withdrawn))                            # Esc before any words: its rows withdrawn
        sends = [a for a in run["actions"] if a["what"] == "key Enter"]
        self.assertEqual(len(sends), 3)

    @unittest.skipIf(importlib.util.find_spec("ag_dashboard.chat_view") is None, "step 2: no chat_view yet")
    def test_chat_s_view_of_each_passes_the_checks(self):              # pragma: no cover - until step 2
        from ag_dashboard import chat_view
        for name in chat_replay.names():
            run = chat_replay.load(name)
            sends = tuple(a["at"] for a in run["actions"] if a["what"] == "key Enter")
            for late in [{}] + [{s: LATE} for s in chat_replay.SOURCES]:
                with self.subTest(name, late=late):
                    views = [(m.at, chat_view.view(m.conn, run["channel"], m.session, m.at))
                             for m in chat_replay.moments(run, late=late)]
                    self.assertEqual(check(views, sends=sends), [])


if __name__ == "__main__":
    unittest.main()
