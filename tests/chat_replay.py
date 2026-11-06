"""A recorded run of an actor (tests/chat_runs/*.json, made by tests/chat_runs/record.py), replayed: the gatherer as
it stood at each moment of the run, and the actor's session as the dashboard had it then -- for Chat's view to be made
from at each, and the views checked (tests/chat_check.py; ag_dashboard/CHAT_VIEW.md).

`moments(run, late={"record": 0.3})` replays it with one source stored later than it came, against the others: the
harness's own record (`RECORD`: ag follows its file, and can be behind), the dashboard's events (`DASHBOARD`: put in by
a process of their own), the session as the dashboard has it, or the new-task checks and builds (`checks`: ag's worker
process). Not ag's conversation, its reads and its withdrawals: ag writes them in order, one call's after another's,
and the hook records how a call ended after them -- one read of the gatherer finds them as they were.
"""

import atexit
import json
import os
import shutil
import sqlite3
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Iterator, List, Optional

from harness_kit import claude

RUNS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chat_runs")

#: The events the harness's own record of the session gives (ag's follower of its file): a source of its own.
RECORD = {"message_sent", "message_queued", "message_withdrawn", "turn_stopped", "asked", "ask_settled", "task_started",
          "task_activity", "task_ended", "session_file", "name", "recap", "harness"}
#: The events the dashboard keeps of what it did.
DASHBOARD = {"chat_sent", "terminal_input", "answer_given"}
#: The sources a run's changes come from, as `late` names them.
SOURCES = ("record", "dashboard", "session", "checks")


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
        return "conversation"
    name = types.get(row.get("event_type_id"), "")
    return "record" if name in RECORD else "dashboard" if name in DASHBOARD else "conversation"


def _insert(conn: sqlite3.Connection, table: str, row: dict) -> None:
    cols = [k for k in row if not k.startswith("_")]
    conn.execute(f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                 [row[c] for c in cols])


_SCRATCH: List[str] = []


def _scratch() -> str:
    """A folder for the replays' databases, removed as the process exits."""
    if not _SCRATCH:
        _SCRATCH.append(tempfile.mkdtemp(prefix="chat-runs-"))
        atexit.register(shutil.rmtree, _SCRATCH[0], True)
    return _SCRATCH[0]


def empty(run: dict) -> sqlite3.Connection:
    """A gatherer with the run's schema and event types, and no rows: in a file of its own, which a cache kept by
    database file (files.py's `_git`) tells from any other replay's."""
    fd, path = tempfile.mkstemp(prefix="chat-run-", suffix=".db", dir=_scratch())
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    for sql in run["schema"]:
        conn.execute(sql)
    for table in ("event_types", "event_type_properties"):
        for row in run.get(table, []):
            _insert(conn, table, row)
    conn.commit()
    return conn


def moments(run: dict, late: Optional[Dict[str, float]] = None, typed: bool = False) -> Iterator[Moment]:
    """Each moment something changed in the run, in order -- a row stored, a table's rows changed in place, the session
    changed -- with the gatherer built up to it. `late`: {source (SOURCES): seconds} it is seen after it came. `typed`:
    as if each message had been typed into its terminal, not sent from Chat -- no send kept (`chat_sent`, the session's
    `sent`); the harness's record of each is the same."""
    late = late or {}
    unknown = set(late) - set(SOURCES)
    if unknown:
        raise ValueError(f"no such source: {', '.join(sorted(unknown))}")
    types = {t["event_type_id"]: t["name"] for t in run.get("event_types", [])}
    changes = []                                           # (at, order, kind, what)
    kept = {id(row): sent for row, (_, sent) in _sent_rows(run, types)}
    withdrawn = _withdrawn_at(run)
    for i, table in enumerate(("events", "_reads")):
        for row in run.get(table, []):
            if typed and types.get(row.get("event_type_id")) == "chat_sent":
                continue
            if id(row) in kept:                            # stored as the dashboard now stores it: its time and id
                f = json.loads(row["payload_json"] or "{}")
                row = dict(row, payload_json=json.dumps(dict(f, at=kept[id(row)]["at"], cid=kept[id(row)]["cid"])))
            if types.get(row.get("event_type_id")) == "message_queued" and run.get("harness", "claude") == "claude":
                f = json.loads(row["payload_json"] or "{}")
                if "joins_after" not in f and isinstance(f.get("at"), (int, float)):   # Claude's record now says it
                    row = dict(row, payload_json=json.dumps(dict(f, joins_after=f["at"] + claude.BUSY_SECONDS)))
            if types.get(row.get("event_type_id")) == "call_failed" and row.get("p_read_id") in withdrawn:
                # the hook now withdraws a call's events before it records the hang-up (Claude's `failed`)
                row = dict(row, _at=max(row["_at"], withdrawn[row["p_read_id"]] + 0.0005))
            changes.append((row["_at"] + late.get(_source(table, row, types), 0.0), i, "row", (table, row)))
    for table, snaps in run.get("sampled", {}).items():
        if table == "_withdrawn":
            for at, change in _withdrawals(run, snaps):
                changes.append((at, 2, "withdrawn", change))
            continue
        for snap in snaps:
            changes.append((snap["at"] + late.get("checks", 0.0), 2, "table", (table, snap["rows"])))
    for s in run.get("sessions", []):
        changes.append((s["at"] + late.get("session", 0.0), 3, "session", s["state"]))
    for at, sent in ([] if typed else _sent(run, types)):
        changes.append((at, 4, "sent", sent))
    changes.sort(key=lambda c: (c[0], c[1]))
    conn, session, sent, done = empty(run), None, [], []
    actions = sorted(run.get("actions", []), key=lambda x: x["at"])
    i = 0
    while i < len(changes):
        at = changes[i][0]
        while i < len(changes) and changes[i][0] == at:   # all that changed at once
            _, _, kind, what = changes[i]
            if kind == "row":
                _insert(conn, *what)
            elif kind == "withdrawn":
                how, row = what
                if how == "add":
                    _insert(conn, "_withdrawn", row)
                else:
                    conn.execute("DELETE FROM _withdrawn WHERE row_id = ?", (row["row_id"],))
            elif kind == "table":
                table, rows = what
                conn.execute(f"DELETE FROM {table} WHERE channel_key = ?", (run["channel"],))
                for row in rows:
                    _insert(conn, table, row)
            elif kind == "sent":
                sent = sent + [what]
            else:
                session = what
            i += 1
        conn.commit()
        done = [a for a in actions if a["at"] <= at]
        state = session
        if typed and (session or {}).get("session"):     # none kept by the dashboard either
            state = dict(session, session=dict(session["session"], sent=[]))
        if sent:                                           # the dashboard's sends, known to it as each came
            state = dict(session or {})
            state["session"] = dict(state.get("session") or {}, sent=sent)
        yield Moment(at, conn, state, done)


