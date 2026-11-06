"""The folders the reader keeps a gatherer's actors in: the list's tree, the gatherer its top. Kept in the dashboard's
own database (<home>/dashboard.db, beside saved.py's and hiding.py's tables), so every dashboard on this home shows the
same ones. Folders only organise the list: what a gatherer's actors share of one another's context is the gatherer's,
whatever folder each is in, and an actor never leaves its gatherer.

Table `folders`, one row per folder, kept until it is deleted, empty or not:

    id          its number (never used again)
    gatherer    the gatherer it is in
    parent      the folder it is in; NULL: the gatherer's top level
    name        unique among the folders beside it, whatever its case; never holding "/", which joins a folder's
                name to those it is in into its PATH (`Harnesses/Codex`), as `ag actors` names a folder
    at          when it was made (ISO, UTC)

Table `filed`, one row per actor in a folder (none: at its gatherer's top level):

    gatherer, channel   the actor, by the channel it was filed as: its own, or the id the dashboard started it under
                        (a Codex session's, before its thread's id comes with its first turn) -- the page and
                        `ag actors` find it by either, as they find saved.py's bookmark
    folder              the folder's id
    at                  when it was put there

Saving an actor (saved.py's bookmark) is apart from this: saved or not, an actor is in its folder; a saved one, once
closed, is listed in its folder's "saved" line, not with the closed ones. A folder deleted, what was in it -- actors
and folders -- moves up into the one it was in.

THE FOLDERS OF SAVED ACTORS that saved.py kept before this module (table `saved_folders`, column `saved.folder`) are
copied here once, when this module first makes its tables: each one a folder at its gatherer's top level, each saved
actor in one filed in it (and still saved). saved.py's are left as they were, no longer read."""

import os
import sqlite3
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional

from . import sessions

