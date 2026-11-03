"""A run's instructions for agy, as agy's hook reads them: kept by ag's launcher (setup/told.py, whose `path` this
copies), by the run -- the /r/<run>/ of the URL agy is pointed at -- and added after the system instruction of each of
the run's calls. The run's directory too, kept beside them: the hook's, for a call that names none."""

import os
from typing import Dict, Optional, Tuple


def path(home: str, run: str, kind: str = "txt") -> str:
    return os.path.join(home, "runs", "antigravity", f"{run}.{kind}")


class Told:
    """The runs' files as the hook reads them: each read again only once it changed."""

    def __init__(self, home: Optional[str]):
        self.home = home
        self.kept: Dict[Tuple[str, str], Tuple[int, Optional[str]]] = {}   # (run, kind) -> (its file's mtime, its text)

    def of(self, run: Optional[str]) -> Optional[str]:
        """The run's instructions, None when it has none."""
        return self._read(run, "txt")

    def cwd(self, run: Optional[str]) -> Optional[str]:
        """The directory the run was started in, None when it is not known (a run of ag from before it was kept)."""
        return self._read(run, "cwd")

    def _read(self, run: Optional[str], kind: str) -> Optional[str]:
        if not self.home or not run:
            return None
        key, p = (str(run), kind), path(self.home, str(run), kind)
        try:
            mtime = os.stat(p).st_mtime_ns
        except OSError:
            self.kept.pop(key, None)
            return None
        got = self.kept.get(key)
        if got is None or got[0] != mtime:
            try:
                with open(p, encoding="utf-8") as fh:
                    got = (mtime, fh.read() or None)
            except OSError:
                return None
            self.kept[key] = got
        return got[1]
