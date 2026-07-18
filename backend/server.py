"""AppSail entrypoint for the Catalyst-managed Python runtime.

AppSail does not install requirements.txt — dependencies are vendored (as Linux
wheels) into ./vendor. This puts that folder on sys.path, then starts uvicorn bound
to the port Catalyst injects via X_ZOHO_CATALYST_LISTEN_PORT.

Start command (app-config.json): python3 -u server.py
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_VENDOR = os.path.join(_HERE, "vendor")
if os.path.isdir(_VENDOR) and _VENDOR not in sys.path:
    sys.path.insert(0, _VENDOR)

import uvicorn  # noqa: E402 — must follow the sys.path insert above

if __name__ == "__main__":
    port = int(os.getenv("X_ZOHO_CATALYST_LISTEN_PORT", "9000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
