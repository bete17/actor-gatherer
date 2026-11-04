"""Claude Code's adaptor: its Anthropic Messages API messages as the context
manager's events (to_events.py), and the context back as messages (to_messages.py)."""

from ag.integrations.tools.ag_orchestrator.adaptor import CHANNEL, AG, CWD, HarnessAdaptor

import copy
from typing import Optional

from .to_events import CONTEXT, EVENT_TYPES, HARNESS, OUTPUTS, Continuity, to_events
from .to_messages import offered_tools, to_messages


class ClaudeAdaptor(HarnessAdaptor):
    """`system_messages`: how the context goes back -- "keep" (system messages as Claude Code sends
    them) or "user" (as user-turn system reminders, for a gateway that moves system messages into the
    model's system instruction). The hook sets it per request (see to_messages.finish)."""
    name = "claude"
    harness = HARNESS
    outputs = OUTPUTS
    event_types = EVENT_TYPES
    other = CONTEXT
    accepts = OUTPUTS + (AG,)
    properties = (CHANNEL, CWD)
    system_messages = "keep"
    continuity = None       # where the request carries on (to_events.py), for an adaptor `for_channel` made
    offered = None          # the names of the tools the request offers (to_messages.offered_tools); None: unchecked

    def for_channel(self, continuity: Continuity, tools: Optional[list] = None) -> "ClaudeAdaptor":
        """This adaptor, for one request of a channel: its events' ids carry on from the channel's stored ones, and
        the context's tool search references name only tools the request's `tools` offers."""
        a = copy.copy(self)
        a.continuity = continuity
        a.offered = offered_tools(tools)
        return a

    def to_events(self, messages: list):
        return to_events(messages, self.continuity, self.event_types)

    def to_messages(self, context: list, messages: list):
        return to_messages(context, messages, self.system_messages, self.offered)
