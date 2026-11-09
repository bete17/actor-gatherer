"""Writes what the Browser's manifest names from its core, so the two never differ: tools.json (core.TOOLS, each
answered by the backend) and instructions.md (core.instructions()). Run after changing either:

    python -m ag_apps.browser.make
"""
import json
import os

from . import core

HERE = os.path.dirname(os.path.abspath(__file__))


def tools() -> list:
    return [{"name": t["name"], "description": t["description"], "input_schema": t["inputSchema"], "handled_by": "backend"}
            for t in core.TOOLS]


def main() -> None:
    with open(os.path.join(HERE, "tools.json"), "w", encoding="utf-8") as fh:
        json.dump(tools(), fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    with open(os.path.join(HERE, "instructions.md"), "w", encoding="utf-8") as fh:
        fh.write(core.instructions().strip() + "\n")


if __name__ == "__main__":
    main()
