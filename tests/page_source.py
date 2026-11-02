"""The dashboard's page as one text, as page.html held it before it was split into frontend/ (ag_dashboard/DESIGN.md,
step A3): its markup (frontend/index.html), its styles (src/legacy/css/) and its script (src/legacy/*.js, in the order
of src/legacy/order.json). For the tests that read the page, or run a part of its script in Node."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONT = os.path.join(ROOT, "frontend")
LEGACY = os.path.join(FRONT, "src", "legacy")
MODULE = '<script type="module" src="/src/main.ts"></script>'


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def order() -> dict:
    """{"css": [...], "js": [...]}: the files of the page's styles and script, in order."""
    return json.loads(_read(os.path.join(LEGACY, "order.json")))


def script_files() -> list:
    """The paths of the script's files, in order."""
    return [os.path.join(LEGACY, f) for f in order()["js"]]


def script() -> str:
    return "".join(_read(p) for p in script_files())


def styles() -> str:
    return "".join(_read(os.path.join(LEGACY, "css", f)) for f in order()["css"])


def text() -> str:
    """The whole page: its styles in its head, its script where the module's tag is."""
    head, rest = _read(os.path.join(FRONT, "index.html")).split("</head>", 1)
    return head + "<style>\n" + styles() + "</style>\n</head>" + rest.replace(MODULE, "<script>\n" + script() + "</script>", 1)
