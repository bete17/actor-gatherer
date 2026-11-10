"""An app's backend messaging its own agents (app_kit's Host.send_agent / start_agent; app_host.py, app_agents.py's
Messenger): only an app whose manifest asks `message_agents`, only to an agent attached to its instance; a new agent
of its own started attached, named, in a folder of the app's, with its first message."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app_kit import AppError  # noqa: E402
from test_dashboard_app_host import NOTES, HostBase, write_app  # noqa: E402


class Messenger:
    """The server's sessions, the test's: what was sent and started."""

    def __init__(self, host):
        self.host, self.sent, self.started = host, [], []

    def send(self, gatherer, channel, text):
        self.sent.append((gatherer, channel, text))

    def start(self, host, instance, text, name, harness, model, cwd):
        self.started.append((instance.id, name, harness, model, cwd))
        host.attach(instance.gatherer, instance.id, "new-ch", by="app")
        self.send(instance.gatherer, "new-ch", text)
        return "new-ch"


class MessageTest(HostBase):
    def setUp(self):
        super().setUp()
        toml = (NOTES.replace('name = "notes"', 'name = "pager"').replace('label = "Notes"', 'label = "Pager"')
                .replace("notes.added", "pager.added").replace('instances = "per-folder"', 'instances = "one"')
                .replace('reads = ["user_message"]', 'reads = ["user_message"]\nmessage_agents = true'))
        write_app(self.apps_dir, "pager", toml)
        self.host = self.new_host()
        self.messenger = self.host.agents = Messenger(self.host)
        self.inst = self.host.open("pager", "g")
        self.app = self.host.backend("pager")

    def test_an_app_messages_its_own_agents_only(self):
        self.app.host.start_agent(self.inst, "Hello, write me a summary.", name="Pager agent")
        (iid, name, harness, model, cwd), = self.messenger.started
        self.assertEqual((iid, name, harness, model), (self.inst.id, "Pager agent", None, None))
        self.assertTrue(cwd.endswith(os.path.join("apps", "pager", "agent")) and os.path.isdir(cwd))
        self.assertEqual(self.host.agents_of(self.inst), ["new-ch"])
        self.app.host.send_agent(self.inst, "new-ch", "Pick today's.")
        self.assertEqual(self.messenger.sent[-1], ("g", "new-ch", "Pick today's."))
        with self.assertRaises(AppError) as got:
            self.app.host.send_agent(self.inst, "someone-else", "hi")         # not attached to it
        self.assertEqual(got.exception.status, 403)
        with self.assertRaises(AppError):
            self.app.host.send_agent(self.inst, "new-ch", "  ")

    def test_an_app_that_doesnt_ask_cant(self):
        notes = self.host.open("notes", "g", self.folder)
        with self.assertRaises(AppError) as got:
            self.host.backend("notes").host.start_agent(notes, "hi")
        self.assertEqual(got.exception.status, 403)
        self.assertIn("message_agents", str(got.exception))
        self.assertEqual(self.messenger.started, [])


if __name__ == "__main__":
    unittest.main()
