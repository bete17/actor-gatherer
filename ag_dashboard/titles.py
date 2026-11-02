"""The reader's names for gatherers, kept in the dashboard's own database (<home>/dashboard.db, next to
sessions.py's table), so every dashboard on this home shows the same. Table `titles`, one row per gatherer named:

    gatherer  its name: ag's, its directory's, the one every actor and command goes by
    title     the reader's name for it, which the page shows in its place
    at        when it was given (ISO, UTC)

Only what the page shows: the gatherer itself, its directory and its actors keep its name."""

import os
import sqlite3
from datetime import datetime, timezone
from typing import Dict

from . import sessions

TITLE_CHARS = 80
SCHEMA = """CREATE TABLE IF NOT EXISTS titles (
    gatherer TEXT PRIMARY KEY,
    title    TEXT NOT NULL,
    at       TEXT NOT NULL
)"""


def stored() -> Dict[str, str]:
    """{gatherer: title}, read-only: {} when nothing is kept yet."""
    if not os.path.exists(sessions.db_path()):
        return {}
    conn = sqlite3.connect(f"file:{sessions.db_path()}?mode=ro", uri=True, timeout=8)
    try:
        return {g: t for g, t in conn.execute("SELECT gatherer, title FROM titles ORDER BY gatherer")}
    except sqlite3.Error:                # no table yet
        return {}
    finally:
        conn.close()


def give(gatherer: str, title: str) -> Dict[str, str]:
    """`title` (one line, its spaces single; "" takes it back) for `gatherer`: every title, after."""
    if not gatherer:
        raise ValueError("which gatherer?")
    title = " ".join((title or "").split())[:TITLE_CHARS].strip()
    os.makedirs(os.path.dirname(sessions.db_path()), exist_ok=True)
    conn = sqlite3.connect(sessions.db_path(), timeout=8, isolation_level=None)
    try:
        conn.execute(SCHEMA)
        if title and title != gatherer:
            conn.execute("INSERT INTO titles (gatherer, title, at) VALUES (?, ?, ?) "
                         "ON CONFLICT (gatherer) DO UPDATE SET title = excluded.title, at = excluded.at",
                         (gatherer, title, datetime.now(timezone.utc).isoformat()))
        else:
            conn.execute("DELETE FROM titles WHERE gatherer = ?", (gatherer,))
    finally:
        conn.close()
    return stored()
