"""A folder trusted before a harness starts in it (harness_kit's `trust`), so it does not first ask in its terminal: Codex
told for the run, Claude Code's settings file given the entry its own "Yes, I trust this folder" saves."""
import json
import os
import stat
import sys
import tempfile
import threading
import time
import tomllib
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import harness_kit  # noqa: E402
from harness_kit.claude import trust_folder  # noqa: E402

TRUSTED = {"hasTrustDialogAccepted": True}


class CodexTest(unittest.TestCase):
    def test_the_folder_trusted_for_the_run_by_a_projects_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = os.path.join(tmp, 'a "quoted" földer')
            os.makedirs(folder)
            flag, value = harness_kit.get("codex").trust(folder)
        self.assertEqual(flag, "-c")
        self.assertTrue(value.startswith("projects={"), value)          # a table: the dotted key form does not count
        self.assertEqual(tomllib.loads(value), {"projects": {os.path.realpath(folder): {"trust_level": "trusted"}}})


class AntigravityTest(unittest.TestCase):
    def test_nothing_more_than_its_command_s_add_dir(self):
        agy = harness_kit.get("antigravity")
        self.assertEqual(agy.trust("/w"), [])
        self.assertEqual(agy.command("s", cwd="/w")[:2], ["--add-dir", "/w"])


class ClaudeSettingsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.realpath(self.tmp.name)
        self.path = os.path.join(self.root, ".claude.json")
        self.settings = {"numStartups": 3, "oauthAccount": {"emailAddress": "x@y"}, "projects": {
            "/elsewhere": {"allowedTools": [], "hasTrustDialogAccepted": True}}}
        self.save()
        self.repo = os.path.join(self.root, "repo")
        os.makedirs(os.path.join(self.repo, ".git"))
        self.sub = os.path.join(self.repo, "sub")
        os.makedirs(self.sub)

    def save(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(self.settings, fh, indent=2)
        os.chmod(self.path, 0o600)

    def read(self):
        with open(self.path, encoding="utf-8") as fh:
            return json.load(fh)

    def test_the_folder_s_entry_added_the_rest_kept(self):
        self.settings["projects"][self.sub] = {"allowedTools": ["Bash"], "hasTrustDialogAccepted": False}
        self.save()
        self.assertTrue(trust_folder(self.path, self.sub))
        got = self.read()
        self.assertEqual(got["projects"][self.sub], {"allowedTools": ["Bash"], "hasTrustDialogAccepted": True})
        self.assertEqual({k: v for k, v in got.items() if k != "projects"}, {"numStartups": 3, "oauthAccount": {"emailAddress": "x@y"}})
        self.assertEqual(got["projects"]["/elsewhere"], self.settings["projects"]["/elsewhere"])
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)          # its mode kept: it holds the account
        self.assertEqual(sorted(os.listdir(self.root)), [".claude.json", "repo"])  # no lock, no temporary file left

    def test_resolved_as_it_names_folders(self):
        link = os.path.join(self.root, "link")
        os.symlink(self.sub, link)
        trust_folder(self.path, link)
        self.assertIn(self.sub, self.read()["projects"])
        decomposed = os.path.join(self.root, "café")                  # it names a folder in NFC
        os.makedirs(decomposed)
        trust_folder(self.path, decomposed)
        self.assertIn(os.path.join(self.root, "café"), self.read()["projects"])

    def test_nothing_written_where_it_already_trusts_it(self):
        for trusted in (self.sub, self.repo):                                # the folder, or up to its repository's top
            self.settings["projects"] = {trusted: TRUSTED}
            self.save()
            before = os.stat(self.path).st_mtime_ns
            self.assertFalse(trust_folder(self.path, self.sub), trusted)
            self.assertEqual(os.stat(self.path).st_mtime_ns, before)

    def test_a_folder_above_the_repository_does_not_count_one_outside_one_does(self):
        self.settings["projects"] = {self.root: TRUSTED}
        self.save()
        self.assertTrue(trust_folder(self.path, self.sub))                   # it stops at the repository's top
        plain = os.path.join(self.root, "plain", "deep")
        os.makedirs(plain)
        self.assertFalse(trust_folder(self.path, plain))                     # no repository: any folder above counts

    def test_its_lock_waited_for_and_never_broken(self):
        lock = self.path + ".lock"
        os.mkdir(lock)                                                       # a Claude Code writing it
        with self.assertRaisesRegex(harness_kit.TrustError, "locked"):
            trust_folder(self.path, self.sub, wait=0.2)
        self.assertTrue(os.path.isdir(lock))                                 # left to its holder
        self.assertNotIn(self.sub, self.read()["projects"])
        threading.Timer(0.2, os.rmdir, (lock,)).start()                      # let go while ag waits
        started = time.monotonic()
        self.assertTrue(trust_folder(self.path, self.sub, wait=5))
        self.assertGreater(time.monotonic() - started, 0.15)
        self.assertEqual(self.read()["projects"][self.sub], TRUSTED)

    def test_a_missing_or_unreadable_file_is_left_as_it_is(self):
        os.remove(self.path)
        with self.assertRaisesRegex(harness_kit.TrustError, "no settings file"):
            trust_folder(self.path, self.sub)
        self.assertFalse(os.path.exists(self.path))                          # Claude Code makes it, on its first run
        with open(self.path, "w") as fh:
            fh.write("{not json")
        with self.assertRaises(harness_kit.TrustError):
            trust_folder(self.path, self.sub)
        with open(self.path) as fh:
            self.assertEqual(fh.read(), "{not json")

    def test_the_harness_trusts_it_in_the_file_its_environment_names_not_the_home_folder(self):
        claude = harness_kit.get("claude")
        self.assertEqual(claude.trust(self.sub, {"CLAUDE_CONFIG_DIR": self.root, "HOME": "/nowhere"}), [])
        self.assertEqual(self.read()["projects"][self.sub], TRUSTED)
        os.rename(self.path, os.path.join(self.root, "home.json"))
        os.makedirs(os.path.join(self.root, "home"))
        os.rename(os.path.join(self.root, "home.json"), os.path.join(self.root, "home", ".claude.json"))
        home = os.path.join(self.root, "home")
        claude.trust(self.repo, {"HOME": home})                              # ~/.claude.json, of its HOME
        with open(os.path.join(home, ".claude.json")) as fh:
            self.assertEqual(json.load(fh)["projects"][self.repo], TRUSTED)
        with self.assertRaisesRegex(harness_kit.TrustError, "home folder"):
            claude.trust(home, {"HOME": home})                               # it trusts that for a session at a time


if __name__ == "__main__":
    unittest.main()
