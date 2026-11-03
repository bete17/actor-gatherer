"""The browser tests' home (web_home.py) still builds: a change to how ag stores a session, or to what the dashboard
reads of it, shows here first, before the browser tests (frontend/e2e/) fail on a page with nothing in it."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import web_home  # noqa: E402
from ag.ag_harness import home as ag_home  # noqa: E402
from ag.ag_harness.store import paths  # noqa: E402
from ag_dashboard import data  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402


class WebHomeTest(unittest.TestCase):
    def setUp(self):
        self.saved = paths.TRACE_DIR, paths.AG_HOME, dashboard_home.HOME
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        paths.TRACE_DIR, paths.AG_HOME, dashboard_home.HOME = self.saved
        ag_home._HOMES.clear()
        self.tmp.cleanup()

    def test_each_actor_is_stored_at_the_fixed_time_its_turn_over(self):
        web_home.build(os.path.join(self.tmp.name, "ag"))
        g, = data.home([])["gatherers"]
        self.assertEqual(g["name"], web_home.GATHERER)
        agents = {a["channel"]: a for a in g["agents"]}
        self.assertEqual(set(agents), {c for c, *_ in web_home.ACTORS})
        for channel, harness, *_ in web_home.ACTORS:
            a = agents[channel]
            with self.subTest(harness=harness):
                self.assertEqual(a["harness"], harness)
                self.assertEqual(a["status"], "idle")
                self.assertGreater(a["events"], 20)
                self.assertTrue(web_home.AT <= a["last"] < web_home.AT + 600, a["last"])
        claude = agents[web_home.ACTORS[0][0]]
        self.assertEqual(claude["name"]["text"], "Parser fixes")
        self.assertTrue(claude["recap"]["text"].startswith("Fixed the CSV parser"))


if __name__ == "__main__":
    unittest.main()
