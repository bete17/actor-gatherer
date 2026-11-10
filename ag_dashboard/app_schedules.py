"""The apps' schedules, run (app_kit's schedules.py; app_kit/DESIGN.md, "5c. Schedules"): while the dashboard runs, each
app's [[schedules]] are looked at every TICK seconds of the clock on the wall, and a run that is due calls its backend's
`App.scheduled(name, due)` -- the backend started for it, if no one had used the app yet.

    Schedules(host)     the apps' schedules, for an AppHost: `start()` a thread that looks at them, `close()` it;
                        `tick(now)` one look (what the thread does, and what tests call)

When a run happens:
    - Looks start a minute after the dashboard does (FIRST_WAIT), not to add to the reads of its start.
    - A schedule seen for the first time runs at its next time, never at one before it: an app just found, or just
      given a schedule, doesn't run what it would have run in the past.
    - A run is due once its time has passed and it hasn't run since -- the dashboard wasn't running, or the computer was
      asleep: the clock on the wall is read on every look, so a look after the computer wakes finds it due. A schedule
      that doesn't `catch_up` skips a run more than GRACE late instead.
    - Only for an app with an open instance in some gatherer (every gatherer's records read once, first): an app
      nobody has open does nothing. Its run waits, and runs once one is opened.
    - One run of a schedule at a time, in a thread of its own. Its backend's answer, a number of seconds, tries the
      same run again that much later (RETRY_MIN at least); an exception, RETRY_ON_ERROR later. A newer due time takes
      the place of a run still being tried, so one that never succeeds stops at the next.

What it keeps, per app and schedule ("<app>/<schedule>"), in <home>/dashboard/app_schedules.json: when it last ran
(`ran`, the due time of the last run done or skipped), the run waiting to be done (`pending`, its due time) and when it
is tried again (`retry_at`), and how the last try went (`last`: {at, due, ok, retry, error}). A file of the dashboard's
own, not events: a schedule is an app's, in no one gatherer, and the host's records are each a gatherer's."""

import json
import os
import threading
import time
import traceback
from typing import Callable, Dict, List, Optional, Set

from . import home

TICK = 30.0                 # seconds between looks
FIRST_WAIT = 60.0           # and before the first: the dashboard's own reads as it starts go first
GRACE = 300.0               # how late a run of a schedule that doesn't catch up may still be
RETRY_MIN = 30.0            # the soonest a run is tried again, whatever its backend says
RETRY_ON_ERROR = 600.0      # a run that raised, tried again this much later
ERROR_CHARS = 400


def state_path() -> str:
    return os.path.join(home.HOME, "dashboard", "app_schedules.json")


