"""Codex's plan in the Chat view: the page draws a harness's reply block (harness_kit's `reply_block`, read from the
home's harness_info) as a card -- frontend/src/core/ui/md.ts. Its cases run in Vitest (md.test.ts, Markdown.test.tsx)
on the reply blocks in frontend/src/core/ui/harness-info.json; here, that those are harness_kit's."""
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ag_dashboard import data  # noqa: E402

FIXTURE = os.path.join(ROOT, "frontend", "src", "core", "ui", "harness-info.json")


class PlanTest(unittest.TestCase):

    def test_the_pages_tests_read_the_reply_blocks_harness_kit_has(self):
        with open(FIXTURE, encoding="utf-8") as fh:
            fixture = json.load(fh)
        blocks = lambda info: {n: h["reply_block"] for n, h in info.items() if h.get("reply_block")}  # noqa: E731
        self.assertEqual(blocks(fixture), blocks(data.harness_info()),
                         "harness_kit's reply blocks changed: write them to the page's tests' harness-info.json")


if __name__ == "__main__":
    unittest.main()
