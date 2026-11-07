"""The ag desktop app's link (desktop/DESIGN.md, "The app link"): the WebSocket it opens to its dashboard
(api/apps.py's /api/desktop), over which it plays the browser for the native pages of the apps that ask for them
(app_kit's `native_view`: the Browser's) -- handed to those apps by the app host (app_host.py's `native_link`).

    app_token()   what the desktop app proves itself with when it connects: a secret in the home, readable by its user
                  alone, made on first use -- which no web page can read (<home>/dashboard/desktop-token, where the
                  desktop app reads it: desktop/src/browsers.ts's appToken)
"""

import os
import secrets

from . import home


def app_token() -> str:
    path = os.path.join(home.HOME, "dashboard", "desktop-token")
    try:
        with open(path) as fh:
            token = fh.read().strip()
        if token:
            return token
    except OSError:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    token = secrets.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(token)
    return token
