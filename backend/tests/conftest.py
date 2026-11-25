"""
Test setup: point the app at a throwaway SQLite file *before* anything imports
database.connection, so tests never touch the developer's twincity.db.
"""

import os
import sys
import tempfile
from pathlib import Path

_tmpdir = tempfile.mkdtemp(prefix="twincity-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_tmpdir) / 'test.db'}"
# tests import synthetic data trees from the temp dir: allow it as an import root (the API refuses other paths)
os.environ.setdefault("URBANOS_IMPORT_ROOTS", tempfile.gettempdir())
# request/error log goes to the temp dir, never backend/logs/ (app_logging.py)
os.environ.setdefault("URBANOS_LOG_FILE", str(Path(_tmpdir) / "urbanos-test.log"))

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c