FOLDER_CHARS = 60               # the longest name a folder takes
TOP = ("", "/", "top")          # what names the gatherer's top level, where a folder is asked for by path

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS folders (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    gatherer TEXT NOT NULL,
    parent   INTEGER,
    name     TEXT NOT NULL,
    at       TEXT NOT NULL
)""",
    "CREATE UNIQUE INDEX IF NOT EXISTS folders_named ON folders (gatherer, ifnull(parent, 0), name COLLATE NOCASE)",
    """CREATE TABLE IF NOT EXISTS filed (
    gatherer TEXT NOT NULL,
    channel  TEXT NOT NULL,
    folder   INTEGER NOT NULL,
    at       TEXT NOT NULL,
    PRIMARY KEY (gatherer, channel)
)""",
)


class FolderError(ValueError):
    """A folder that cannot be made, named, moved or found as asked: its text says why."""


def folder_name(text) -> str:
    """A folder's name as given, its spaces made one and its ends trimmed; FolderError for none, or one with "/"."""
    name = " ".join(str(text or "").split())[:FOLDER_CHARS].strip()
    if not name:
        raise FolderError("which folder? Give it a name")
    if "/" in name:
        raise FolderError(f'"{name}": a folder\'s name can\'t hold "/" (it joins the names of folders in folders)')
    return name


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _has(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone() is not None


def _from_saved(conn: sqlite3.Connection) -> None:
    """saved.py's folders of saved actors copied in (module doc): each at its gatherer's top, its actors filed in it."""
    if not _has(conn, "saved_folders"):
        return
    made: Dict[tuple, int] = {}
    for g, name, at in conn.execute("SELECT gatherer, name, at FROM saved_folders ORDER BY gatherer, at").fetchall():
        clean = " ".join(str(name).replace("/", "-").split())[:FOLDER_CHARS] or "Folder"
        if (g, clean.lower()) in made:
            continue
        cur = conn.execute("INSERT INTO folders (gatherer, parent, name, at) VALUES (?, NULL, ?, ?)", (g, clean, at))
        made[(g, clean.lower())] = made[(g, str(name).lower())] = cur.lastrowid
    if made and _has(conn, "saved") and "folder" in [r[1] for r in conn.execute("PRAGMA table_info(saved)")]:
        for g, c, f, at in conn.execute("SELECT gatherer, channel, folder, at FROM saved WHERE folder IS NOT NULL").fetchall():
            fid = made.get((g, str(f).lower()))
            if fid is not None:
                conn.execute("INSERT OR IGNORE INTO filed (gatherer, channel, folder, at) VALUES (?, ?, ?, ?)", (g, c, fid, at))


def _write() -> sqlite3.Connection:
    """The dashboard's database, for a change: this module's tables made the first time, saved.py's folders copied in."""
    os.makedirs(os.path.dirname(sessions.db_path()), exist_ok=True)
    conn = sqlite3.connect(sessions.db_path(), timeout=8, isolation_level=None)
    if _has(conn, "folders"):
        return conn
    try:
        conn.execute("BEGIN IMMEDIATE")
        if not _has(conn, "folders"):                   # another made them meanwhile
            for statement in SCHEMA:
                conn.execute(statement)
            _from_saved(conn)
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        conn.close()
        raise
    return conn


def ensure() -> None:
    """The tables made, and saved.py's folders copied in, if not yet: at the dashboard's start."""
    _write().close()


def stored() -> Dict[str, dict]:
    """{gatherer: {folders: [{id, parent, name}] (by name, whatever its case), filed: {channel: folder id}}}, of every
    gatherer with a folder: {} when there is none yet."""
    if not os.path.exists(sessions.db_path()):
        return {}
    conn = sqlite3.connect(f"file:{sessions.db_path()}?mode=ro", uri=True, timeout=8)
    try:
        if not _has(conn, "folders"):
            conn.close()
            ensure()                                    # made, and saved.py's copied, at the first read
            conn = sqlite3.connect(f"file:{sessions.db_path()}?mode=ro", uri=True, timeout=8)
        found: Dict[str, dict] = {}
        for fid, g, parent, name in conn.execute("SELECT id, gatherer, parent, name FROM folders ORDER BY gatherer, lower(name), name"):
            found.setdefault(g, {"folders": [], "filed": {}})["folders"].append({"id": fid, "parent": parent, "name": name})
        for g, c, fid in conn.execute("SELECT gatherer, channel, folder FROM filed ORDER BY at"):
            found.setdefault(g, {"folders": [], "filed": {}})["filed"][c] = fid
        return found
    except sqlite3.Error:
        return {}
    finally:
        conn.close()


def of(gatherer: str) -> dict:
    """`stored()` of one gatherer: {folders, filed}, both empty for a gatherer with none."""
    return stored().get(gatherer) or {"folders": [], "filed": {}}


# ---- changes: each in one transaction, its gatherer's folders after

def _change(gatherer: str, do) -> sqlite3.Connection:
    """`do(conn)` in a transaction of its own (BEGIN IMMEDIATE), rolled back if it raises."""
    if not gatherer:
        raise FolderError("which gatherer?")
    conn = _write()
    try:
        conn.execute("BEGIN IMMEDIATE")
        got = do(conn)
        conn.execute("COMMIT")
        return got
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def _folder(conn: sqlite3.Connection, gatherer: str, fid) -> tuple:
    """(id, parent, name) of the folder `fid` of `gatherer`; FolderError for none."""
    try:
        fid = int(fid)
    except (TypeError, ValueError):
        raise FolderError(f"which folder? {fid!r} is none") from None
    row = conn.execute("SELECT id, parent, name FROM folders WHERE id = ? AND gatherer = ?", (fid, gatherer)).fetchone()
    if row is None:
        raise FolderError(f"no folder {fid} in {gatherer}")
    return row


def _beside(conn: sqlite3.Connection, gatherer: str, parent: Optional[int], name: str, but: Optional[int] = None) -> Optional[str]:
    """The name of a folder in `parent` (None: the top) already named `name`, whatever its case, but `but`."""
    row = conn.execute("SELECT name FROM folders WHERE gatherer = ? AND ifnull(parent, 0) = ? AND name = ? COLLATE NOCASE "
                       "AND id != ?", (gatherer, parent or 0, name, but or 0)).fetchone()
    return row[0] if row else None


def make(gatherer: str, name: str, parent: Optional[int] = None) -> int:
    """A new folder, empty, in `parent` (None: the gatherer's top) -> its id. FolderError for no such parent, or one
    beside it already named so."""
    name = folder_name(name)

    def do(conn):
        if parent is not None:
            _folder(conn, gatherer, parent)
        other = _beside(conn, gatherer, parent, name)
        if other is not None:
            raise FolderError(f'there is a folder "{other}" there already')
        return conn.execute("INSERT INTO folders (gatherer, parent, name, at) VALUES (?, ?, ?, ?)",
                            (gatherer, parent, name, _now())).lastrowid
    return _change(gatherer, do)


def rename(gatherer: str, fid: int, to: str) -> None:
    """The folder named `to`, what is in it still in it. FolderError for no such folder, or one beside it named so."""
    to = folder_name(to)

    def do(conn):
        _, parent, _ = _folder(conn, gatherer, fid)
        other = _beside(conn, gatherer, parent, to, but=int(fid))
        if other is not None:
            raise FolderError(f'there is a folder "{other}" there already')
        conn.execute("UPDATE folders SET name = ? WHERE id = ?", (to, int(fid)))
    _change(gatherer, do)


def move(gatherer: str, fid: int, parent: Optional[int]) -> None:
    """The folder, and all in it, put in `parent` (None: the gatherer's top). FolderError for no such folder, a folder
    put in itself or in one of its own, or one there named as it is."""
    def do(conn):
        _, _, name = _folder(conn, gatherer, fid)
        if parent is not None:
            up = _folder(conn, gatherer, parent)[0]
            while up is not None:                       # its own folders, up to the top
                if up == int(fid):
                    raise FolderError(f'"{name}" can\'t go in itself, nor in a folder of its own')
                up = conn.execute("SELECT parent FROM folders WHERE id = ?", (up,)).fetchone()[0]
        other = _beside(conn, gatherer, parent, name, but=int(fid))
        if other is not None:
            raise FolderError(f'there is a folder "{other}" there already')
        conn.execute("UPDATE folders SET parent = ? WHERE id = ?", (parent, int(fid)))
    _change(gatherer, do)


def delete(gatherer: str, fid: int) -> None:
    """The folder gone, what was in it -- its actors, its folders -- moved up into the one it was in (module doc). A
    folder moved up next to one of its name keeps its own, with " 2" (" 3", ...) after it."""
    def do(conn):
        _, parent, _ = _folder(conn, gatherer, fid)
        for cid, cname in conn.execute("SELECT id, name FROM folders WHERE parent = ?", (int(fid),)).fetchall():
            name, n = cname, 1
            while _beside(conn, gatherer, parent, name, but=cid) is not None:
                n += 1
                name = f"{cname} {n}"
            conn.execute("UPDATE folders SET parent = ?, name = ? WHERE id = ?", (parent, name, cid))
        if parent is None:
            conn.execute("DELETE FROM filed WHERE folder = ?", (int(fid),))
        else:
            conn.execute("UPDATE filed SET folder = ? WHERE folder = ?", (parent, int(fid)))
        conn.execute("DELETE FROM folders WHERE id = ?", (int(fid),))
    _change(gatherer, do)


def file(gatherer: str, channels: Iterable[str], folder: Optional[int]) -> None:
    """The actors (by the channels they are filed as, or would be) put in `folder` (None: the gatherer's top).
    FolderError for no such folder."""
    channels = [c for c in dict.fromkeys(str(c or "").strip() for c in channels) if c]
    if not channels:
        raise FolderError("which actors?")

    def do(conn):
        if folder is None:
            conn.executemany("DELETE FROM filed WHERE gatherer = ? AND channel = ?", [(gatherer, c) for c in channels])
            return
        fid = _folder(conn, gatherer, folder)[0]
        at = _now()
        conn.executemany("INSERT INTO filed (gatherer, channel, folder, at) VALUES (?, ?, ?, ?) "
                         "ON CONFLICT (gatherer, channel) DO UPDATE SET folder = excluded.folder, at = excluded.at",
                         [(gatherer, c, fid, at) for c in channels])
    _change(gatherer, do)


# ---- folders by path, as `ag actors` names them

def path(tree: dict, fid: Optional[int]) -> Optional[str]:
    """The folder `fid`'s path in `of()`'s `tree` (`Harnesses/Codex`); None for none, or no such folder."""
    by = {f["id"]: f for f in tree.get("folders") or []}
    names, seen = [], set()
    while fid in by and fid not in seen:
        seen.add(fid)
        names.append(by[fid]["name"])
        fid = by[fid]["parent"]
    return "/".join(reversed(names)) or None


def _parts(text: str) -> List[str]:
    return [folder_name(p) for p in str(text or "").strip().strip("/").split("/")]


def find(gatherer: str, where: str) -> Optional[int]:
    """The folder of `gatherer` at the path `where` (its names, whatever their case), None for the top (TOP); FolderError
    for no such folder."""
    if str(where or "").strip().lower() in TOP:
        return None
    tree, parent = of(gatherer), None
    for part in _parts(where):
        hit = next((f for f in tree["folders"] if f["parent"] == parent and f["name"].lower() == part.lower()), None)
        if hit is None:
            raise FolderError(f'no folder "{where.strip().strip("/")}" in {gatherer}')
        parent = hit["id"]
    return parent


def find_or_make(gatherer: str, where: str) -> Optional[int]:
    """`find`, the folders of the path that are not there made: the folder's id (None: the top)."""
    if str(where or "").strip().lower() in TOP:
        return None
    parent = None
    for part in _parts(where):
        tree = of(gatherer)
        hit = next((f for f in tree["folders"] if f["parent"] == parent and f["name"].lower() == part.lower()), None)
        parent = hit["id"] if hit else make(gatherer, part, parent)
    return parent
