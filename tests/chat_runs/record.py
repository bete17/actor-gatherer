"""Record a live run of one actor, for Chat's replayed tests (ag_dashboard/CHAT_VIEW.md, tests/chat_replay.py).

    python tests/chat_runs/record.py --home HOME --port PORT --gatherer G --channel C --out RUN.json [--drive DRIVE.json]

While it runs (until Ctrl-C, or --seconds): every 50 ms, the session's state as the dashboard on PORT has it (its
`/api/home` row), and the rows of the gatherer that change in place -- the withdrawals (a message taken back, then
sent again, is withdrawn and restored), the builds and the task checks. Then: the gatherer's schema, its event types,
and every row of the actor's (and of no actor's) events and reads, each with the time it was stored. `--drive`: what
the run did, as the test driver logged it ({"marks": [[ms, "key Escape"], ...]}), kept as the run's `actions`.

A run is recorded on a scratch home, never a real one (repo-workflow): the dashboard and the gatherer both read only.
"""

import argparse
import getpass
import json
import os
import re
import signal
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime

#: The tables of the gatherer whose rows change in place during a run: sampled, each snapshot kept with its time.
SAMPLED = {
    "_withdrawn": "SELECT w.* FROM _withdrawn w JOIN events e ON e.row_id = w.row_id WHERE ifnull(e.p_channel, '') = :ch "
                  "ORDER BY w.row_id",
    "_builds": "SELECT * FROM _builds WHERE channel_key = :ch ORDER BY build_id",
    "_boundaries": "SELECT * FROM _boundaries WHERE channel_key = :ch ORDER BY row_id",
}
#: The tables whose rows are only ever added: dumped once at the end, each row with its own time.
ADDED = {
    "events": ("SELECT * FROM events WHERE ifnull(p_channel, '') IN (:ch, '') ORDER BY row_id", "inserted_at"),
    "_reads": ("SELECT * FROM _reads WHERE ifnull(p_channel, '') = :ch ORDER BY read_id", "read_at"),
}


def seconds(stamp) -> float:
    """An ISO time (UTC) as seconds since the epoch."""
    return datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).timestamp()


#: What the harness tells the model besides the conversation (its system prompt, its tools, what it knows of the user):
#: kept as a placeholder -- Chat's view reads that it is there, not what it says, and a recording goes into the repo.
TRIM = {"context"}
#: Mail addresses, and the paths of this machine (the home folder; the scratch folders), out of every string kept.
MAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
PATHS = [(os.path.realpath("/private/tmp"), "/tmp"), (os.path.expanduser("~"), "/home/user")]
#: This machine's login, as a word (a listing's owner column): "user".
LOGIN = re.compile(r"\b" + re.escape(getpass.getuser()) + r"\b")


def scrub(value):
    """`value` (any JSON) with mail addresses and this machine's paths replaced."""
    if isinstance(value, str):
        value = MAIL.sub("user@example.com", value)
        for path, stand_in in PATHS:
            value = value.replace(path, stand_in)
        return LOGIN.sub("user", value)
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    return value


def trimmed(row: dict, types: dict) -> dict:
    """An events row, one of TRIM's types a placeholder: its payload ({"trimmed": its length}) and its text."""
    if types.get(row.get("event_type_id")) in TRIM:
        n = len(row.get("payload_json") or "")
        row = dict(row, payload_json=json.dumps({"trimmed": n}), text=f"[{n} characters]")
    return row


def session_of(port: int, gatherer: str, channel: str):
    """The actor's session as the dashboard has it (its `/api/home` row's `session`), with the actor's status."""
    home = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/home", timeout=2).read())
    for g in home.get("gatherers") or []:
        if g.get("name") != gatherer:
            continue
        for a in g.get("agents") or []:
            if a.get("channel") == channel:
                s = a.get("session") or {}
                return {"status": a.get("status"), "session": {k: s.get(k) for k in (
                    "status", "queued", "terminal", "stopped_at", "started_as", "ended")}}
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--gatherer", required=True)
    ap.add_argument("--channel", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--drive", help="the test driver's log of what the run did")
    ap.add_argument("--seconds", type=float, default=0, help="stop after this long (0: at Ctrl-C or SIGTERM)")
    a = ap.parse_args(argv)
    db = f"{a.home}/gatherers/{a.gatherer}/context.db"
    while not os.path.exists(db):                      # a new gatherer has none until its first call
        time.sleep(0.05)
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    stop = [False]
    signal.signal(signal.SIGTERM, lambda *_: stop.__setitem__(0, True))
    sessions, sampled = [], {name: [] for name in SAMPLED}
    end = time.time() + a.seconds if a.seconds else None
    try:
        while not stop[0] and (end is None or time.time() < end):
            now = time.time()
            try:
                got = session_of(a.port, a.gatherer, a.channel)
            except Exception:  # noqa: BLE001 - the dashboard busy for a moment: the next sample
                got = None
            if got is not None and (not sessions or sessions[-1]["state"] != got):
                sessions.append({"at": now, "state": got})
            for name, sql in SAMPLED.items():
                try:
                    rows = [dict(r) for r in conn.execute(sql, {"ch": a.channel})]
                except sqlite3.Error:
                    continue                          # the table not made yet
                if not sampled[name] or sampled[name][-1]["rows"] != rows:
                    sampled[name].append({"at": now, "rows": rows})
            time.sleep(max(0.0, 0.05 - (time.time() - now)))
    except KeyboardInterrupt:
        pass
    run = {"gatherer": a.gatherer, "channel": a.channel, "recorded": time.time(),
           "schema": [sql for (sql,) in conn.execute(
               "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table', 'view', 'index', 'trigger') "
               "AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 "
               "WHEN 'index' THEN 2 ELSE 3 END, rowid")],
           "event_types": [dict(r) for r in conn.execute("SELECT * FROM event_types ORDER BY event_type_id")],
           "event_type_properties": [dict(r) for r in conn.execute("SELECT * FROM event_type_properties")],
           "sessions": sessions, "sampled": sampled, "actions": []}
    types = {t["event_type_id"]: t["name"] for t in run["event_types"]}
    for name, (sql, stamp) in ADDED.items():
        run[name] = [trimmed(dict(r, _at=seconds(r[stamp])), types) for r in conn.execute(sql, {"ch": a.channel})]
    if a.drive:
        drive = json.load(open(a.drive))
        run["actions"] = [{"at": at / 1000, "what": what} for at, what in drive.get("marks", [])]
    with open(a.out, "w") as fh:
        json.dump(scrub(run), fh, indent=1, sort_keys=True)
    print(f"{a.out}: {len(run['events'])} events, {len(run['_reads'])} reads, {len(sessions)} session states, "
          + ", ".join(f"{len(v)} {k}" for k, v in sampled.items()), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
