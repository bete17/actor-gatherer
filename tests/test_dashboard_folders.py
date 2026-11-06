"""folders.py: the folders a gatherer's actors are kept in -- made, named, moved, deleted, found by path -- and the
folders of saved actors from before it, copied in once."""

import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import folders, saved, sessions  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402


class FoldersTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.was = dashboard_home.HOME
        dashboard_home.HOME = os.path.join(self.tmp.name, "ag")

    def tearDown(self):
        dashboard_home.HOME = self.was
        self.tmp.cleanup()

    def names(self, gatherer="g"):
        """{path: [the channels in it]} of the gatherer, every folder's."""
        tree = folders.of(gatherer)
        out = {folders.path(tree, f["id"]): [] for f in tree["folders"]}
        for c, fid in sorted(tree["filed"].items()):
            out[folders.path(tree, fid)].append(c)
        return out

    def test_nothing_kept_is_nothing(self):
        self.assertEqual((folders.stored(), folders.of("g")), ({}, {"folders": [], "filed": {}}))

    def test_folders_in_folders_found_by_path_whatever_its_case(self):
        harnesses = folders.make("g", " Harnesses ")
        codex = folders.make("g", "Codex", harnesses)
        self.assertEqual(folders.find("g", "harnesses/CODEX"), codex)
        self.assertEqual(folders.find("g", "/Harnesses/Codex/"), codex)
        for top in ("", "/", "top", "TOP"):
            self.assertIsNone(folders.find("g", top))
        with self.assertRaisesRegex(folders.FolderError, 'no folder "Harnesses/Gemini" in g'):
            folders.find("g", "Harnesses/Gemini")
        gemini = folders.find_or_make("g", "harnesses/Gemini/Live")          # the folders not there made
        self.assertEqual(folders.path(folders.of("g"), gemini), "Harnesses/Gemini/Live")
        self.assertEqual(folders.find_or_make("g", "Harnesses/Codex"), codex)   # there already: itself
        self.assertEqual(folders.of("h"), {"folders": [], "filed": {}})        # another gatherer's: none of them
        self.assertEqual(folders.make("h", "Codex"), folders.find("h", "Codex"))

    def test_names_are_one_of_their_kind_beside_one_another(self):
        a = folders.make("g", "Paper")
        folders.make("g", "Notes", a)
        with self.assertRaisesRegex(folders.FolderError, 'there is a folder "Paper" there already'):
            folders.make("g", "PAPER")
        folders.make("g", "Notes")                                            # the same name elsewhere: fine
        with self.assertRaisesRegex(folders.FolderError, "which folder"):
            folders.make("g", "  ")
        with self.assertRaisesRegex(folders.FolderError, "can't hold"):
            folders.make("g", "a/b")
        with self.assertRaisesRegex(folders.FolderError, "which gatherer"):
            folders.make("", "x")
        folders.rename("g", a, "paper")                                       # its own case: fine
        with self.assertRaisesRegex(folders.FolderError, 'there is a folder "Notes" there already'):
            folders.rename("g", a, "notes")
        self.assertEqual(sorted(self.names()), ["Notes", "paper", "paper/Notes"])

    def test_actors_filed_moved_and_out_again(self):
        a, b = folders.make("g", "A"), folders.make("g", "B")
        folders.file("g", ["c1", "c2", "c1", " "], a)
        self.assertEqual(self.names(), {"A": ["c1", "c2"], "B": []})
        folders.file("g", ["c2"], b)
        folders.file("g", ["c1"], None)                                       # at the top: no folder
        self.assertEqual(self.names(), {"A": [], "B": ["c2"]})
        with self.assertRaisesRegex(folders.FolderError, "which actors"):
            folders.file("g", [""], a)
        with self.assertRaisesRegex(folders.FolderError, f"no folder {a} in h"):
            folders.file("h", ["x"], a)                                       # another gatherer's folder

    def test_a_folder_moves_with_all_in_it_but_never_into_itself(self):
        a = folders.make("g", "A")
        b = folders.make("g", "B", a)
        c = folders.make("g", "C")
        folders.file("g", ["x"], b)
        folders.move("g", a, c)
        self.assertEqual(self.names(), {"C": [], "C/A": [], "C/A/B": ["x"]})
        for into in (a, b):
            with self.assertRaisesRegex(folders.FolderError, "can't go in itself"):
                folders.move("g", a, into)
        folders.make("g", "A")
        with self.assertRaisesRegex(folders.FolderError, 'there is a folder "A" there already'):
            folders.move("g", a, None)

    def test_a_deleted_folders_actors_and_folders_move_up_a_level(self):
        a = folders.make("g", "A")
        b = folders.make("g", "B", a)
        folders.make("g", "B")                                                # B at the top too: the moved one renamed
        folders.file("g", ["in-a"], a)
        folders.file("g", ["in-b"], b)
        folders.delete("g", a)
        self.assertEqual(self.names(), {"B": [], "B 2": ["in-b"]})
        self.assertNotIn("in-a", folders.of("g")["filed"])                     # at the top now
        top = folders.make("g", "T")
        inner = folders.make("g", "I", top)
        folders.file("g", ["deep"], inner)
        folders.delete("g", inner)
        self.assertEqual(self.names()["T"], ["deep"])                          # in the folder it was in
        with self.assertRaisesRegex(folders.FolderError, "no folder"):
            folders.delete("g", 9999)

    def test_the_folders_of_saved_actors_from_before_are_copied_in_once(self):
        os.makedirs(dashboard_home.HOME)
        conn = sqlite3.connect(sessions.db_path())
        conn.executescript("""
            CREATE TABLE saved (gatherer TEXT NOT NULL, channel TEXT NOT NULL, at TEXT NOT NULL, folder TEXT,
                                PRIMARY KEY (gatherer, channel));
            CREATE TABLE saved_folders (gatherer TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, at TEXT NOT NULL,
                                        PRIMARY KEY (gatherer, name));
            INSERT INTO saved_folders VALUES ('g', 'Paper', '2026-11-01T00:00:00+00:00'),
                                             ('g', 'Empty', '2026-11-02T00:00:00+00:00'),
                                             ('g', 'A/B', '2026-11-03T00:00:00+00:00'),
                                             ('h', 'Paper', '2026-11-04T00:00:00+00:00');
            INSERT INTO saved VALUES ('g', 'c1', '2026-11-05T00:00:00+00:00', 'paper'),
                                     ('g', 'c2', '2026-11-05T00:00:00+00:00', NULL),
                                     ('g', 'c3', '2026-11-05T00:00:00+00:00', 'A/B'),
                                     ('h', 'c4', '2026-11-05T00:00:00+00:00', 'Paper');
        """)
        conn.close()
        self.assertEqual(self.names(), {"A-B": ["c3"], "Empty": [], "Paper": ["c1"]})    # its case as made
        self.assertEqual(self.names("h"), {"Paper": ["c4"]})
        self.assertEqual(sorted(saved.stored()["g"]), ["c1", "c2", "c3"])               # all still saved
        folders.delete("g", folders.find("g", "Paper"))
        folders.ensure()                                                               # once: not again
        self.assertEqual(sorted(self.names()), ["A-B", "Empty"])
        saved.choose("g", "c5", True)                                                  # its table from before still takes one
        saved.choose("g", "c1", False)
        self.assertEqual(sorted(saved.stored()["g"]), ["c2", "c3", "c5"])


if __name__ == "__main__":
    unittest.main()
