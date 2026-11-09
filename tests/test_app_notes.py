"""The Notes app (ag_apps/notes/): each gatherer's notebook -- pages of blocks, kept in a file of the app's data folder
-- changed by ops from its panel and by agents' tools, which read and write it as markdown; each change told to the
open panels in order. The notebook and the markdown are tested directly (notebook.py), the tools and the panel's routes
through the backend with a host of the test's; the panel in the browser (frontend/e2e/notes.spec.ts)."""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app_kit  # noqa: E402
from ag_apps.notes import notebook as nb  # noqa: E402
from ag_apps.notes.backend import NotesApp  # noqa: E402
from app_kit import Caller, Instance  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDER = os.path.join(ROOT, "ag_apps", "notes")


def block(i, type="text", text="", **kw):
    return {"id": i, "type": type, "text": text, **kw}


class ManifestTest(unittest.TestCase):
    def test_it_loads_as_an_app_every_agent_is_offered(self):
        m = app_kit.load(FOLDER)
        self.assertEqual((m.name, m.label, m.instances, m.offer), ("notes", "Notes", "one", "always"))
        self.assertEqual([t.mcp("notes")["name"] for t in m.tools],
                         ["notes_read", "notes_add", "notes_change", "notes_report"])
        self.assertEqual(m.backend.python, "backend:NotesApp")
        self.assertTrue(os.path.isfile(os.path.join(FOLDER, m.mark)))
        self.assertTrue(os.path.isfile(os.path.join(FOLDER, "panel", "index.html")))
        self.assertIn("notes_read", m.instructions)
        self.assertIn("notes_report", m.instructions)
        self.assertIn("write it on the page itself with notes_add", m.instructions)     # a report is not on the page
        self.assertTrue(m.capabilities.actors and m.capabilities.message_actors)

    def test_a_line_it_sent_is_read_back_as_the_users_words_and_its_page(self):
        import re
        m = app_kit.load(FOLDER)
        for text, words, page in (
                ('(From my Notes, page "Report (week)", block abc12345. When you\'re done, report back there with '
                 'notes_report, in one to three lines.)\n\nAdd CSV export\n\nDates in ISO.',
                 "Add CSV export\n\nDates in ISO.", "Report (week)"),
                ('(A reply in my Notes, page "Say \\"hi\\"", block abc12345. Report back there with notes_report when '
                 'you\'re done.)\n\nAlso the date', "Also the date", 'Say \\"hi\\"'),
                ('(From my Notes, page "P", block abc12345.) Two lines, made one', "Two lines, made one", "P")):
            with self.subTest(text=text):
                self.assertIn(m.asked.when, text)                                  # (the list's copy: lines made one)
                self.assertEqual(re.match(m.asked.pattern, text).groups(), (words, page, "abc12345"))


class BookBase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "g.json")
        self.book = nb.Notebook(self.path)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def page(self, pid="pagepage", title="Plans", blocks=(), parent=None):
        self.book.apply([{"op": "page.new", "page": {"id": pid, "title": title, "parent": parent},
                          "blocks": list(blocks)}])
        return self.book.page(pid)