class Schedules:
    """The apps' schedules of `host` (an AppHost): looked at by `tick`, run each in a thread of its own (`threads`
    False: in the caller's, for tests). `clock` is the clock on the wall; `gatherers` names every gatherer, whose
    records are read once before the first look, so every open instance is known."""

    def __init__(self, host, path: Optional[str] = None, clock: Callable[[], float] = time.time,
                 gatherers: Optional[Callable[[], List[str]]] = None, threads: bool = True):
        self.host = host
        self.path = path or state_path()
        self.clock = clock
        self.gatherers = gatherers
        self.threads = threads
        self.lock = threading.Lock()
        self.state: Dict[str, dict] = self._read()
        self.running: Set[str] = set()
        self._loaded = False
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # -- the thread

    def start(self) -> "Schedules":
        self._thread = threading.Thread(target=self._looking, name="app-schedules", daemon=True)
        self._thread.start()
        return self

    def close(self) -> None:
        self._stop.set()

    def _looking(self) -> None:
        if self._stop.wait(FIRST_WAIT):
            return
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception:  # noqa: BLE001 - a look that fails is tried again at the next
                traceback.print_exc()
            self._stop.wait(TICK)

    # -- a look

    def tick(self, now: Optional[float] = None) -> List[str]:
        """One look at every app's schedules: what is due is marked so, and each run that can go now is started.
        -> the runs started ("<app>/<schedule>")."""
        now = self.clock() if now is None else now
        self._load_all()
        started = []
        with self.host.lock:
            apps = [(n, h.manifest) for n, h in sorted(self.host.apps.items()) if h.manifest.schedules]
            open_apps = {i.app for i in self.host.instances.values()}
        changed = False
        for name, m in apps:
            for s in m.schedules:
                key = f"{name}/{s.name}"
                with self.lock:
                    st = self.state.get(key)
                    if st is None:                                 # first seen: from its next time on
                        self.state[key] = {"ran": now, "pending": None, "retry_at": None, "last": None}
                        changed = True
                        continue
                    due = s.last(now)
                    if due is not None and due > (st.get("ran") or 0) and due > (st.get("pending") or 0):
                        if not s.catch_up and now - due > GRACE:
                            st.update(ran=due, pending=None, retry_at=None,
                                      last={"at": now, "due": due, "ok": False, "skipped": True})
                        else:
                            st.update(pending=due, retry_at=None)
                        changed = True
                    pending = st.get("pending")
                    go = (pending is not None and key not in self.running and name in open_apps
                          and (st.get("retry_at") or 0) <= now)
                    if go:
                        self.running.add(key)
                if go:
                    started.append(key)
                    if self.threads:
                        threading.Thread(target=self._run, args=(key, name, s.name, pending),
                                         name=f"app-schedule-{key}", daemon=True).start()
                    else:
                        self._run(key, name, s.name, pending)
        if changed:
            self._save()
        return started

    def _run(self, key: str, name: str, schedule: str, due: float) -> None:
        retry: Optional[float] = None
        error = None
        try:
            got = self.host.backend(name).scheduled(schedule, due)
            if got is not None:
                retry = max(RETRY_MIN, float(got))
        except Exception as exc:  # noqa: BLE001 - an app's failure is its own: tried again later
            retry, error = RETRY_ON_ERROR, f"{type(exc).__name__}: {exc}"[:ERROR_CHARS]
        now = self.clock()
        with self.lock:
            self.running.discard(key)
            st = self.state.setdefault(key, {"ran": 0, "pending": None, "retry_at": None, "last": None})
            st["last"] = {"at": now, "due": due, "ok": retry is None, "retry": retry, "error": error}
            if st.get("pending") == due:                           # not overtaken by a newer due time meanwhile
                if retry is None:
                    st.update(ran=due, pending=None, retry_at=None)
                else:
                    st["retry_at"] = now + retry
            elif retry is None:
                st["ran"] = max(st.get("ran") or 0, due)
        self._save()

    def status(self, name: str) -> Dict[str, dict]:
        """An app's schedules as they stand: {schedule: {ran, pending, retry_at, last, next}}."""
        h = self.host.apps.get(name)
        if h is None:
            return {}
        now = self.clock()
        with self.lock:
            return {s.name: {**self.state.get(f"{name}/{s.name}", {}), "next": s.next(now)}
                    for s in h.manifest.schedules}

    # -- every gatherer's instances, once

    def _load_all(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if self.gatherers is None:
            from . import data
            names = data.gatherer_names()
        else:
            names = self.gatherers()
        for g in names:
            try:
                self.host._load(g)
            except Exception:  # noqa: BLE001 - a gatherer that can't be read has no instances to run for
                continue

    # -- the file

    def _read(self) -> Dict[str, dict]:
        try:
            with open(self.path, encoding="utf-8") as fh:
                got = json.load(fh)
        except (OSError, ValueError):
            return {}
        return {k: v for k, v in got.items() if isinstance(v, dict)} if isinstance(got, dict) else {}

    def _save(self) -> None:
        if self._stop.is_set():                                    # closed: its home may be going
            return
        with self.lock:
            text = json.dumps(self.state, indent=1, sort_keys=True)
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = f"{self.path}.{os.getpid()}.{threading.get_ident()}.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                fh.write(text)
            os.replace(tmp, self.path)
        except OSError:
            pass
