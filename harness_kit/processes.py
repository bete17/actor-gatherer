"""Whether a process runs, on every OS. Here so that ag's integrations (the hook servers' records, Antigravity's
`told` files) and the dashboard share one copy without either importing the other.

    running(pid)    whether any process has that pid now: True or False (False for a pid that is no number)"""

import os


def running(pid) -> bool:
    """Whether a process with `pid` runs now. On POSIX, signal 0 asks without sending anything. Windows has no
    signal 0 (os.kill raises a bare OSError, WinError 87, for a pid that is gone), so there the process is opened
    and its exit code read."""
    try:
        pid = int(pid)
    except (ValueError, TypeError):
        return False
    if os.name == "nt":
        return _running_windows(pid)
    try:
        os.kill(pid, 0)
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