class NotebookTest(BookBase):
    def test_ops_change_it_in_order_each_batch_a_version_kept_in_its_file(self):
        self.page(blocks=[block("aaaaaa01", text="one")])
        v, done = self.book.apply([
            {"op": "block.put", "page": "pagepage", "block": block("aaaaaa02", "todo", "two")},
            {"op": "block.put", "page": "pagepage", "block": block("aaaaaa03", "h2", "zero"), "after": ""},
            {"op": "block.move", "page": "pagepage", "block": "aaaaaa01", "after": "aaaaaa02"},
            {"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa02", "checked": True}},
        ])
        self.assertEqual(v, 2)
        self.assertEqual([b["id"] for b in self.book.page("pagepage")["blocks"]], ["aaaaaa03", "aaaaaa02", "aaaaaa01"])
        self.assertEqual(done[2], {"op": "block.move", "page": "pagepage", "block": "aaaaaa01", "after": "aaaaaa02"})
        self.assertEqual(done[3]["block"], {"id": "aaaaaa02", "type": "todo", "text": "two", "checked": True,
                                            "indent": 0})
        again = nb.Notebook(self.path)                       # read back from its file
        self.assertEqual(again.state(), self.book.state())
        self.assertEqual(again.version, 2)

    def test_an_op_on_a_page_or_block_not_there_is_skipped_and_one_that_is_not_an_op_undoes_its_batch(self):
        self.page(blocks=[block("aaaaaa01", text="one")])
        v, done = self.book.apply([{"op": "block.delete", "page": "pagepage", "block": "zzzzzz99"},
                                   {"op": "block.put", "page": "gonegone", "block": block("aaaaaa02")}])
        self.assertEqual((v, done), (1, []))                 # nothing changed: no new version
        with self.assertRaises(nb.NotebookError):
            self.book.apply([{"op": "block.put", "page": "pagepage", "block": block("aaaaaa02", text="kept?")},
                             {"op": "block.put", "page": "pagepage", "block": block("aaaaaa03", "table")}])
        self.assertEqual([b["id"] for b in self.book.page("pagepage")["blocks"]], ["aaaaaa01"])
        for bad in ({"op": "page.new", "page": {"id": "Not An Id"}}, {"op": "page.fly", "page": "pagepage"},
                    {"op": "block.put", "page": "pagepage", "block": {"id": "x"}}, "nope"):
            with self.subTest(bad=bad), self.assertRaises(nb.NotebookError):
                self.book.apply([bad])

    def test_a_page_goes_into_the_trash_with_its_subpages_and_comes_back_with_them(self):
        self.page("toptop01", "Top")
        self.page("kidkid01", "Kid", parent="toptop01")
        self.page("kidkid02", "Gone before", parent="toptop01")
        self.book.apply([{"op": "page.delete", "page": "kidkid02"}])
        _, done = self.book.apply([{"op": "page.delete", "page": "toptop01"}])
        self.assertEqual(done[0]["pages"], ["toptop01", "kidkid01"])
        self.assertIsNone(self.book.page("Kid"))
        self.assertIn("In the trash", self.book.outline())
        _, done = self.book.apply([{"op": "page.restore", "page": "toptop01"}])
        self.assertEqual(done[0]["pages"], ["toptop01", "kidkid01"])
        self.assertIsNotNone(self.book.page("Kid"))
        self.assertIsNone(self.book.page("Gone before"))    # it went in on its own: it stays there
        with self.assertRaises(nb.NotebookError):            # only what is in the trash goes for good
            self.book.apply([{"op": "page.purge", "page": "toptop01"}])
        _, done = self.book.apply([{"op": "page.restore", "page": "kidkid02"}])
        self.assertEqual(self.book._get("kidkid02")["parent"], "toptop01")
        self.book.apply([{"op": "page.delete", "page": "toptop01"}, {"op": "page.purge", "page": "toptop01"}])
        self.assertEqual(self.book.state()["pages"], [])

    def test_a_page_never_goes_under_itself(self):
        self.page("toptop01", "Top")
        self.page("kidkid01", "Kid", parent="toptop01")
        with self.assertRaises(nb.NotebookError):
            self.book.apply([{"op": "page.set", "page": "toptop01", "parent": "kidkid01"}])
        self.book.apply([{"op": "page.set", "page": "kidkid01", "parent": None, "title": "  Free \n kid ",
                          "icon": "🐣"}])
        p = self.book.page("kidkid01")
        self.assertEqual((p["parent"], p["title"], p["icon"]), (None, "Free kid", "🐣"))

    def test_a_block_is_kept_clean(self):
        self.page(blocks=[block("aaaaaa01", "quote", '<b>a</b><img src=x onerror="go()"><script>bad()</script>'
                                '<a href="javascript:go()">j</a><a href="https://ok.org" onclick="x">ok</a>',
                                indent=9),
                          block("aaaaaa02", "h1", "x", indent=3, checked=True),
                          block("aaaaaa03", "code", "a <b> & c")])
        a, h, c = self.book.page("pagepage")["blocks"]
        self.assertEqual(a["text"], '<b>a</b>j<a href="https://ok.org">ok</a>')
        self.assertEqual(a["indent"], nb.MAX_INDENT)
        self.assertEqual((h["indent"], h["checked"]), (0, False))     # a heading is never set in, nor ticked
        self.assertEqual(c["text"], "a <b> & c")                       # code is kept as it is typed

    def test_a_page_is_found_by_its_id_its_title_or_the_start_of_one(self):
        self.page("aaaaaa01", "Groceries")
        self.page("aaaaaa02", "Reading list")
        self.assertEqual(self.book.page("aaaaaa02")["title"], "Reading list")
        self.assertEqual(self.book.page("groceries")["id"], "aaaaaa01")
        self.assertEqual(self.book.page("read")["id"], "aaaaaa02")
        self.assertIsNone(self.book.page("nothing"))

    def test_an_unreadable_file_is_kept_aside_not_written_over(self):
        with open(self.path, "w") as fh:
            fh.write("{not json")
        book = nb.Notebook(self.path)
        self.assertEqual(book.state(), {"version": 0, "pages": []})
        self.assertTrue([f for f in os.listdir(self.dir) if f.startswith("g.json.unreadable-")])


