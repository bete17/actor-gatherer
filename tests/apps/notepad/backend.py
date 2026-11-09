"""The test app's backend (app.toml): `add` keeps a note as an event and tells the open panels; an agent attached is
told what the notepad holds; its panel's `remind` notifies the user a few seconds later (the panel closed meanwhile,
or the page left: what a notification is for)."""
import threading

from app_kit import App, AppError, Instance, Response, ToolResult, context_stream


class NotesApp(App):
    def open(self, instance: Instance, args: dict) -> Instance:
        name = (instance.folder or "").rstrip("/").rsplit("/", 1)[-1]
        return Instance(**{**instance.to_dict(), "title": name or "Notepad"})

    def call(self, instance, tool, args, caller):
        text = str(args.get("text") or "").strip()
        if tool != "add" or not text:
            return ToolResult.error("notepad_add takes the note's `text`")
        self.host.insert(instance, [{"type": "notepad.added", "payload": {"text": text},
                                     "properties": {"by": caller.channel or "user"}}])
        self.host.tell_panel(instance, {"said": f"kept: {text}"})
        return ToolResult.text(f"kept: {text}")

    def attached(self, instance, channel):
        notes = [e["payload"]["text"] for e in self.host.read(instance, ["notepad.added"])]
        said = "The notepad is empty." if not notes else "The notepad holds: " + "; ".join(notes)
        self.host.insert(instance, [context_stream("Notepad", "the notepad", said)], channel=channel)

    def request(self, instance, method, path, query, body):
        if path == "count" and instance is not None:
            return Response.json({"notes": len(self.host.read(instance, ["notepad.added"]))})
        if path == "remind" and method == "POST" and instance is not None:
            after = min(max(float(query.get("after") or 5), 0.0), 60.0)
            text = str(query.get("text") or "").strip()

            def ring():
                try:
                    self.host.notify(instance, "A reminder from your notepad", text or "You asked to be reminded.",
                                     show=["ag", "system"], where={"note": text})
                except AppError:                              # its instance closed meanwhile
                    pass
            threading.Timer(after, ring).start()
            return Response.json({"in": after})
        return Response(404, b"not found")
