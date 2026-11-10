"""arXiv's listings, fetched and read: the day's announcement from its RSS feed, and a day the app missed from its
catch-up page.

    rss(categories)          the latest listing of those categories (one request): a Listing -- its day, and its papers
    catchup(category, day)   a past day's listing of one category, from arxiv.org/catchup (an HTML page): its papers
    merged(lists)            papers of several categories' listings as one: each paper once, its categories together,
                             "new" where it was new in any of them
    listing_day(now)         the day whose listing is out at `now`: arXiv announces Sunday to Thursday at 20:00 New
                             York time, and the feed carries it from midnight, as the next weekday's
    weekdays(after, until)   the listing days between two

arXiv asks programs to send at most one request every 3 seconds (PAUSE), and to say who they are (USER_AGENT). Its
search API (export.arxiv.org/api) is not used: it has no notion of what was announced on a day, and it often refuses
with 429. Standard library only."""

import email.utils
import html
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from typing import Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

USER_AGENT = "ag-paper-news/1 (the ag dashboard's Paper news app; a few requests a day)"
RSS = "https://rss.arxiv.org/rss/{categories}"
CATCHUP = "https://arxiv.org/catchup/{category}/{day}?abs=True"
ABS, PDF, HTML_URL = "https://arxiv.org/abs/{id}", "https://arxiv.org/pdf/{id}", "https://arxiv.org/html/{id}"
NEW_YORK = ZoneInfo("America/New_York")
ANNOUNCED_AT = 20               # arXiv's announcement, 20:00 New York time, Sunday to Thursday
PAUSE = 3.0                     # seconds between requests to arXiv
TIMEOUT = 60.0
#: How a paper came to be in a listing, most to least: new to arXiv in one of the categories; new in another category
#: and cross-listed here; a new version of an older paper; a new version of a cross-listed one.
KINDS = ("new", "cross", "replace", "replace-cross")
CATEGORY = re.compile(r"^([a-z][a-z-]*)(\.[A-Za-z]{2,})?$")    # cs.AI, cs.DB, stat.ML, hep-th, math.OC
#: arXiv's archives: what a category starts with (cs.AI is cs's), or a category itself (hep-th)
ARCHIVES = frozenset(("astro-ph", "cond-mat", "cs", "econ", "eess", "gr-qc", "hep-ex", "hep-lat", "hep-ph", "hep-th",
                      "math", "math-ph", "nlin", "nucl-ex", "nucl-th", "physics", "q-bio", "q-fin", "quant-ph", "stat"))


def is_category(name: str) -> bool:
    """Whether `name` is shaped as one of arXiv's categories, in one of its archives: cs.AI, stat.ML, hep-th."""
    m = CATEGORY.match(name) if isinstance(name, str) else None
    return bool(m) and m.group(1) in ARCHIVES
_NS = {"arxiv": "http://arxiv.org/schemas/atom", "dc": "http://purl.org/dc/elements/1.1/"}


class FetchError(Exception):
    """arXiv couldn't be read: what happened, and whether trying again later may help (`later`)."""

    def __init__(self, message: str, later: bool = True):
        super().__init__(message)
        self.later = later


@dataclass(frozen=True)
class Paper:
    id: str                                   # 2611.06952: no version
    title: str
    authors: Tuple[str, ...] = ()
    abstract: str = ""
    categories: Tuple[str, ...] = ()          # its first is its primary category, as arXiv lists them
    kind: str = "new"                         # KINDS
    version: Optional[int] = None
    journal_ref: str = ""
    doi: str = ""
    comments: str = ""

    @property
    def primary(self) -> str:
        return self.categories[0] if self.categories else ""


@dataclass
class Listing:
    """A day's listing as the feed has it: `day` its date ("YYYY-MM-DD", the announcement's, as arXiv dates it), and
    its papers; none when the announcement isn't out yet or there was none that day."""
    day: str
    papers: List[Paper] = field(default_factory=list)
    built: str = ""                           # when arXiv built the feed (its lastBuildDate)


# ---------------------------------------------------------------- fetching


def get(url: str, timeout: float = TIMEOUT) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        later = exc.code in (408, 429) or exc.code >= 500
        raise FetchError(f"arXiv answered {exc.code} {exc.reason} for {url}", later) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise FetchError(f"couldn't reach arXiv ({getattr(exc, 'reason', exc)})") from None


