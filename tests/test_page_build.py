"""ag_dashboard/page_build.py: when the dashboard's page counts as built, how pnpm is found, the build's two steps
and what a failed one tells, and that it needs nothing but the standard library (setup.py loads it before anything
is installed). Node, corepack, pnpm and npx are stand-ins on a PATH of the test's own."""

import ast
import contextlib
import io
import json
import os
import stat
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from ag_dashboard import page_build  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = self.tmp.name
        self.front = os.path.join(root, "frontend")
        self.static = os.path.join(root, "ag_dashboard", "static")
        self.index = os.path.join(self.static, "index.html")
        self.bin = os.path.join(root, "bin")
        for d in (os.path.join(self.front, "src"), self.bin):
            os.makedirs(d)
        self.write(os.path.join(self.front, "package.json"), json.dumps({"packageManager": "pnpm@12.16.1+sha512.ab"}))
        self.write(os.path.join(self.front, "src", "main.ts"), "")
        for name, value in (("FRONT", self.front), ("STATIC", self.static), ("INDEX", self.index)):
            patch = mock.patch.object(page_build, name, value)
            patch.start()
            self.addCleanup(patch.stop)
        env = mock.patch.dict(os.environ, {"PATH": self.bin})
        env.start()
        self.addCleanup(env.stop)

    def write(self, path, text):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)

    def tool(self, name, script):
        path = os.path.join(self.bin, name)
        self.write(path, "#!/bin/sh\n" + script + "\n")
        os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)

    def built_at(self, when):
        self.write(self.index, "<!doctype html>")
        os.utime(self.index, (when, when))


class WrongTest(Base):
    def test_not_built(self):
        self.assertEqual(page_build.wrong(), "the dashboard's page is not built")

    def test_built_after_its_source_is_right(self):
        self.built_at(time.time() + 60)
        self.assertIsNone(page_build.wrong())

    def test_a_source_changed_since_the_build(self):
        self.built_at(time.time() - 60)
        self.assertEqual(page_build.wrong(), "the dashboard's page is older than its source in frontend/")

    def test_a_lockfile_changed_since_the_build(self):
        self.built_at(time.time() + 60)
        lock = os.path.join(self.front, "pnpm-lock.yaml")
        self.write(lock, "")
        os.utime(lock, (time.time() + 120, time.time() + 120))
        self.assertIn("older than its source", page_build.wrong())

    def test_outside_a_checkout_a_build_is_right(self):
        self.built_at(time.time() - 60)
        os.remove(os.path.join(self.front, "package.json"))
        self.assertFalse(page_build.checkout())
        self.assertIsNone(page_build.wrong())


class PnpmTest(Base):
    def test_no_node(self):
        with self.assertRaises(page_build.BuildError) as got:
            page_build.pnpm()
        self.assertIn("Node.js 22.12", str(got.exception))
        self.assertIn("pip install actor-gatherer", str(got.exception))

    def test_a_node_too_old(self):
        for version in ("v18.20.0", "v20.18.3", "v21.7.0", "v22.11.0"):
            self.tool("node", f"echo {version}")
            self.tool("corepack", "exit 0")
            with self.assertRaises(page_build.BuildError, msg=version) as got:
                page_build.pnpm()
            self.assertIn(version, str(got.exception))

    def test_corepack_first(self):
        self.tool("node", "echo v22.12.0")
        for name in ("corepack", "pnpm", "npx"):
            self.tool(name, "exit 0")
        self.assertEqual(page_build.pnpm(), [os.path.join(self.bin, "corepack"), "pnpm"])

    def test_a_pnpm_of_ones_own(self):
        self.tool("node", "echo v20.19.1")
        for name in ("pnpm", "npx"):
            self.tool(name, "exit 0")
        self.assertEqual(page_build.pnpm(), [os.path.join(self.bin, "pnpm")])

    def test_npx_fetches_the_version_named(self):
        self.tool("node", "echo v25.1.0")                  # Node 25 comes without corepack
        self.tool("npx", "exit 0")
        self.assertEqual(page_build.pnpm(), [os.path.join(self.bin, "npx"), "--yes", "pnpm@12.16.1"])

    def test_node_alone(self):
        self.tool("node", "echo v22.12.0")
        with self.assertRaises(page_build.BuildError) as got:
            page_build.pnpm()
        self.assertIn("corepack, pnpm or npx", str(got.exception))


class BuildTest(Base):
    def setUp(self):
        super().setUp()
        self.tool("node", "echo v22.12.0")
        self.log = os.path.join(self.tmp.name, "log")

    def corepack(self, then=""):
        self.tool("corepack", f'echo "$PWD $* $COREPACK_ENABLE_DOWNLOAD_PROMPT" >> {self.log}\n{then}')

    def test_installed_then_built(self):
        self.corepack(f'[ "$2" = build ] && /bin/mkdir -p {self.static} && echo built > {self.index}\nexit 0')
        page_build.build(quiet=True)
        with open(self.log, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        self.assertEqual([line.split(" ", 1)[1] for line in lines], ["pnpm install --frozen-lockfile 0", "pnpm build 0"])
        self.assertEqual({os.path.realpath(line.split(" ", 1)[0]) for line in lines}, {os.path.realpath(self.front)})
        self.assertIsNone(page_build.wrong())

    def test_a_failed_step_told_with_its_output(self):
        self.corepack('echo "ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with frozen-lockfile"\nexit 3')
        with self.assertRaises(page_build.BuildError) as got:
            page_build.build(quiet=True)
        said = str(got.exception)
        self.assertIn("corepack pnpm install --frozen-lockfile", said)
        self.assertIn("exit 3", said)
        self.assertIn("ERR_PNPM_OUTDATED_LOCKFILE", said)
        with open(self.log, encoding="utf-8") as fh:
            self.assertEqual(len(fh.read().splitlines()), 1)   # no build after a failed install

    def test_ensure_builds_what_is_out_of_date(self):
        self.corepack(f'[ "$2" = build ] && /bin/mkdir -p {self.static} && echo built > {self.index}\nexit 0')
        said = []
        page_build.ensure(said.append)
        self.assertEqual(said, ["the dashboard's page is not built: building it (the first time: frontend/'s "
                                "packages are installed first)"])
        self.assertIsNone(page_build.wrong())
        page_build.ensure(said.append)                     # up to date: nothing done, nothing said
        self.assertEqual(len(said), 1)

    def test_ensure_tells_a_failed_build(self):
        self.corepack("echo boom\nexit 1")
        self.built_at(time.time() - 60)                    # built again (after a pull): quiet, its output told
        said = []
        page_build.ensure(said.append)
        self.assertEqual(said[0], "the dashboard's page is older than its source in frontend/: building it")
        self.assertIn("boom", said[1])

    def test_ensure_leaves_a_package_without_its_source(self):
        os.remove(os.path.join(self.front, "package.json"))
        said = []
        page_build.ensure(said.append)
        self.assertEqual(said, [])

    def test_by_hand_if_needed(self):
        self.built_at(time.time() + 60)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(page_build.main(["--if-needed"]), 0)
        self.assertIn("up to date", out.getvalue())


class StandaloneTest(unittest.TestCase):
    def test_it_imports_the_standard_library_alone(self):
        with open(page_build.__file__, encoding="utf-8") as fh:
            tree = ast.parse(fh.read())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                self.assertEqual(node.level, 0, "a relative import: setup.py loads page_build.py alone")
                names = [node.module]
            elif isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            else:
                continue
            for name in names:
                self.assertIn(name.split(".")[0], sys.stdlib_module_names, name)


if __name__ == "__main__":
    unittest.main()