class SentTest(BookBase):
    """A block sent to an agent says who it went to and when; its thread holds the user's replies and the agent's
    reports."""

    def test_a_block_says_who_it_went_to_and_keeps_it_as_it_is_typed_in_and_retyped(self):
        self.page(blocks=[block("aaaaaa01", "todo", "ship it")])
        self.book.apply([{"op": "block.put", "page": "pagepage",
                          "block": {"id": "aaaaaa01", "to": "1f2e3d4c-aaaa-bbbb", "sent": 1700000000}}])
        b = self.book.page("pagepage")["blocks"][0]
        self.assertEqual((b["to"], b["sent"]), ("1f2e3d4c-aaaa-bbbb", 1700000000.0))
        self.assertNotIn("extra", b)
        self.book.apply([{"op": "block.put", "page": "pagepage",
                          "block": {"id": "aaaaaa01", "extra": "in <b>ISO</b><script>"}}])
        self.assertEqual(self.book.page("pagepage")["blocks"][0]["extra"], "in <b>ISO</b>")
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "text": "ship it now"}},
                         {"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "type": "bullet"}}])
        b = self.book.page("pagepage")["blocks"][0]
        self.assertEqual((b["type"], b["text"], b["to"]), ("bullet", "ship it now", "1f2e3d4c-aaaa-bbbb"))
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "to": ""}}])
        b = self.book.page("pagepage")["blocks"][0]
        self.assertFalse({"to", "sent", "extra"} & set(b))          # who it went to, and with what: forgotten
        for bad in ({"to": "no spaces here"}, {"to": 7}, {"to": "abc123", "sent": "now"}):
            with self.subTest(bad=bad), self.assertRaises(nb.NotebookError):
                self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", **bad}}])

    def test_its_thread_takes_lines_in_order_each_once_and_goes_with_it(self):
        self.page(blocks=[block("aaaaaa01", "todo", "ship it", to="chan-1"), block("aaaaaa02", text="other")])
        line = {"id": "line0001", "by": "user", "text": "also <b>this</b><script>x</script>"}
        v, done = self.book.apply([{"op": "thread.add", "page": "pagepage", "block": "aaaaaa01", "line": line},
                                   {"op": "thread.add", "page": "pagepage", "block": "aaaaaa01", "line": line},
                                   {"op": "thread.add", "page": "pagepage", "block": "aaaaaa01",
                                    "line": {"id": "line0002", "by": "agent:chan-1", "text": "done", "done": True}},
                                   {"op": "thread.add", "page": "pagepage", "block": "zzzzzz99", "line": line}])
        self.assertEqual(len(done), 2)                                            # sent again, or no block: skipped
        thread = self.book.page("pagepage")["blocks"][0]["thread"]
        self.assertEqual([(x["id"], x["by"], x["text"]) for x in thread],
                         [("line0001", "user", "also <b>this</b>"), ("line0002", "agent:chan-1", "done")])
        self.assertTrue(thread[1]["done"] and all(isinstance(x["at"], float) for x in thread))
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "text": "ship"}},
                         {"op": "block.move", "page": "pagepage", "block": "aaaaaa01", "after": "aaaaaa02"}])
        self.assertEqual(len(self.book.page("pagepage")["blocks"][1]["thread"]), 2)
        for bad in ({"id": "line0003", "by": "someone", "text": "x"}, {"id": "line0003", "by": "user", "text": " "},
                    {"id": "x", "by": "user", "text": "x"}):
            with self.subTest(bad=bad), self.assertRaises(nb.NotebookError):
                self.book.apply([{"op": "thread.add", "page": "pagepage", "block": "aaaaaa01", "line": bad}])
        self.book.apply([{"op": "block.delete", "page": "pagepage", "block": "aaaaaa01"}])
        self.assertIsNone(self.book.block("aaaaaa01"))

    def test_an_agent_reads_who_a_block_went_to_and_its_thread_apart_from_the_blocks(self):
        page = self.page(blocks=[block("aaaaaa01", "todo", "ship it", to="chan-1", extra="today",
                                       thread=[{"id": "line0001", "by": "user", "text": "and <b>fast</b>"},
                                               {"id": "line0002", "by": "agent:chan-1", "text": "on it"}]),
                                 block("aaaaaa02", "agents")])
        md = self.book.markdown(page, "chan-1")
        self.assertIn("[aaaaaa01] - [ ] ship it\n[aaaaaa02] (a table of the gatherer's actors", md)
        self.assertIn("- [aaaaaa01] sent to actor chan-1 (you), with: today\n    the user: and **fast**\n"
                      "    actor chan-1 (you): on it", md)
        self.assertNotIn("(you)", self.book.markdown(page, "chan-2"))
        self.assertNotIn("to", self.book.page("pagepage")["blocks"][1])         # an agents block goes to no one
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa02", "to": "chan-1"}}])
        self.assertNotIn("to", self.book.page("pagepage")["blocks"][1])