def rss(categories: Iterable[str], fetch=get) -> Listing:
    """The latest listing of `categories`, in one request (arXiv's feed takes them joined by "+")."""
    cats = "+".join(categories)
    return parse_rss(fetch(RSS.format(categories=cats)))


def catchup(category: str, day: str, fetch=get, pause: float = PAUSE) -> List[Paper]:
    """`category`'s listing of `day` ("YYYY-MM-DD"), from its catch-up page: a page at a time, for a listing longer than
    one (each `pause` seconds after the last)."""
    out: List[Paper] = []
    url = CATCHUP.format(category=category, day=day)
    for page in range(10):
        if page:
            time.sleep(pause)
        papers, complete = parse_catchup(fetch(url + (f"&page={page}" if page else "")).decode("utf-8", "replace"))
        out.extend(papers)
        if complete or not papers:
            break
    return out


# ---------------------------------------------------------------- reading


def parse_rss(data: bytes) -> Listing:
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise FetchError(f"arXiv's feed isn't readable XML ({exc})") from None
    ch = root.find("channel")
    if ch is None:
        raise FetchError("arXiv's feed has no channel")
    day = _day(ch.findtext("pubDate") or "")
    papers = []
    for it in ch.findall("item"):
        got = _item(it)
        if got is not None:
            papers.append(got)
    return Listing(day=day, papers=papers, built=(ch.findtext("lastBuildDate") or "").strip())


def _day(stamp: str) -> str:
    """A feed's pubDate as its day, in the time zone it is written in ("Tue, 10 Nov 2026 00:00:00 -0500" is
    2026-11-10)."""
    try:
        return email.utils.parsedate_to_datetime(stamp).date().isoformat()
    except (TypeError, ValueError, IndexError):
        return ""


_DESC = re.compile(r"^\s*arXiv:(\S+?)(?:v(\d+))?\s+Announce Type:\s*(\S+)\s*(?:Abstract:\s*)?(.*)$", re.S)


def _item(it) -> Optional[Paper]:
    desc = it.findtext("description") or ""
    m = _DESC.match(desc)
    guid = (it.findtext("guid") or "").strip()
    pid, version, kind, abstract = (m.group(1), m.group(2), m.group(3), m.group(4)) if m else ("", None, "", desc)
    if not pid:
        g = re.search(r"arXiv\.org:(\S+?)(?:v(\d+))?$", guid)
        if not g:
            return None
        pid, version = g.group(1), g.group(2)
    kind = (it.findtext("arxiv:announce_type", "", _NS) or kind or "new").strip()
    if kind not in KINDS:
        kind = "new"
    authors = _split_authors(it.findtext("dc:creator", "", _NS) or "")
    return Paper(id=pid, title=_text(it.findtext("title") or ""), authors=authors, abstract=_text(abstract),
                 categories=tuple(c.text.strip() for c in it.findall("category") if c.text and c.text.strip()),
                 kind=kind, version=int(version) if version else None,
                 journal_ref=_text(it.findtext("arxiv:journal_reference", "", _NS) or ""),
                 doi=_text(it.findtext("arxiv:DOI", "", _NS) or ""))


def _split_authors(text: str) -> Tuple[str, ...]:
    """The feed's authors, "A, B, C" (or "A, B and C"), one by one."""
    parts = re.split(r",\s*|\s+and\s+", _text(text))
    return tuple(p for p in parts if p)


def _text(s: str) -> str:
    return " ".join(html.unescape(s).split())


_H3 = re.compile(r"<h3>\s*([^<]*?)\s*</h3>", re.I)
_SHOWING = re.compile(r"showing\s+(\d+)\s+of\s+(\d+)", re.I)
_ENTRY = re.compile(r"<dt>(.*?)</dt>\s*<dd>(.*?)</dd>", re.S | re.I)


def parse_catchup(page: str) -> Tuple[List[Paper], bool]:
    """A catch-up page's papers, each with its kind from its section ("New submissions", "Cross submissions",
    "Replacement submissions"), and whether the page held every entry of every section it lists."""
    heads = list(_H3.finditer(page))
    papers: List[Paper] = []
    complete = True
    for n, h in enumerate(heads):
        title = h.group(1).lower()
        kind = "new" if title.startswith("new") else "cross" if title.startswith("cross") else \
            "replace" if title.startswith("replac") else None
        if kind is None:
            continue
        shown = _SHOWING.search(title)
        if shown and int(shown.group(1)) < int(shown.group(2)):
            complete = False
        body = page[h.end():heads[n + 1].start() if n + 1 < len(heads) else len(page)]
        for dt, dd in _ENTRY.findall(body):
            got = _entry(dt, dd, kind)
            if got is not None:
                papers.append(got)
    return papers, complete


