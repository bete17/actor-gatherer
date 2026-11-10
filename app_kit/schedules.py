"""An app's SCHEDULES: work its backend does on its own, at times its manifest names (DESIGN.md, "5c. Schedules").

    [[schedules]]
    name = "listing"                       # its own name: what the backend is called with
    at = ["00:15"]                         # times of day, 24-hour HH:MM -- or `every`, below
    days = ["mon", "tue", "wed", "thu", "fri"]   # the days it runs (none: every day)
    timezone = "America/New_York"          # where those times are (none: this computer's)
    catch_up = true                        # a run missed -- the dashboard not running, the computer asleep -- run once
                                           # as soon as it can (the default); false: skipped

or `every = "30m"` ("Ns", "Nm", "Nh"; at least 1 minute) for a run that often, counted from midnight of each day it
runs, so "6h" is 00:00, 06:00, 12:00 and 18:00.

The host calls the backend's `App.scheduled(name, due)` with the time the run was due, in a thread of its own, one run
of a schedule at a time. What it returns is when to try again: a number of seconds when the work couldn't be done yet
(what it reads isn't out yet, the network is down), None when it is done. A newer due time takes the place of one still
being tried, so a run that never succeeds stops at the next one.

    Schedule        one [[schedules]] table, read and checked (`parse`)
    Schedule.last(now)   the latest time it was due, at or before `now` (epoch seconds), else None
    Schedule.next(now)   the first time it is due after `now`
    describe(s)     what it says, for the user: "at 00:15 Mon-Fri (America/New_York)"

Standard library only."""

import re
from dataclasses import dataclass
from datetime import date, datetime, time as dtime, timedelta
from typing import Any, Callable, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
EVERY_MIN = 60                    # the least `every` may be, in seconds
LOOK_BACK = 8                     # days looked back for the latest due time: a week, and one more
_AT = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_EVERY = re.compile(r"^(\d+)\s*([smh])$")
_UNIT = {"s": 1, "m": 60, "h": 3600}


@dataclass(frozen=True)
class Schedule:
    """One of an app's schedules: `at` times of day ("HH:MM"), or a run `every` so many seconds from each midnight; on
    `days` (0 Monday .. 6 Sunday; none: every day), in `timezone` (an IANA name; "": this computer's)."""
    name: str
    at: Tuple[str, ...] = ()
    every: int = 0
    days: Tuple[int, ...] = ()
    timezone: str = ""
    catch_up: bool = True

    def _zone(self) -> Optional[ZoneInfo]:
        return ZoneInfo(self.timezone) if self.timezone else None

    def _today(self, now: float) -> date:
        z = self._zone()
        return (datetime.fromtimestamp(now, z) if z else datetime.fromtimestamp(now)).date()

    def _stamp(self, d: date, t: dtime) -> float:
        """`t` on day `d`, where the schedule's times are, as epoch seconds. A time a clock change skips is the one
        after it; one it repeats, the first (zoneinfo's fold 0, and the computer's own mktime)."""
        z = self._zone()
        return datetime.combine(d, t, tzinfo=z).timestamp() if z else datetime.combine(d, t).timestamp()

    def _times(self, d: date):
        """Its times on day `d`, in order, as epoch seconds: none on a day it doesn't run."""
        if self.days and d.weekday() not in self.days:
            return []
        if self.at:
            return sorted(self._stamp(d, dtime(int(a[:2]), int(a[3:]))) for a in self.at)
        start = self._stamp(d, dtime(0, 0))
        end = self._stamp(d + timedelta(days=1), dtime(0, 0))
        out, t = [], start
        while t < end:
            out.append(t)
            t += self.every
        return out

    def last(self, now: float) -> Optional[float]:
        """The latest time it was due at or before `now`, looking back LOOK_BACK days; None if none."""
        today = self._today(now)
        for back in range(LOOK_BACK + 1):
            got = [t for t in self._times(today - timedelta(days=back)) if t <= now]
            if got:
                return got[-1]
        return None

    def next(self, now: float) -> Optional[float]:
        """The first time it is due after `now` (None: it never runs -- no day of the week)."""
        today = self._today(now)
        for ahead in range(LOOK_BACK + 1):
            got = [t for t in self._times(today + timedelta(days=ahead)) if t > now]
            if got:
                return got[0]
        return None

    def to_dict(self) -> dict:
        return {"name": self.name, "at": list(self.at), "every": self.every,
                "days": [DAYS[d] for d in self.days], "timezone": self.timezone, "catch_up": self.catch_up,
                "said": describe(self)}


