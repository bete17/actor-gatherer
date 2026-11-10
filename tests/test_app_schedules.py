"""Apps' schedules (app_kit/schedules.py, ag_dashboard/app_schedules.py; app_kit/DESIGN.md "5c. Schedules"): when a
schedule is due, how a manifest says one, and the dashboard running them -- once per due time, caught up after the
computer slept or the dashboard was off, tried again when the backend says so, and only for an app someone has open."""
import json
import os
import sys
import tempfile
import threading
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app_kit  # noqa: E402
from app_kit import schedules  # noqa: E402
from ag_dashboard import app_schedules  # noqa: E402
from test_dashboard_app_host import NOTES, HostBase, write_app  # noqa: E402

NY = ZoneInfo("America/New_York")


def ny(*args) -> float:
    return datetime(*args, tzinfo=NY).timestamp()


def sched(**d) -> schedules.Schedule:
    def fail(key, why):
        raise app_kit.ManifestError(f"{key}: {why}")
    return schedules.parse({"name": "s", **d}, 0, fail)


class WhenTest(unittest.TestCase):
    def test_times_of_day_on_weekdays_in_a_time_zone(self):
        s = sched(at="00:15", days=["mon", "tue", "wed", "thu", "fri"], timezone="America/New_York")
        tue = ny(2026, 11, 10, 1, 0)
        self.assertEqual(s.last(tue), ny(2026, 11, 10, 0, 15))
        self.assertEqual(s.next(tue), ny(2026, 11, 11, 0, 15))
        sat = ny(2026, 11, 14, 12, 0)                                 # the weekend: Friday's, then Monday's
        self.assertEqual(s.last(sat), ny(2026, 11, 13, 0, 15))
        self.assertEqual(s.next(sat), ny(2026, 11, 16, 0, 15))
        self.assertEqual(s.last(ny(2026, 11, 10, 0, 15)), ny(2026, 11, 10, 0, 15))   # at its time: due

    def test_several_times_a_day(self):
        s = sched(at=["18:00", "06:00"], timezone="America/New_York")
        self.assertEqual(s.at, ("06:00", "18:00"))
        self.assertEqual(s.last(ny(2026, 11, 10, 12, 0)), ny(2026, 11, 10, 6, 0))
        self.assertEqual(s.next(ny(2026, 11, 10, 12, 0)), ny(2026, 11, 10, 18, 0))
        self.assertEqual(s.last(ny(2026, 11, 10, 5, 0)), ny(2026, 11, 9, 18, 0))

    def test_every_counts_from_each_midnight(self):
        s = sched(every="6h", timezone="America/New_York")
        self.assertEqual(s.every, 6 * 3600)
        self.assertEqual(s.last(ny(2026, 11, 10, 13, 30)), ny(2026, 11, 10, 12, 0))
        self.assertEqual(s.next(ny(2026, 11, 10, 13, 30)), ny(2026, 11, 10, 18, 0))
        self.assertEqual(s.next(ny(2026, 11, 10, 23, 0)), ny(2026, 11, 11, 0, 0))

    def test_a_clock_change_keeps_the_time_of_day(self):
        s = sched(at="00:15", timezone="America/New_York")             # DST ended 2026-11-01 02:00
        self.assertEqual(s.next(ny(2026, 10, 31, 12, 0)), ny(2026, 11, 1, 0, 15))
        self.assertEqual(s.next(ny(2026, 11, 1, 12, 0)), ny(2026, 11, 2, 0, 15))
        self.assertEqual(s.next(ny(2026, 11, 1, 12, 0)) - s.next(ny(2026, 10, 31, 12, 0)), 25 * 3600)

    def test_the_computers_own_time_zone_by_default(self):
        s = sched(at="09:30")
        now = datetime(2026, 11, 10, 12, 0).timestamp()                # naive: this computer's
        self.assertEqual(s.last(now), datetime(2026, 11, 10, 9, 30).timestamp())

    def test_said_for_the_user(self):
        self.assertEqual(schedules.describe(sched(at="00:15", days=["mon", "tue", "wed", "thu", "fri"],
                                                  timezone="America/New_York")),
                         "at 00:15 Mon-Fri (America/New_York)")
        self.assertEqual(schedules.describe(sched(every="30m")), "every 30 min")
        self.assertEqual(schedules.describe(sched(every="2h", days=["sat", "sun"])), "every 2 h Sat, Sun")