def _strip(s: str) -> str:
    return _text(re.sub(r"<[^>]+>", " ", s))


def _div(dd: str, cls: str) -> str:
    m = re.search(r"<div class=['\"]" + cls + r"[^'\"]*['\"]>(.*?)</div>", dd, re.S)
    return m.group(1) if m else ""


def _entry(dt: str, dd: str, kind: str) -> Optional[Paper]:
    m = re.search(r"/abs/([^\"'\s>]+?)(?:v(\d+))?[\"']", dt)
    if not m:
        return None
    title = re.sub(r"^\s*Title:\s*", "", _strip(_div(dd, "list-title")))
    authors = tuple(_text(a) for a in re.findall(r"<a [^>]*>([^<]*)</a>", _div(dd, "list-authors")) if a.strip())
    subjects = _div(dd, "list-subjects")
    primary = re.search(r"primary-subject[^>]*>[^<]*\(([^)]+)\)", subjects)
    cats = re.findall(r"\(([a-z][a-z-]*(?:\.[A-Za-z-]+)?)\)", _strip(subjects))
    if primary and primary.group(1) in cats:
        cats.remove(primary.group(1))
        cats.insert(0, primary.group(1))
    ab = re.search(r"<p class=['\"]mathjax['\"]>(.*?)</p>", dd, re.S)
    return Paper(id=m.group(1), title=title, authors=authors, abstract=_strip(ab.group(1)) if ab else "",
                 categories=tuple(dict.fromkeys(cats)), kind=kind, version=int(m.group(2)) if m.group(2) else None,
                 journal_ref=re.sub(r"^\s*Journal-ref:\s*", "", _strip(_div(dd, "list-journal-ref"))),
                 comments=re.sub(r"^\s*Comments:\s*", "", _strip(_div(dd, "list-comments"))))


def merged(lists: Iterable[List[Paper]], categories: Iterable[str] = ()) -> List[Paper]:
    """Several categories' papers as one listing: each paper once, in the order first met, its kind the first of KINDS
    any listing gave it -- and, with `categories` (those asked for), "new" for a paper whose primary category is one of
    them (a catch-up page of one category calls it a cross-list of another of them)."""
    asked = set(categories)
    out: dict = {}
    for papers in lists:
        for p in papers:
            had = out.get(p.id)
            if had is None:
                out[p.id] = p
            elif KINDS.index(p.kind) < KINDS.index(had.kind):
                out[p.id] = replace(p, categories=tuple(dict.fromkeys(p.categories + had.categories)))
    if asked:
        for k, p in out.items():
            if p.kind == "cross" and p.primary in asked:
                out[k] = replace(p, kind="new")
            elif p.kind == "replace-cross" and p.primary in asked:
                out[k] = replace(p, kind="replace")
    return list(out.values())


# ---------------------------------------------------------------- days


def listing_day(now: float) -> str:
    """The day ("YYYY-MM-DD") of the latest listing arXiv's feed carries at `now`: today in New York on a weekday (the
    feed takes it at midnight), else the Friday before."""
    d = datetime.fromtimestamp(now, NEW_YORK).date()
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def announced(day: str) -> float:
    """When the listing of `day` is announced: 20:00 New York time the weekday before (Friday's for a Monday)."""
    d = date.fromisoformat(day) - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return datetime(d.year, d.month, d.day, ANNOUNCED_AT, tzinfo=NEW_YORK).timestamp()


def next_announced(day: str) -> float:
    """When the listing after `day`'s is announced: 20:00 New York time on `day` (the Thursday's, for a Friday: on
    Sunday)."""
    d = date.fromisoformat(day)
    if d.weekday() == 4:
        d += timedelta(days=2)
    return datetime(d.year, d.month, d.day, ANNOUNCED_AT, tzinfo=NEW_YORK).timestamp()


def weekdays(after: str, until: str) -> List[str]:
    """The listing days (weekdays) after `after` and before `until`, both "YYYY-MM-DD"."""
    d, end = date.fromisoformat(after) + timedelta(days=1), date.fromisoformat(until)
    out = []
    while d < end:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def links(pid: str) -> dict:
    return {"abs": ABS.format(id=pid), "pdf": PDF.format(id=pid), "html": HTML_URL.format(id=pid)}