def describe(s: Schedule) -> str:
    """What the schedule says, for the user: "at 00:15 Mon-Fri (America/New_York)", "every 30 min"."""
    if s.at:
        when = "at " + ", ".join(s.at)
    elif s.every % 3600 == 0:
        when = f"every {s.every // 3600} h"
    elif s.every % 60 == 0:
        when = f"every {s.every // 60} min"
    else:
        when = f"every {s.every} s"
    days = ""
    if s.days and len(s.days) < 7:
        ds = sorted(s.days)
        if ds == list(range(ds[0], ds[-1] + 1)) and len(ds) > 2:
            days = f" {DAYS[ds[0]].title()}-{DAYS[ds[-1]].title()}"
        else:
            days = " " + ", ".join(DAYS[d].title() for d in ds)
    return when + days + (f" ({s.timezone})" if s.timezone else "")


def parse(d: Any, i: int, fail: Callable[[str, str], None]) -> Schedule:
    """A [[schedules]] table read and checked; `fail(key, why)` raises for what is wrong."""
    at = f"schedules[{i}]."
    if not isinstance(d, dict):
        fail(at.rstrip("."), "a table")
    keys = ("name", "at", "every", "days", "timezone", "catch_up")
    for k in d:
        if k not in keys:
            fail(at + k, f"not a key here (these are: {', '.join(keys)})")
    name = d.get("name")
    if not isinstance(name, str) or not re.match(r"^[a-z][a-z0-9_]*$", name):
        fail(at + "name", "required: lowercase letters, digits and _, starting with a letter")
    times = d.get("at", [])
    if isinstance(times, str):
        times = [times]
    if not isinstance(times, list) or not all(isinstance(t, str) and _AT.match(t) for t in times):
        fail(at + "at", "times of day as \"HH:MM\" (24-hour), or a list of them")
    every = d.get("every")
    seconds = 0
    if every is not None:
        m = _EVERY.match(every) if isinstance(every, str) else None
        if not m:
            fail(at + "every", f"{every!r}: a count and a unit, \"90s\", \"30m\" or \"6h\"")
        seconds = int(m.group(1)) * _UNIT[m.group(2)]
        if seconds < EVERY_MIN:
            fail(at + "every", f"{every!r}: at least 1 minute")
    if bool(times) == bool(every is not None):
        fail(at.rstrip("."), "`at` (times of day) or `every`, one of them")
    days = d.get("days", [])
    if not isinstance(days, list) or not all(isinstance(x, str) and x.lower()[:3] in DAYS for x in days):
        fail(at + "days", f"a list of days: {', '.join(DAYS)}")
    tz = d.get("timezone", "")
    if not isinstance(tz, str):
        fail(at + "timezone", "an IANA time zone's name, such as \"America/New_York\"")
    if tz:
        try:
            ZoneInfo(tz)
        except (ZoneInfoNotFoundError, ValueError):
            fail(at + "timezone", f"{tz!r}: no such time zone")
    catch_up = d.get("catch_up", True)
    if not isinstance(catch_up, bool):
        fail(at + "catch_up", f"true or false, not {catch_up!r}")
    return Schedule(name=name, at=tuple(sorted(set(times))), every=seconds,
                    days=tuple(sorted({DAYS.index(x.lower()[:3]) for x in days})), timezone=tz, catch_up=catch_up)

