"""A process as ag records it: {"pid", "started"}, `started` the boot's id and the process's start
time in clock ticks since boot, as /proc gives them ("<boot id>:<ticks>"), so a later process given
the same pid is not taken for it. Linux only: elsewhere nothing can be told (None).

    identity(pid)            {"pid", "started"} of a running process, or None
    alive(pid, started)      whether that same process still runs: True, False, or None
    running(pid)             whether any process has that pid now, on every OS: True or False"""

import os
from typing import Optional

PROC = "/proc"


def running(pid: int) -> bool:
    """Whether a process with `pid` runs now. On POSIX, signal 0 asks without sending anything. Windows has no
    signal 0 (os.kill raises a bare OSError, WinError 87, for a pid that is gone), so there the process is opened
    and its exit code read."""
    if os.name == "nt":
        return _running_windows(int(pid))
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        return False
    except PermissionError:                  # it runs, as another user
        return True
    return True


def _running_windows(pid: int) -> bool:
    import ctypes
    from ctypes import wintypes
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    handle = kernel32.OpenProcess(0x1000, False, pid)        # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return ctypes.get_last_error() == 5                  # ERROR_ACCESS_DENIED: it runs, as another user
    try:
        code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return False
        return code.value == 259                             # STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def _boot_id() -> Optional[str]:
    try:
        with open(os.path.join(PROC, "sys", "kernel", "random", "boot_id"), encoding="ascii") as fh:
            return fh.read().strip()
    except OSError:
        return None


def identity(pid: int) -> Optional[dict]:
    try:
        with open(os.path.join(PROC, str(int(pid)), "stat"), encoding="ascii", errors="replace") as fh:
            fields = fh.read().rsplit(")", 1)[-1].split()   # after the command, which may hold spaces and ')'
    except (OSError, ValueError):
        return None
    boot = _boot_id()
    if len(fields) < 20 or boot is None:
        return None
    return {"pid": int(pid), "started": f"{boot}:{fields[19]}"}      # field 22 of stat: starttime


def alive(pid, started) -> Optional[bool]:
    if not isinstance(pid, int) or not isinstance(started, str) or not os.path.isdir(PROC):
        return None
    now = identity(pid)
    return now is not None and now["started"] == started
