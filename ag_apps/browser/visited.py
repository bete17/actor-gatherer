"""The pages the Browsers went to (ag_apps/browser/), for the address bar's suggestions: a Chrome with no window
(the dashboard's own, headless; a native page of the desktop app's, which keeps no history at all) shows no address bar
of its own, so nothing of its history comes up as the user types. The Browser keeps its own list instead, and the
panel's address bar suggests from it (backend.py's `visited` route).

One row a page (`visited`, in the app's database): its address, its title, how often it was opened and how often the
user typed it or chose it in the address bar (`typed`), and when last. Every page a tab of any Browser of the home goes
to -- the user's and the agent's alike, as Chrome's own history has them -- shared by every Browser, as the Chrome's
logins are. Only web pages (http, https), never one with a name and password in its address; at most KEEP, the oldest
dropped. Started, once, from the dashboard's own Chrome's history, where it has one (`seed`).

Standard library only."""
import math
import os
import re
import shutil
import sqlite3
import tempfile
import time
import urllib.parse
from typing import List, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS visited (
    url     TEXT PRIMARY KEY,
    title   TEXT NOT NULL DEFAULT '',
    visits  INTEGER NOT NULL DEFAULT 0,
    typed   INTEGER NOT NULL DEFAULT 0,
    last    REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS visited_last ON visited (last);"""

KEEP = 5000                 # pages kept, at most: the ones opened longest ago dropped first
LONGEST = 2048              # characters of an address kept, at most: a longer one is not kept
TITLE = 300                 # characters of a title kept
SHOWN = 8                   # suggestions, at most
CANDIDATES = 500            # rows looked at for them, the latest first
HALF_LIFE = 14 * 86400.0    # seconds over which a page's weight halves, unopened
TYPED_WEIGHT = 4            # a typed or chosen opening, as many plain ones
CHROME_EPOCH = 11644473600  # seconds from 1601-01-01 (Chrome's history's times, in microseconds) to 1970-01-01


def keepable(url: str) -> bool:
    """A web page's address, not too long, with no name or password in it."""
    if not re.match(r"https?://", url or "", re.I) or len(url) > LONGEST:
        return False
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    return bool(parts.hostname) and parts.username is None and parts.password is None


def bare(url: str) -> str:
    """An address as one types it: without its scheme and "www."."""
    return re.sub(r"^www\.", "", re.sub(r"^https?://", "", url or "", flags=re.I), flags=re.I)


def visit(conn: sqlite3.Connection, url: str, title: str = "", typed: bool = False,
          at: Optional[float] = None) -> None:
    """`url` opened (`typed`: the user typed it, or chose it, in the address bar)."""
    if not keepable(url):
        return
    conn.execute(
        "INSERT INTO visited (url, title, visits, typed, last) VALUES (?, ?, 1, ?, ?) ON CONFLICT(url) DO UPDATE SET "
        "visits = visits + 1, typed = typed + excluded.typed, last = excluded.last, "
        "title = CASE WHEN excluded.title != '' THEN excluded.title ELSE title END",
        (url, (title or "")[:TITLE], int(bool(typed)), time.time() if at is None else at))
    over = conn.execute("SELECT count(*) FROM visited").fetchone()[0] - KEEP
    if over > 0:
        conn.execute("DELETE FROM visited WHERE url IN (SELECT url FROM visited ORDER BY last LIMIT ?)", (over,))


def retitle(conn: sqlite3.Connection, url: str, title: str) -> None:
    """The title `url`'s page has now -- not its address, which Chrome names a page by until it has a title."""
    if title and keepable(url) and bare(title).rstrip("/") != bare(url).rstrip("/"):
        conn.execute("UPDATE visited SET title = ? WHERE url = ?", (title[:TITLE], url))


def forget(conn: sqlite3.Connection, url: str) -> None:
    conn.execute("DELETE FROM visited WHERE url = ?", (url,))


def _like(text: str) -> str:
    return "%" + re.sub(r"([\\%_])", r"\\\1", text) + "%"


def suggest(conn: sqlite3.Connection, q: str, n: int = SHOWN, now: Optional[float] = None) -> List[dict]:
    """The pages to suggest for what is typed in the address bar, `q`, best first: [{url, title}]. A page is one whose
    address or title has every word of `q`. The best are those whose address starts with it, as typed ("git" for
    https://github.com/), a site's own page before its others; then those with a word starting with it; then the rest.
    Within each, the more often (typed above all) and the more lately opened first."""
    start = bare((q or "").strip().lower())          # ("https://www.git": "git", as the addresses are matched)
    words = start.split()
    if not words:
        return []
    now = time.time() if now is None else now
    rows = conn.execute("SELECT url, title, visits, typed, last FROM visited WHERE url LIKE ? ESCAPE '\\' "
                        "OR title LIKE ? ESCAPE '\\' ORDER BY last DESC LIMIT ?",
                        (_like(words[0]), _like(words[0]), CANDIDATES)).fetchall()
    scored = []
    for url, title, visits, typed, last in rows:
        b = bare(url).lower()
        text = f"{b} {(title or '').lower()}"
        if not all(w in text for w in words):
            continue
        site, _, rest = b.partition("/")
        if b.startswith(start):
            match = 12.0 if site.startswith(start) and rest.strip("/") == "" else 6.0
        elif re.search(r"(^|[^a-z0-9])" + re.escape(words[0]), text):
            match = 3.0
        else:
            match = 1.0
        weight = math.log2(2 + visits + TYPED_WEIGHT * typed) * (0.2 + 0.5 ** (max(0.0, now - last) / HALF_LIFE))
        scored.append((match * weight, last, url, title or ""))
    scored.sort(key=lambda s: (-s[0], -s[1]))
    return [{"url": url, "title": title} for _, _, url, title in scored[:n]]


def seed(conn: sqlite3.Connection, profile: str) -> int:
    """The pages in the Chrome profile `profile`'s history (its Default/History: the dashboard's own Chrome's), added to
    those kept -- what is here already wins. How many were. The history is read from a copy: Chrome may have it open."""
    path = os.path.join(profile, "Default", "History")
    if not os.path.isfile(path):
        return 0
    with tempfile.TemporaryDirectory(prefix="ag-history-") as tmp:
        copy = os.path.join(tmp, "History")
        shutil.copyfile(path, copy)
        src = sqlite3.connect(f"file:{copy}?mode=ro", uri=True, timeout=5)
        try:
            rows = src.execute("SELECT url, title, visit_count, typed_count, last_visit_time FROM urls WHERE hidden = 0 "
                               "ORDER BY last_visit_time DESC LIMIT ?", (KEEP,)).fetchall()
        finally:
            src.close()
    added = 0
    for url, title, visits, typed, when in rows:
        if not keepable(url or ""):
            continue
        at = (when or 0) / 1e6 - CHROME_EPOCH
        added += conn.execute("INSERT OR IGNORE INTO visited (url, title, visits, typed, last) VALUES (?, ?, ?, ?, ?)",
                              (url, (title or "")[:TITLE], max(1, int(visits or 0)), max(0, int(typed or 0)),
                               max(0.0, at))).rowcount
    return added
