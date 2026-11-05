"""A recorded run of an actor (tests/chat_runs/*.json, made by tests/chat_runs/record.py), replayed: the gatherer as
it stood at each moment of the run, and the actor's session as the dashboard had it then -- for Chat's view to be made
from at each, and the views checked (tests/chat_check.py; ag_dashboard/CHAT_VIEW.md).

`moments(run, late={"record": 0.3})` replays it with one source seen later than it came, as a page sees it when one
feed lags: the harness's own record (`RECORD`), the dashboard's (`DASHBOARD`), the rest of the conversation
(`CONVERSATION`), the reads, the in-place tables (withdrawals, builds, checks), or the session.
"""

import json
import os
import sqlite3
from dataclasses import dataclass, field
from typing import Dict, Iterator, List, Optional

RUNS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chat_runs")

#: The events the harness's own record of the session gives (ag's follower of its file): a source of its own.
RECORD = {"message_sent", "message_queued", "message_withdrawn", "turn_stopped", "asked", "ask_settled", "task_started",
          "task_activity", "task_ended", "session_file", "name", "recap", "harness"}
#: The events the dashboard keeps of what it did.
DASHBOARD = {"chat_sent", "terminal_input", "answer_given"}
#: The sources a run's changes come from, as `late` names them.
SOURCES = ("record", "dashboard", "conversation", "reads", "tables", "session")


@dataclass
class Moment:
    """The run at one moment: when (seconds since the epoch), the gatherer as it stood (`conn`, a connection to a copy
    built up to then -- valid until the next moment), the session as the dashboard had it (None before its first
    sample), and what the run had done by then."""
    at: float
    conn: sqlite3.Connection
    session: Optional[dict]
    actions: List[dict] = field(default_factory=list)


def names() -> List[str]:
    """The recorded runs, by name."""
    return sorted(f[:-5] for f in os.listdir(RUNS) if f.endswith(".json"))


def load(name: str) -> dict:
    with open(os.path.join(RUNS, name + ".json")) as fh:
        return json.load(fh)


def _source(table: str, row: dict, types: Dict[int, str]) -> str:
    if table == "_reads":
        return "reads"
    name = types.get(row.get("event_type_id"), "")
    return "record" if name in RECORD else "dashboard" if name in DASHBOARD else "conversation"


def _insert(conn: sqlite3.Connection, table: str, row: dict) -> None:
    cols = [k for k in row if not k.startswith("_")]
    conn.execute(f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                 [row[c] for c in cols])


def empty(run: dict) -> sqlite3.Connection:
    """A gatherer with the run's schema and event types, and no rows."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    for sql in run["schema"]:
        conn.execute(sql)
    for table in ("event_types", "event_type_properties"):
        for row in run.get(table, []):
            _insert(conn, table, row)
    conn.commit()
    return conn


def moments(run: dict, late: Optional[Dict[str, float]] = None) -> Iterator[Moment]:
    """Each moment something changed in the run, in order -- a row stored, a table's rows changed in place, the session
    changed -- with the gatherer built up to it. `late`: {source (SOURCES): seconds} it is seen after it came."""
    late = late or {}
    unknown = set(late) - set(SOURCES)
    if unknown:
        raise ValueError(f"no such source: {', '.join(sorted(unknown))}")
    types = {t["event_type_id"]: t["name"] for t in run.get("event_types", [])}
    changes = []                                           # (at, order, kind, what)
    for i, table in enumerate(("events", "_reads")):
        for row in run.get(table, []):
            changes.append((row["_at"] + late.get(_source(table, row, types), 0.0), i, "row", (table, row)))
    for table, snaps in run.get("sampled", {}).items():
        for snap in snaps:
            changes.append((snap["at"] + late.get("tables", 0.0), 2, "table", (table, snap["rows"])))
    for s in run.get("sessions", []):
        changes.append((s["at"] + late.get("session", 0.0), 3, "session", s["state"]))
    changes.sort(key=lambda c: (c[0], c[1]))
    conn, session, done = empty(run), None, []
    actions = sorted(run.get("actions", []), key=lambda x: x["at"])
    i = 0
    while i < len(changes):
        at = changes[i][0]
        while i < len(changes) and changes[i][0] == at:   # all that changed at once
            _, _, kind, what = changes[i]
            if kind == "row":
                _insert(conn, *what)
            elif kind == "table":
                table, rows = what
                if table == "_withdrawn":
                    conn.execute("DELETE FROM _withdrawn")
                else:
                    conn.execute(f"DELETE FROM {table} WHERE channel_key = ?", (run["channel"],))
                for row in rows:
                    _insert(conn, table, row)
            else:
                session = what
            i += 1
        conn.commit()
        done = [a for a in actions if a["at"] <= at]
        yield Moment(at, conn, session, done)


def at_end(run: dict) -> sqlite3.Connection:
    """The gatherer as it stood at the run's end."""
    conn = None
    for m in moments(run):
        conn = m.conn
    return conn if conn is not None else empty(run)
