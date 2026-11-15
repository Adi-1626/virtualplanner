"""Keep server filesystem paths out of user-facing API text (docs/urbanos/UNDERGROUND_VISUAL_FIXES.md).

Error details, dataset notes and "reason" strings are shown in the UI. They must never carry an absolute path such as
``C:\\Users\\adity\\...\\derived`` or ``/workspace/work/urbanos-data/...``: it says nothing to a planner and leaks the
server's layout. The full message still goes to the server log. No third-party imports (imported by APIs and screening).
"""
from __future__ import annotations

import re
from pathlib import PurePosixPath, PureWindowsPath

LOCAL_DEM_NOT_LOADED = "Local DEM not loaded on this server (terrain dataset not processed); ground is UNKNOWN"

# Windows drive paths (C:\x\y, C:/x/y) and UNC paths (\\server\share\x)
_WIN = re.compile(r"(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\)[^\s'\"<>|,;)]*")
# POSIX absolute paths with at least two segments (/workspace/work/x, /home/u/x, /tmp/x/y); not URLs (://) and not
# /api/... routes. A single-segment "/x" is left alone ("km/h", "m/s" never start with "/").
_POSIX = re.compile(r"(?<![\w:/.])/(?!api/)(?:[\w.@~+-]+/)+[\w.@~+-]*")


def _name(p: str) -> str:
    """Last segment of a path, or '' for a directory-looking path."""
    s = p.rstrip("\\/")
    base = PureWindowsPath(s).name if ("\\" in s or re.match(r"^[A-Za-z]:", s)) else PurePosixPath(s).name
    return base if "." in base else ""


def redact_paths(text):
    """Replace absolute filesystem paths in a message with the file name (or 'a local folder'). Non-strings pass through."""
    if not isinstance(text, str) or not text:
        return text

    def sub(m: re.Match) -> str:
        n = _name(m.group(0))
        return n if n else "a local folder"

    return _POSIX.sub(sub, _WIN.sub(sub, text))


def public_path(p, root=None) -> str | None:
    """A path fit to show: relative to ``root`` (usually the data directory) when inside it, else the file name only."""
    if p is None:
        return None
    s = str(p)
    if root is not None:
        r = str(root).rstrip("\\/")
        norm, rn = s.replace("\\", "/"), r.replace("\\", "/")
        if rn and norm.startswith(rn + "/"):
            return norm[len(rn) + 1:]
    is_abs = s.startswith("/") or s.startswith("\\\\") or bool(re.match(r"^[A-Za-z]:[\\/]", s))
    if not is_abs:
        return s
    return (PureWindowsPath(s) if ("\\" in s or re.match(r"^[A-Za-z]:", s)) else PurePosixPath(s)).name
