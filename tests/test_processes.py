"""What differs by OS, run for real on this one: a process and what it started ended (harness_kit/processes.py), and
one `ag home migrate` at a time in a home (its lock)."""

import os
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from ag.ag_harness.home.__main__ import _locked  # noqa: E402
from harness_kit.processes import end_group, running  # noqa: E402

CHILD = "import time; time.sleep(60)"
PARENT = ("import subprocess, sys, time; child = subprocess.Popen([sys.executable, '-c', sys.argv[1]]); "
          "print(child.pid, flush=True); time.sleep(60)")


class EndGroupTest(unittest.TestCase):
    def gone(self, pid):
        until = time.time() + 10
        while time.time() < until and running(pid):
            time.sleep(0.1)
        return not running(pid)

    def test_a_process_and_what_it_started_are_ended(self):
        for force in (False, True):
            parent = subprocess.Popen([sys.executable, "-c", PARENT, CHILD], stdout=subprocess.PIPE, text=True,
                                      start_new_session=True)
            self.addCleanup(parent.stdout.close)
            child = int(parent.stdout.readline())
            end_group(parent.pid, force)
            parent.wait(timeout=10)
            self.assertTrue(self.gone(child), f"force={force}: what it started still runs")

    def test_none_there_is_said(self):
        parent = subprocess.Popen([sys.executable, "-c", ""], start_new_session=True)
        parent.wait(timeout=30)
        with self.assertRaises(ProcessLookupError):
            end_group(parent.pid)


class MigrateLockTest(unittest.TestCase):
    def test_one_holder_at_a_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "migrate.lock")
            with open(path, "w") as first:
                self.assertTrue(_locked(first))
                with open(path, "w") as second:
                    self.assertFalse(_locked(second))
            with open(path, "w") as third:              # the first closed: free again
                self.assertTrue(_locked(third))


if __name__ == "__main__":
    unittest.main()