def _withdrawals(run: dict, snaps: List[dict]) -> List[tuple]:
    """The run's withdrawals and restores, each when ag made it: [(at, ("add" | "remove", row))]. The recorder sampled
    the table; ag stamps each withdrawal (`withdrawn_at`), and restores one as it stores the conversation of the call
    that sends it again, before that call's read is logged (ag's store.insert, `sent_again`) -- so no later than the
    first read logged since the sample before."""
    reads = sorted(r["_at"] for r in run.get("_reads", []))
    out, had, before = [], {}, None
    for snap in snaps:
        now = {r["row_id"]: r for r in snap["rows"]}
        for row_id, row in now.items():
            if row_id not in had or had[row_id] != row:
                stamp = row.get("withdrawn_at")
                at = _seconds(stamp) if stamp else snap["at"]
                out.append((at, ("add", row)))
        for row_id, row in had.items():
            if row_id not in now:
                read = next((r for r in reads if before is not None and before < r <= snap["at"]), None)
                out.append((read - 0.001 if read is not None else snap["at"], ("remove", row)))
        had, before = now, snap["at"]
    return out


def _withdrawn_at(run: dict) -> Dict[int, float]:
    """When ag first withdrew each read's events (`withdrawn_at`), by read."""
    out: Dict[int, float] = {}
    for snap in run.get("sampled", {}).get("_withdrawn", []):
        for r in snap["rows"]:
            if r.get("read_id") is not None and r.get("withdrawn_at"):
                out[r["read_id"]] = min(out.get(r["read_id"], float("inf")), _seconds(r["withdrawn_at"]))
    return out


def _seconds(stamp) -> float:
    return datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).timestamp()


def _sent(run: dict, types: Dict[int, str]) -> List[tuple]:
    """The sends from Chat as the dashboard knows them in memory (sessions.py's `send`: kept as each came, before it is
    typed), with when it came to know each: [(at, {cid, text, at})] -- each `chat_sent` the run stored, from the page's
    Enter that sent it (the latest before the time it has), its id as chat_view's `send_id` makes it from that time. In
    memory, never late: what the harness then does comes after it."""
    return [x for _, x in _sent_rows(run, types)]


def _sent_rows(run: dict, types: Dict[int, str]) -> List[tuple]:
    """`_sent`'s, each with its `chat_sent` row: [(row, (at, {cid, text, at}))]. The recordings stored a send's time as
    the dashboard had it once it had typed it, and no id; the dashboard now keeps it, and stores it, from the moment it
    came, with its id -- which the replay stores in its place."""
    enters = sorted(a["at"] for a in run.get("actions", []) if a.get("what") == "key Enter")
    out = []
    for row in run.get("events", []):
        if types.get(row["event_type_id"]) != "chat_sent":
            continue
        f = json.loads(row["payload_json"] or "{}")
        if not isinstance(f.get("at"), (int, float)) or not f.get("text"):
            continue
        if f.get("cid"):                                   # recorded as the dashboard keeps it now
            out.append((row, (f["at"], {"cid": f["cid"], "text": f["text"], "at": f["at"]})))
            continue
        came = max((e for e in enters if e <= f["at"]), default=f["at"])
        out.append((row, (came, {"cid": "chat:%.6f" % came, "text": f["text"], "at": came})))
    return out


def at_end(run: dict) -> sqlite3.Connection:
    """The gatherer as it stood at the run's end."""
    conn = None
    for m in moments(run):
        conn = m.conn
    return conn if conn is not None else empty(run)
