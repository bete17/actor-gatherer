"""Slack's message text ("mrkdwn") as an agent reads it: <@U123> as @name, <#C123|general> as #general,
<https://x|label> as "label (https://x)", Slack's three escapes undone. The panel draws mrkdwn itself (panel.js)."""

import re
from typing import Callable, Optional

_ANGLE = re.compile(r"<([^<>]+)>")


def plain(text: str, user: Callable[[str], Optional[str]] = lambda _: None,
          channel: Callable[[str], Optional[str]] = lambda _: None) -> str:
    def one(m: "re.Match") -> str:
        body = m.group(1)
        ref, _, label = body.partition("|")
        if ref.startswith("@"):
            name = label or user(ref[1:]) or ref[1:]
            return f"@{name}"
        if ref.startswith("#"):
            name = label or channel(ref[1:]) or ref[1:]
            return f"#{name}"
        if ref.startswith("!subteam^"):
            return f"@{label or 'group'}"
        if ref.startswith("!"):
            word = ref[1:].split("^")[0]
            return f"@{label or word}"
        if label and label != ref:
            return f"{label} ({ref.removeprefix('mailto:')})"
        return ref.removeprefix("mailto:")
    out = _ANGLE.sub(one, text or "")
    return out.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
