"""TASK LINKS: attachment follows a task's membership (tasks.py). Within a task every agent is attached to every app --
given its tools, told what the reader does in it (app_host.py's `attach`) -- so an item joining a task attaches it to
the task's others, and one leaving it detaches it from them. Each change of the tasks goes through here (`change`),
which attaches and detaches what the change asks, and has the page told (RING).

What else puts an app and an agent together, here too:

    link(g, instance, channel, move)   an agent to be attached to an app's instance (app_host.py's `attach`, after:
                                       the app, in no task, put in the agent's -- a task of the two, the agent in none
                                       -- else the agent, in none, put in the app's; both in tasks already, the agent
                                       moved to the app's only when `move` (the reader's own attaching, from the app's
                                       panel), else just attached (an agent using an app another task holds) -- its
                                       task changed first, so whoever hears of the attaching finds it there
    unlink(g, instance, channel)       an agent detached from an app by the reader: in its task, taken out of it (and so
                                       detached from every app of it), else only detached
    closed(g, instance)                an app's instance closed: out of its task
    on_load(g)                         the host's records of a gatherer read (app_host.py's `loaded_then`): a gatherer
                                       agent's attachments dropped (kept before it was attached to none); and once, the
                                       items sharing an app made one task (tasks.py's `group`), what was kept before
                                       apps were items

A gatherer's own agent (sessions.py's COORDINATOR) is in no task, and attached to no app (`attachable`, the host's
check): it reaches every app without (tool_gateway.py)."""

from typing import Callable, Dict, List, Optional, Tuple

from . import sessions, tasks, tool_gateway
from app_kit import AppError

RING: Optional[Callable] = None         # the server's hub.ring: the page told the tasks changed (server.py)
SESSIONS = None                         # the server's sessions.Sessions: who is a gatherer agent (server.py)


def _host():
    return tool_gateway.HOST


def _ring(gatherer: str) -> None:
    if RING is not None:
        RING(None, what="list")


def coordinator(channel: str) -> bool:
    """Whether `channel` is a gatherer's own agent's (none known here: no)."""
    if SESSIONS is None:
        return False
    return any(r.get("role") == sessions.COORDINATOR for r in SESSIONS.list()
               if channel in (r.get("session_id"), r.get("started_as")))


def attachable(gatherer: str, channel: str) -> bool:
    """Whether the agent `channel` may be attached to an app (app_host.py's `attachable`): any but a gatherer's own."""
    return not coordinator(channel)


def sync(gatherer: str, before: Dict[str, int], after: Dict[str, int]) -> Dict[str, List[str]]:
    """The attachments made to follow the change from `before` to `after` ({item: task id}): each agent and app now in
    one task attached, each that were in one and are no longer detached -> {channel: [instance ids attached]}. Those
    whose task did not change are left as they are. No apps hosted: nothing."""
    host = _host()
    if host is None:
        return {}
    changed = {x for x in set(before) | set(after) if before.get(x) != after.get(x)}
    near = set(changed)
    for x in changed:
        for m in (before, after):
            if m.get(x) is not None:
                near.update(y for y, t in m.items() if t == m[x])
    attached: Dict[str, List[str]] = {}
    for c in sorted(y for y in near if tasks.app_of(y) is None):
        for a in sorted(y for y in near if tasks.app_of(y) is not None):
            if c not in changed and a not in changed:
                continue
            now = after.get(c) is not None and after.get(c) == after.get(a)
            was = before.get(c) is not None and before.get(c) == before.get(a)
            iid = tasks.app_of(a)
            try:
                if now and not was:
                    host.attach(gatherer, iid, c, by="task")
                    attached.setdefault(c, []).append(iid)
                elif was and not now:
                    host.detach(gatherer, iid, c, by="task")
            except AppError:                                    # its instance closed meanwhile: nothing to attach
                continue
    return attached


def change(gatherer: str, do: Callable[[], object]) -> Tuple[object, Dict[str, List[str]]]:
    """`do()`, a change of the gatherer's tasks (tasks.py), the attachments made to follow it (`sync`), the page told ->
    (what `do` returned, the attachments made)."""
    before = dict(tasks.of(gatherer)["tasked"])
    got = do()
    attached = sync(gatherer, before, dict(tasks.of(gatherer)["tasked"]))
    _ring(gatherer)
    return got, attached


def link(gatherer: str, instance: str, channel: str, move: bool = False) -> None:
    """An agent attached to an app's instance (module doc)."""
    if not channel or coordinator(channel):
        return
    item = tasks.app_item(instance)
    has = tasks.of(gatherer)["tasked"]
    mine, its = has.get(channel), has.get(item)
    if its is not None and mine == its:
        return
    if its is None:
        change(gatherer, lambda: tasks.add(gatherer, channel, [item]))
    elif mine is None or move:
        change(gatherer, lambda: tasks.add(gatherer, item, [channel]))


def unlink(gatherer: str, instance: str, channel: str) -> None:
    """An agent detached from an app by the reader (module doc)."""
    has = tasks.of(gatherer)["tasked"]
    tid = has.get(channel)
    if tid is not None and has.get(tasks.app_item(instance)) == tid:
        change(gatherer, lambda: tasks.take_out(gatherer, [channel]))
        return
    host = _host()
    if host is not None:
        host.detach(gatherer, instance, channel)


def closed(gatherer: str, instance: str) -> None:
    """An app's instance closed: out of its task (its agents detached already, by the host)."""
    item = tasks.app_item(instance)
    if tasks.task_of(gatherer, item) is not None:
        tasks.take_out(gatherer, [item])
        _ring(gatherer)


def on_load(gatherer: str) -> None:
    """A gatherer's records read: its own agent's attachments dropped; once, the items sharing an app made one task
    (module doc)."""
    host = _host()
    if host is None:
        return
    with host.lock:
        lead = [(i, c) for i, inst in host.instances.items() if inst.gatherer == gatherer
                for c in sorted(host.attached.get(i, ())) if coordinator(c)]
    for i, c in lead:
        try:
            host.detach(gatherer, i, c, by="dashboard")
        except AppError:
            continue
    if tasks.grouped(gatherer):
        return
    with host.lock:
        held = [(i, sorted(host.attached.get(i, ()))) for i, inst in host.instances.items() if inst.gatherer == gatherer]
    links = [[tasks.app_item(i), *(c for c in cs if not coordinator(c))] for i, cs in held]
    change(gatherer, lambda: tasks.group(gatherer, links))