class MarkdownTest(unittest.TestCase):
    MD = ("# Trip\n- [ ] pack **boots**\n  - [x] socks\n* tent\n1. one\n2. two\n   1. inner\n3. three\n"
          "> leave *early*, see [map](https://maps.example)\n---\n```\nx = a < b\n```\nplain `co<de>` text\n")

    def test_lines_become_blocks_and_back(self):
        blocks = nb.blocks_from_markdown(self.MD)
        self.assertEqual([(b["type"], b["indent"]) for b in blocks],
                         [("h1", 0), ("todo", 0), ("todo", 1), ("bullet", 0), ("number", 0), ("number", 0),
                          ("number", 1), ("number", 0), ("quote", 0), ("divider", 0), ("code", 0), ("text", 0)])
        self.assertEqual(blocks[1]["text"], "pack <b>boots</b>")
        self.assertTrue(blocks[2]["checked"])
        self.assertEqual(blocks[8]["text"], 'leave <i>early</i>, see <a href="https://maps.example">map</a>')
        self.assertEqual(blocks[10]["text"], "x = a < b")
        self.assertEqual(blocks[11]["text"], "plain <code>co&lt;de&gt;</code> text")
        lines = nb.markdown_lines([{**b, "id": f"bbbbbb{n:02}"} for n, b in enumerate(blocks)], ids=False)
        self.assertEqual("\n".join(lines) + "\n", self.MD.replace("* tent", "- tent").replace("   1.", "  1."))

    def test_ids_read_from_notes_read_are_left_out_when_given_back(self):
        got = nb.blocks_from_markdown("[abc12345] - [ ] milk\n[abc12346]   - [x] eggs\n[abc12347] ```\nx\n```")
        self.assertEqual([(b["type"], b["text"], b["indent"]) for b in got],
                         [("todo", "milk", 0), ("todo", "eggs", 1), ("code", "x", 0)])
        self.assertEqual(nb.blocks_from_markdown("[x] done")[0]["type"], "todo")      # "[x]" is a to-do, not an id

    def test_inline_marks(self):
        for md, html in (("a **b** _c_ *d* ~~e~~", "a <b>b</b> <i>c</i> <i>d</i> <s>e</s>"),
                         ("2 * 3 * 4", "2 * 3 * 4"), ("snake_case_name", "snake_case_name"),
                         ("[x](javascript:go())", "[x](javascript:go())"), ("<b>raw</b>", "&lt;b&gt;raw&lt;/b&gt;"),
                         ("line<br>next", "line<br>next")):
            with self.subTest(md=md):
                self.assertEqual(nb.inline_html(md), html)
        self.assertEqual(nb.inline_markdown('<b>b</b> <a href="https://x.org">x</a> <code>c</code>'),
                         "**b** [x](https://x.org) `c`")


class Host(app_kit.Host):
    """The host a test gives the backend: its data folder, and what it told the panels."""

    def __init__(self, folder):
        self.data, self.told = folder, []

    def insert(self, instance, events, channel=None):
        raise AssertionError("Notes inserts no events")

    def read(self, instance, types, after=0, channel=None, limit=500):
        return []

    def attached(self, instance):
        return []

    def tell_panel(self, instance, message):
        self.told.append(message)

    def folder(self):
        return self.data


class BackendTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.app = NotesApp()
        self.host = Host(self.dir)
        self.app.start(self.host)
        self.inst = self.app.open(Instance(id="0123456789abcdef", app="notes", gatherer="my gatherer/1"), {})
        self.agent = Caller(channel="chan-1", gatherer="my gatherer/1")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def call(self, tool, **args):
        got = self.app.call(self.inst, tool, args, self.agent)
        return got.is_error, got.content[0]["text"]

    def ask(self, method, path, body=None):
        r = self.app.request(self.inst, method, path, {}, json.dumps(body).encode() if body is not None else b"")
        return r.status, json.loads(r.body)

    def test_an_agent_makes_a_page_adds_to_it_and_ticks_a_to_do(self):
        self.assertEqual(self.inst.title, "my gatherer/1")
        err, text = self.call("read")
        self.assertFalse(err)
        self.assertIn("no pages yet", text)
        err, text = self.call("add", title="Groceries", icon="🛒", markdown="- [ ] milk\n- [ ] eggs")
        self.assertFalse(err)
        self.assertTrue(text.startswith("# 🛒 Groceries   (page "))
        self.assertRegex(text, r"\n\[[a-z0-9]{8}\] - \[ \] milk\n\[[a-z0-9]{8}\] - \[ \] eggs")
        milk = text.split("] - [ ] milk")[0].rsplit("[", 1)[1]
        err, text = self.call("add", page="groceries", markdown="- [ ] bread", after=milk)
        self.assertIn("milk\n[", text)
        self.assertLess(text.index("bread"), text.index("eggs"))
        err, text = self.call("change", page="Groceries", block=milk, checked=True)
        self.assertIn("- [x] milk", text)
        err, text = self.call("change", page="Groceries", block=milk, markdown="- [x] oat milk\n- [ ] butter")
        self.assertIn("- [x] oat milk\n[", text)
        self.assertIn("- [ ] butter", text)
        err, text = self.call("read")
        self.assertIn("Groceries (3 of 4 to-dos open)", text)
        # every change told to the panels, in order, with the agent who made it
        self.assertEqual([m["version"] for m in self.host.told], [1, 2, 3, 4])
        self.assertEqual({m["by"] for m in self.host.told}, {"agent:chan-1"})
        self.assertEqual({m["agent"] for m in self.host.told}, {"chan-1"})
        # kept in the app's data folder, the gatherer's name made a file's
        self.assertEqual(os.listdir(self.dir), ["my%20gatherer%2F1.json"])

    def test_an_agent_is_told_what_it_got_wrong(self):
        for tool, args, says in (("read", {"page": "Nope"}, "no page 'Nope'"),
                                 ("add", {"markdown": "x"}, "which page"),
                                 ("add", {"page": "Nope", "markdown": "x"}, "no page"),
                                 ("change", {"page": "Nope", "block": "aaaaaaaa"}, "no page")):
            with self.subTest(tool=tool, args=args):
                err, text = self.call(tool, **args)
                self.assertTrue(err)
                self.assertIn(says, text)
        self.call("add", title="List", markdown="text")
        err, text = self.call("change", page="List", block="zzzzzzzz", checked=True)
        self.assertTrue(err)
        self.assertIn("no block 'zzzzzzzz'", text)
        bid = self.call("read", page="List")[1].split("\n")[2][1:9]
        err, text = self.call("change", page="List", block=bid, checked=True)
        self.assertIn("not a to-do", text)
        err, text = self.call("add", page="List", markdown="more", after="zzzzzzzz")
        self.assertIn("no block 'zzzzzzzz'", text)

    def test_an_agent_renames_moves_and_bins_a_page(self):
        self.call("add", title="Top", markdown="")
        self.call("add", title="Kid", markdown="- a", parent="Top")
        err, text = self.call("change", page="Kid", title="Child", icon="🐣")
        self.assertTrue(text.startswith("# 🐣 Child   (page "))
        self.assertIn(", under Top (", text)
        err, text = self.call("change", page="Child", parent="top")
        self.assertNotIn("under", text.split("\n")[0])
        err, text = self.call("change", page="Top", delete=True)
        self.assertIn("is in the trash", text)
        self.assertIn("In the trash (the user can restore them): Top", self.call("read")[1])
        err, text = self.call("change", page="Child")             # nothing to change
        self.assertTrue(err)
        self.assertIn("a `block` to change", text)

    def sent_block(self, text="ship it", type="todo"):
        self.ask("POST", "ops", {"by": "p-one", "ops": [
            {"op": "page.new", "page": {"id": "pagepage", "title": "Plans"},
             "blocks": [block("aaaaaa01", type, text, to="chan-1", sent=1700000000)]}]})

    def test_an_agent_reports_back_on_a_block_it_was_sent_and_ticks_it(self):
        self.sent_block()
        err, text = self.call("report", block="aaaaaa01", text="Did it: **branch** `ship-it`.\nTests pass.")
        self.assertFalse(err)
        self.assertEqual(text, "Reported under the block on “Plans”: the user sees it there.")
        err, text = self.call("report", block="aaaaaa01", text="All done.", done=True)
        self.assertIn("and ticked it", text)
        b = self.app.book(self.inst.gatherer).block("aaaaaa01")[1]
        self.assertTrue(b["checked"])
        self.assertEqual([(x["by"], x["text"], x.get("done", False)) for x in b["thread"]],
                         [("agent:chan-1", "Did it: <b>branch</b> <code>ship-it</code>.<br>Tests pass.", False),
                          ("agent:chan-1", "All done.", True)])
        told = self.host.told[-1]
        self.assertEqual((told["by"], told["agent"], [o["op"] for o in told["ops"]]),
                         ("agent:chan-1", "chan-1", ["thread.add", "block.put"]))
        err, text = self.call("report", block="aaaaaa01", text="Again.", done=True)
        self.assertNotIn("ticked", text)                                          # ticked already
        self.assertIn("    actor chan-1 (you): All done.", self.call("read", page="Plans")[1])

    def test_an_agent_is_told_what_is_wrong_with_its_report(self):
        self.sent_block()
        for args, says in (({"block": "zzzzzz99", "text": "x"}, "no block 'zzzzzz99'"),
                           ({"block": "aaaaaa01", "text": "  "}, "one to three lines"),
                           ({"block": "aaaaaa01", "text": "x" * 2000}, "too long for a report")):
            with self.subTest(args=args):
                err, text = self.call("report", **args)
                self.assertTrue(err)
                self.assertIn(says, text)
        self.assertNotIn("thread", self.app.book(self.inst.gatherer).block("aaaaaa01")[1])

    def test_a_line_a_panel_adds_is_the_users(self):
        self.sent_block()
        status, got = self.ask("POST", "ops", {"by": "p-one", "ops": [{"op": "thread.add", "page": "pagepage",
                                                                         "block": "aaaaaa01", "line": {
                                                                             "id": "line0001", "by": "agent:chan-1",
                                                                             "text": "I did it", "at": 5}}]})
        self.assertEqual(status, 200)
        line = self.app.book(self.inst.gatherer).block("aaaaaa01")[1]["thread"][0]
        self.assertEqual(line["by"], "user")
        self.assertGreater(line["at"], 1_700_000_000)                              # written now, not when it says

    def test_the_panel_reads_the_notebook_and_changes_it(self):
        status, got = self.ask("GET", "state")
        self.assertEqual((status, got), (200, {"version": 0, "pages": []}))
        status, got = self.ask("POST", "ops", {"by": "p-one", "ops": [
            {"op": "page.new", "page": {"id": "pagepage", "title": "Mine"}, "blocks": [block("aaaaaa01", text="hi")]}]})
        self.assertEqual((status, got), (200, {"version": 1}))
        self.assertEqual(self.host.told[-1]["by"], "p-one")
        self.assertNotIn("agent", self.host.told[-1])
        status, got = self.ask("POST", "ops", {"by": "p-one", "ops": [{"op": "block.put", "page": "pagepage",
                                                                         "block": block("aaaaaa02", "nope")}]})
        self.assertEqual(status, 400)
        self.assertIn("not a block's type", got["error"])
        status, got = self.ask("POST", "parse", {"markdown": "- [ ] a\n\n# b"})
        self.assertEqual([(b["type"], b["text"]) for b in got["blocks"]], [("todo", "a"), ("h1", "b")])
        self.assertTrue(all(nb.ID.match(b["id"]) for b in got["blocks"]))
        self.assertEqual(self.ask("GET", "state")[1]["version"], 1)   # parsing changed nothing
        self.assertEqual(self.ask("POST", "ops", ["not", "an", "object"])[0], 400)
        self.assertEqual(self.app.request(self.inst, "GET", "nothing", {}, b"").status, 404)


if __name__ == "__main__":
    unittest.main()