class ManifestTest(unittest.TestCase):
    TOML = NOTES + '\n[[schedules]]\nname = "daily"\nat = "07:00"\n'

    def parse(self, toml):
        import tomllib
        return app_kit.parse(tomllib.loads(toml))

    def test_a_manifest_says_its_schedules(self):
        m = self.parse(self.TOML)
        self.assertEqual([(s.name, s.at, s.catch_up) for s in m.schedules], [("daily", ("07:00",), True)])
        self.assertEqual(m.to_dict()["schedules"][0]["said"], "at 07:00")

    def test_what_a_schedule_cant_say(self):
        bad = {
            'at = "7am"': "HH:MM",
            'at = "07:00"\nevery = "1h"': "one of them",
            'every = "30s"': "at least 1 minute",
            'every = "often"': "a count and a unit",
            'at = "07:00"\ntimezone = "Mars/Olympus"': "no such time zone",
            'at = "07:00"\ndays = ["someday"]': "a list of days",
            'at = "07:00"\nwhen = "now"': "not a key here",
        }
        for body, said in bad.items():
            with self.subTest(body=body):
                with self.assertRaises(app_kit.ManifestError) as got:
                    self.parse(NOTES + f'\n[[schedules]]\nname = "daily"\n{body}\n')
                self.assertIn(said, str(got.exception))
        with self.assertRaises(app_kit.ManifestError) as got:
            self.parse(self.TOML + '\n[[schedules]]\nname = "daily"\nat = "08:00"\n')
        self.assertIn("named twice", str(got.exception))
        no_backend = self.TOML.replace('[backend]\npython = "backend:NotesApp"\n', "").replace(
            '[[tools]]\nname = "add"', '[[tools]]\nhandled_by = "panel"\nname = "add"')
        with self.assertRaises(app_kit.ManifestError) as got:
            self.parse(no_backend)
        self.assertIn("no [backend]", str(got.exception))


# ---------------------------------------------------------------- the dashboard running them


class FakeApp:
    def __init__(self):
        self.runs, self.answer = [], None

    def scheduled(self, schedule, due):
        self.runs.append((schedule, due))
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


class FakeHosted:
    def __init__(self, manifest):
        self.manifest = manifest


class FakeInstance:
    def __init__(self, app):
        self.app = app


class FakeHost:
    """What Schedules uses of an AppHost: its apps, open instances, backends and gatherers' records."""

    def __init__(self, manifest):
        self.lock = threading.RLock()
        self.apps = {manifest.name: FakeHosted(manifest)}
        self.instances = {"i1": FakeInstance(manifest.name)}
        self.app = FakeApp()
        self.loaded = []

    def backend(self, name):
        return self.app

    def _load(self, g):
        self.loaded.append(g)


class RunTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "app_schedules.json")
        self.manifest = app_kit.Manifest(name="feed", label="Feed", version="1", schedules=(
            sched(at="00:15", days=["mon", "tue", "wed", "thu", "fri"], timezone="America/New_York"),))
        self.host = FakeHost(self.manifest)
        self.s = self.schedules()

    def schedules(self):
        return app_schedules.Schedules(self.host, self.path, gatherers=lambda: ["g1", "g2"], threads=False)

    def test_a_schedule_seen_first_runs_at_its_next_time_not_one_before(self):
        self.assertEqual(self.s.tick(ny(2026, 11, 10, 9, 0)), [])          # 00:15 has passed: not run for it
        self.assertEqual(self.host.loaded, ["g1", "g2"])                   # every gatherer's instances read, once
        self.assertEqual(self.s.tick(ny(2026, 11, 10, 23, 0)), [])
        self.assertEqual(self.s.tick(ny(2026, 11, 11, 0, 16)), ["feed/s"])
        self.assertEqual(self.host.app.runs, [("s", ny(2026, 11, 11, 0, 15))])
        self.assertEqual(self.s.tick(ny(2026, 11, 11, 0, 17)), [])         # once per due time
        self.assertEqual(self.host.loaded, ["g1", "g2"])

    def test_a_run_missed_asleep_or_off_runs_once_when_it_can(self):
        self.s.tick(ny(2026, 11, 9, 12, 0))
        self.assertEqual(self.s.tick(ny(2026, 11, 12, 9, 0)), ["feed/s"])  # three missed: the latest, once
        self.assertEqual(self.host.app.runs, [("s", ny(2026, 11, 12, 0, 15))])
        again = self.schedules()                                           # the dashboard started again
        self.assertEqual(again.tick(ny(2026, 11, 12, 10, 0)), [])          # what ran is kept
        self.assertEqual(again.tick(ny(2026, 11, 13, 7, 0)), ["feed/s"])
        with open(self.path) as fh:
            kept = json.load(fh)["feed/s"]
        self.assertEqual(kept["ran"], ny(2026, 11, 13, 0, 15))
        self.assertTrue(kept["last"]["ok"])

    def test_the_backend_says_when_to_try_again(self):
        self.s.tick(ny(2026, 11, 9, 12, 0))
        self.host.app.answer = 1800
        self.s.clock = lambda: ny(2026, 11, 10, 0, 16)
        self.assertEqual(self.s.tick(ny(2026, 11, 10, 0, 16)), ["feed/s"])
        self.assertEqual(self.s.tick(ny(2026, 11, 10, 0, 40)), [])          # not before its time
        self.host.app.answer = None
        self.assertEqual(self.s.tick(ny(2026, 11, 10, 0, 47)), ["feed/s"])  # the same run, again
        self.assertEqual([d for _, d in self.host.app.runs], [ny(2026, 11, 10, 0, 15)] * 2)
        self.assertEqual(self.s.tick(ny(2026, 11, 10, 3, 0)), [])          # done

    def test_a_newer_due_time_takes_the_place_of_one_still_tried(self):
        self.s.tick(ny(2026, 11, 9, 12, 0))
        self.host.app.answer = 7 * 86400                                   # never, it says
        self.s.clock = lambda: ny(2026, 11, 10, 0, 16)
        self.s.tick(ny(2026, 11, 10, 0, 16))
        self.host.app.answer = None
        self.assertEqual(self.s.tick(ny(2026, 11, 11, 0, 16)), ["feed/s"])
        self.assertEqual(self.host.app.runs[-1], ("s", ny(2026, 11, 11, 0, 15)))

    def test_a_run_that_raises_is_tried_again_later(self):
        self.s.tick(ny(2026, 11, 9, 12, 0))
        self.host.app.answer = RuntimeError("no network")
        self.s.clock = lambda: ny(2026, 11, 10, 0, 16)
        self.s.tick(ny(2026, 11, 10, 0, 16))
        st = self.s.state["feed/s"]
        self.assertEqual(st["last"]["error"], "RuntimeError: no network")
        self.assertEqual(st["retry_at"], ny(2026, 11, 10, 0, 16) + app_schedules.RETRY_ON_ERROR)
        self.assertEqual(self.s.tick(ny(2026, 11, 10, 0, 20)), [])
        self.host.app.answer = None
        self.assertEqual(self.s.tick(ny(2026, 11, 10, 0, 27)), ["feed/s"])

    def test_only_for_an_app_someone_has_open(self):
        self.s.tick(ny(2026, 11, 9, 12, 0))
        self.host.instances.clear()
        self.assertEqual(self.s.tick(ny(2026, 11, 10, 0, 16)), [])
        self.assertEqual(self.host.app.runs, [])
        self.host.instances["i2"] = FakeInstance("feed")                   # opened: the run waiting goes
        self.assertEqual(self.s.tick(ny(2026, 11, 10, 9, 0)), ["feed/s"])

    def test_a_schedule_that_doesnt_catch_up_skips_a_late_run(self):
        self.manifest = app_kit.Manifest(name="feed", label="Feed", version="1", schedules=(
            sched(at="00:15", timezone="America/New_York", catch_up=False),))
        self.host.apps["feed"] = FakeHosted(self.manifest)
        self.s.tick(ny(2026, 11, 9, 12, 0))
        self.assertEqual(self.s.tick(ny(2026, 11, 10, 0, 18)), ["feed/s"])  # a little late: run
        self.assertEqual(self.s.tick(ny(2026, 11, 11, 9, 0)), [])           # hours late: skipped
        self.assertTrue(self.s.state["feed/s"]["last"]["skipped"])
        self.s.clock = lambda: ny(2026, 11, 11, 9, 0)
        self.assertEqual(self.s.status("feed")["s"]["next"], ny(2026, 11, 12, 0, 15))


class HostedTest(HostBase):
    """A schedule run by a real app host: the backend started for it, called with its due time."""

    def test_the_app_host_runs_a_due_schedule(self):
        backend = '''
from app_kit import App

RUNS = []


class NotesApp(App):
    def scheduled(self, schedule, due):
        RUNS.append((schedule, due, len(self.host.instances())))
'''
        toml = (NOTES.replace('name = "notes"', 'name = "clock"').replace('label = "Notes"', 'label = "Clock"')
                .replace("notes.added", "clock.added"))           # a name of its own: its backend's module too
        write_app(self.apps_dir, "clock", toml + '\n[[schedules]]\nname = "daily"\nat = "07:00"\n'
                  'timezone = "America/New_York"\n', backend)
        self.host = self.new_host()
        self.host.open("clock", "g", self.folder)
        path = os.path.join(self.tmp.name, "sched.json")
        s = app_schedules.Schedules(self.host, path, gatherers=lambda: ["g"], threads=False)
        s.tick(ny(2026, 11, 10, 6, 0))
        self.assertEqual(s.tick(ny(2026, 11, 10, 7, 1)), ["clock/daily"])
        mod = sys.modules[type(self.host.backend("clock")).__module__]
        self.assertEqual(mod.RUNS, [("daily", ny(2026, 11, 10, 7, 0), 1)])


if __name__ == "__main__":
    unittest.main()
