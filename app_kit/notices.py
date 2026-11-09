"""NOTIFICATIONS an app sends the user (manifest.NOTICE_TYPES): what one may say (`made`), and which are open from an
instance's records (`still_open`) -- as an agent's `asked` is open until its `ask_settled`. Standard library only."""

import json
import secrets
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .backend import AppError
from .manifest import NOTICE_KEY_CHARS, NOTICE_TEXT_CHARS, NOTICE_TITLE_CHARS, NOTICE_WHERE_BYTES, SHOWS


def _line(text: Any, most: int, what: str, need: bool = False) -> str:
    if text is None:
        text = ""
    if not isinstance(text, str):
        raise AppError(f"notify: {what} is text")
    said = " ".join(text.split())
    if need and not said:
        raise AppError(f"notify: a {what}, please")
    return said if len(said) <= most else said[:most - 1].rstrip() + "…"


def made(title: Any, text: Any = "", key: Any = None, show: Any = ("ag",), where: Any = None) -> dict:
    """An `app_notified` record's payload, after the host's checks: {id, key, title, text, show, where}. Its title
    and text one line each (cut to fit), `show` some of SHOWS ("ag" always), `where` JSON of at most
    NOTICE_WHERE_BYTES."""
    shows = [show] if isinstance(show, str) else list(show or ())
    if not all(isinstance(x, str) and x in SHOWS for x in shows):
        raise AppError(f"notify: show is some of {', '.join(SHOWS)}")
    if key is not None and (not isinstance(key, str) or not key.strip() or len(key) > NOTICE_KEY_CHARS):
        raise AppError(f"notify: a key is text of at most {NOTICE_KEY_CHARS} characters")
    try:
        size = len(json.dumps(where))
    except (TypeError, ValueError):
        raise AppError("notify: where is JSON") from None
    if size > NOTICE_WHERE_BYTES:
        raise AppError(f"notify: where is at most {NOTICE_WHERE_BYTES} bytes of JSON")
    return {"id": secrets.token_hex(6), "key": key.strip() if key else None,
            "title": _line(title, NOTICE_TITLE_CHARS, "title", need=True),
            "text": _line(text, NOTICE_TEXT_CHARS, "text"),
            "show": [x for x in SHOWS if x == "ag" or x in shows], "where": where}


def settled(which: Any, how: str) -> dict:
    """An `app_notice_settled` record's payload: {id} or {key} -- an id is 12 hex characters; else a key -- and `how`."""
    if not isinstance(which, str) or not which.strip():
        raise AppError("which notification: its id, or its key?")
    which = which.strip()
    is_id = len(which) == 12 and all(c in "0123456789abcdef" for c in which)
    return {("id" if is_id else "key"): which, "how": how}


def still_open(records: Iterable[Tuple[str, str, dict]]) -> Dict[str, List[dict]]:
    """{instance: its open notifications, oldest first} from its records [(kind, instance, payload)], in order:
    each `app_notified` not settled since -- by its id, or its key -- nor taken the place of by a newer one of its key,
    its instance not closed since (`app_closed`). Each {id, key, title, text, show, where, at}."""
    out: Dict[str, List[dict]] = {}
    for kind, inst, p in records:
        if not inst or not isinstance(p, dict):
            continue
        if kind == "app_closed":
            out.pop(inst, None)
        elif kind == "app_notified" and p.get("id") and p.get("title"):
            have = [n for n in out.get(inst, []) if not (p.get("key") and n.get("key") == p.get("key"))]
            have.append({k: p.get(k) for k in ("id", "key", "title", "text", "show", "where", "at")})
            out[inst] = have
        elif kind == "app_notice_settled":
            have = out.get(inst, [])
            out[inst] = [n for n in have
                         if not ((p.get("id") and n["id"] == p["id"]) or (p.get("key") and n.get("key") == p["key"]))]
    return {i: ns for i, ns in out.items() if ns}


def newest(notices: Sequence[dict]) -> Optional[float]:
    """When the newest of them came: what the reader's last look at the instance is compared with."""
    return max((n.get("at") or 0 for n in notices), default=0) or None
