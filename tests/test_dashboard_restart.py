"""`ag dashboard restart` (ag_dashboard/restart.py): the home's dashboard, a real process on a scratch home, stopped and
started again where it was -- by a process of its own, which finishes even when the command's terminal closes under it --
or started when none runs; a pid the address file names but no dashboard of the home answers for is never stopped."""
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import home, restart  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(check, timeout=60.0):
    until = time.time() + timeout
    while time.time() < until:
        got = check()
        if got:
            return got
        time.sleep(0.1)
    raise AssertionError(f"not so in {timeout} s")


class RestartTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = os.path.realpath(self.tmp.name)
        self.home, self.work = os.path.join(base, "ag"), os.path.join(base, "work")
        os.makedirs(self.work)
        patch = unittest.mock.patch.object(home, "HOME", self.home)
        patch.start()
        self.addCleanup(patch.stop)
        self.children = []                     # the dashboards the test started itself
        self.started = []                      # pids of those a restart started, to stop after the test

    def tearDown(self):
        for proc in self.children:
            if proc.poll() is None:
                proc.terminate()
            proc.wait(20)
        for pid in {*self.started, self.address().get("pid")} - {p.pid for p in self.children}:
            if pid and home.alive(pid):
                os.kill(pid, signal.SIGTERM)
                wait_for(lambda: not home.alive(pid), 20)
        self.tmp.cleanup()

    def address(self) -> dict:
        try:
            with open(home.address_path(), encoding="utf-8") as fh:
                return json.load(fh)
        except OSError:
            return {}

    def dashboard(self, port):
        """A dashboard of the scratch home on `port`, run from the scratch work folder: up once it answers."""
        proc = subprocess.Popen([sys.executable, "-m", "ag_dashboard", "--home", self.home, "--port", str(port),
                                 "--no-open"], cwd=self.work, env={**os.environ, "PYTHONPATH": REPO},
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                start_new_session=True)
        self.children.append(proc)
        wait_for(lambda: home.serves(f"http://127.0.0.1:{port}/", timeout=2))
        return proc

    def restart(self, *args):
        with unittest.mock.patch.dict(os.environ, {"PYTHONPATH": REPO}):
            return restart.main(["--home", self.home, *args])

    def test_the_running_dashboard_is_stopped_and_started_again_where_it_was(self):
        port = free_port()
        old = self.dashboard(port)
        kept = self.address()
        self.assertEqual((kept["pid"], kept["cwd"], kept["host"]), (old.pid, self.work, "127.0.0.1"))
        self.assertEqual(self.restart(), 0)
        self.assertEqual(old.wait(5), 0)                              # stopped as Ctrl-C stops it, not killed
        new = self.address()
        self.assertNotEqual(new["pid"], old.pid)
        self.assertTrue(home.alive(new["pid"]))
        self.assertEqual((new["url"], new["cwd"]), (f"http://127.0.0.1:{port}", self.work))   # where it was
        self.assertTrue(home.serves(f"http://127.0.0.1:{port}/"))
        with open(os.path.join(self.home, restart.LOG), encoding="utf-8") as fh:
            self.assertIn(f"{restart.MARK} started again: http://127.0.0.1:{port}/ (pid {new['pid']}", fh.read())

    def test_the_restart_finishes_when_its_caller_is_killed_with_the_old_dashboard(self):
        port = free_port()
        old = self.dashboard(port)
        caller = subprocess.Popen([sys.executable, "-m", "ag_dashboard.restart", "--home", self.home],
                                  cwd=REPO, env={**os.environ, "PYTHONPATH": REPO}, stdin=subprocess.DEVNULL,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        wait_for(lambda: old.poll() is not None, 40)
        os.killpg(caller.pid, signal.SIGKILL)                 # as a terminal the old one ran closes, with its command
        caller.wait(5)
        new = wait_for(lambda: (a := self.address()).get("pid") not in (None, old.pid) and a)
        self.started.append(new["pid"])
        wait_for(lambda: home.serves(f"http://127.0.0.1:{port}/", timeout=2))
        self.assertEqual(new["cwd"], self.work)

    def test_with_none_running_one_is_started(self):
        port = free_port()
        self.assertEqual(self.restart("--port", str(port)), 0)
        self.started.append(self.address()["pid"])
        self.assertTrue(home.serves(f"http://127.0.0.1:{port}/"))

    def test_a_pid_the_file_names_is_left_alone_when_no_dashboard_of_the_home_answers_for_it(self):
        other = subprocess.Popen(["sleep", "60"])            # the file's pid, reused by another program
        self.addCleanup(other.kill)
        port = free_port()
        os.makedirs(os.path.dirname(home.address_path()))
        with open(home.address_path(), "w", encoding="utf-8") as fh:
            json.dump({"url": f"http://127.0.0.1:{port}", "pid": other.pid}, fh)
        self.assertEqual(restart.running(), (None, None))
        self.assertEqual(self.restart("--port", str(port)), 0)  # one started, the other program untouched
        self.started.append(self.address()["pid"])
        self.assertIsNone(other.poll())

    def test_a_dashboard_of_the_home_the_file_does_not_name_is_said_not_started_over(self):
        port = free_port()
        old = self.dashboard(port)
        os.remove(home.address_path())                  # as another dashboard of the home, stopping, took it away
        self.assertEqual(self.restart("--port", str(port)), 1)
        self.assertIsNone(old.poll())
        self.assertFalse(os.path.exists(os.path.join(self.home, restart.LOG)))   # nothing was started

    def test_a_dashboard_older_than_the_file_s_cwd_is_started_in_its_process_s_directory(self):
        port = free_port()
        old = self.dashboard(port)
        with open(home.address_path(), "w", encoding="utf-8") as fh:   # as written before it kept host and cwd
            json.dump({"url": f"http://127.0.0.1:{port}", "pid": old.pid}, fh)
        self.assertEqual(restart.where(restart.running()[0], None, None), ("127.0.0.1", port, self.work))

    def test_the_new_one_s_environment_is_not_an_actor_s(self):
        hooked = {"ANTHROPIC_BASE_URL": "http://127.0.0.1:4113/h/g/l/1", "AG_ACTOR": "a1", "CLAUDECODE": "1",
                  "AG_DASHBOARD": "http://127.0.0.1:4200", "AG_COMMAND": "ag-here"}
        with unittest.mock.patch.dict(os.environ, hooked):
            env = restart.environ()
        for name in ("ANTHROPIC_BASE_URL", "AG_ACTOR", "CLAUDECODE", "AG_DASHBOARD"):
            self.assertNotIn(name, env)
        self.assertEqual((env["AG_COMMAND"], env["AG_HOME"]), ("ag-here", self.home))
        self.assertEqual(env["PATH"], os.environ["PATH"])


class CommandTest(unittest.TestCase):
    def test_ag_dashboard_restart_help_says_what_it_does_and_runs_nothing(self):
        from ag.cli import main
        with unittest.mock.patch.object(main, "migrations") as migrations, \
                unittest.mock.patch.object(restart, "running") as running:
            self.assertEqual(main.main(["dashboard", "restart", "--help"]), 0)
        migrations.assert_not_called()
        running.assert_not_called()


if __name__ == "__main__":
    unittest.main()
