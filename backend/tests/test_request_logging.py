"""Request logging, X-Request-ID, JSON error bodies with codes, redaction, recent-errors endpoint (app_logging.py)."""
import logging

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

import app_logging
from app_errors import ERROR_CODES, ApiProblem, code_for_status
from app_logging import field_names, install, is_quiet_path, redact_paths, redact_query

HTTP = "urbanos.http"


class Item(BaseModel):
    name: str
    width_m: float


def _app() -> FastAPI:
    app = FastAPI()
    install(app)

    @app.get("/api/ok")
    def ok():
        return {"ok": True}

    @app.get("/api/boom")
    def boom():
        raise RuntimeError("database at /srv/secret/path/db.sqlite exploded")

    @app.get("/api/missing")
    def missing():
        raise HTTPException(404, "Scenario not found")

    @app.get("/api/sim")
    def sim():
        raise ApiProblem(500, "SIM_FAILED", "SUMO simulation error: x")

    @app.post("/api/items")
    def items(item: Item):
        return item

    @app.get("/api/sim/status")
    def status():
        return {"ok": True}

    return app


@pytest.fixture()
def c():
    with TestClient(_app()) as client:
        yield client


def _lines(caplog, name=HTTP):
    return [r for r in caplog.records if r.name == name]


def test_request_id_generated_and_echoed(c, caplog):
    with caplog.at_level(logging.INFO):
        r = c.get("/api/ok")
    rid = r.headers["x-request-id"]
    assert len(rid) == 36 and rid.count("-") == 4
    (rec,) = _lines(caplog)
    assert rec.levelno == logging.INFO and rec.request_id == rid
    assert rec.http["status"] == 200 and rec.http["method"] == "GET" and rec.http["path"] == "/api/ok"
    assert rec.http["size"] == len(r.content) and rec.http["duration_ms"] >= 0 and rec.http["client_ip"]

    r2 = c.get("/api/ok", headers={"X-Request-ID": "abc-123.x"})
    assert r2.headers["x-request-id"] == "abc-123.x"
    # an unsafe incoming id (log injection) is replaced
    r3 = c.get("/api/ok", headers={"X-Request-ID": "bad id\nINFO fake"})
    assert r3.headers["x-request-id"] != "bad id\nINFO fake" and len(r3.headers["x-request-id"]) == 36


def test_real_app_returns_request_id_and_coded_404(client):
    r = client.get("/api/definitely-not-a-route")
    assert r.status_code == 404
    body = r.json()
    assert body["code"] == "NOT_FOUND" and body["request_id"] == r.headers["x-request-id"] and "detail" in body
    assert "x-request-id" in client.get("/").headers


def test_unhandled_500_logged_with_traceback_and_json_body(c, caplog):
    with caplog.at_level(logging.INFO):
        r = c.get("/api/boom")
    assert r.status_code == 500
    body = r.json()
    rid = r.headers["x-request-id"]
    assert body == {"error": "Internal server error", "code": "INTERNAL", "request_id": rid, "detail": "Internal server error"}
    assert "Traceback" not in r.text and "RuntimeError" not in r.text and "/srv/secret" not in r.text
    (rec,) = _lines(caplog)
    assert rec.levelno == logging.ERROR and rec.request_id == rid and rec.exc_info and rec.exc_info[0] is RuntimeError
    text = logging.Formatter().formatException(rec.exc_info)
    assert "Traceback" in text and "boom" in text


def test_http_exceptions_get_codes_and_levels(c, caplog):
    with caplog.at_level(logging.INFO):
        r = c.get("/api/missing")
        r2 = c.get("/api/sim")
    assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND" and r.json()["detail"] == "Scenario not found"
    assert r2.status_code == 500 and r2.json()["code"] == "SIM_FAILED"
    lines = _lines(caplog)
    assert [x.levelno for x in lines] == [logging.WARNING, logging.ERROR]
    assert "code=NOT_FOUND" in lines[0].getMessage() and "Scenario not found" in lines[0].getMessage()
    assert lines[1].http["code"] == "SIM_FAILED"
    assert any(x.name == app_logging.ERROR_LOGGER and x.exc_info for x in caplog.records)  # deliberate 5xx keeps a traceback


def test_query_redaction_in_log(c, caplog):
    with caplog.at_level(logging.INFO):
        c.get("/api/ok?bbox=1,2,3,4&token=SECRET1&api_key=SECRET2&password=SECRET3&layerKey=SECRET4&q=road")
    msg = _lines(caplog)[0].getMessage()
    for s in ("SECRET1", "SECRET2", "SECRET3", "SECRET4"):
        assert s not in msg
    assert "bbox=1,2,3,4" in msg and "q=road" in msg and "token=***" in msg


def test_redact_helpers():
    assert redact_query("a=1&Token=x&secret_value=y") == "a=1&Token=***&secret_value=***"
    assert redact_query("") == ""
    assert "/home/u/x" not in redact_paths("failed at /home/u/x/file.db now")
    assert "file.db" in redact_paths("failed at /home/u/x/file.db now")


def test_slow_request_warning(c, caplog, monkeypatch):
    monkeypatch.setenv("URBANOS_SLOW_REQUEST_MS", "0")
    with caplog.at_level(logging.INFO):
        r = c.get("/api/ok")
    assert r.status_code == 200
    (rec,) = _lines(caplog)
    assert rec.levelno == logging.WARNING and rec.http["slow"] is True and "slow(" in rec.getMessage()


def test_validation_422_logs_field_names_not_values(c, caplog):
    with caplog.at_level(logging.INFO):
        r = c.post("/api/items", json={"name": "TOPSECRETVALUE", "width_m": "wide-ish"})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "VALIDATION_ERROR" and body["fields"] == ["width_m"] and body["request_id"]
    assert isinstance(body["detail"], list)  # FastAPI's detail kept for existing clients
    (rec,) = _lines(caplog)
    msg = rec.getMessage()
    assert rec.levelno == logging.WARNING and "fields=width_m" in msg
    assert "TOPSECRETVALUE" not in msg and "wide-ish" not in msg


def test_field_names():
    errs = [{"loc": ("body", "items", 0, "width")}, {"loc": ("query", "bbox")}, {"loc": ("body",)}, {"loc": ("query", "bbox")}]
    assert field_names(errs) == ["items.width", "bbox", "body"]


def test_quiet_paths_logged_at_debug_only(c, caplog, monkeypatch):
    with caplog.at_level(logging.INFO):
        c.get("/api/sim/status")
    assert _lines(caplog) == []
    assert is_quiet_path("/api/terrain/overlays/hillshade.png") and is_quiet_path("/api/env-data/trees/tile")
    assert not is_quiet_path("/api/objects")
    monkeypatch.setenv("URBANOS_LOG_QUIET_PATHS", "")
    with caplog.at_level(logging.INFO):
        c.get("/api/sim/status")
    assert len(_lines(caplog)) == 1


def test_recent_errors_endpoint_guarded(c, monkeypatch):
    monkeypatch.delenv("URBANOS_DEBUG", raising=False)
    assert c.get("/api/admin/recent-errors").status_code == 404
    rid = c.get("/api/boom").headers["x-request-id"]
    monkeypatch.setenv("URBANOS_DEBUG", "1")
    r = c.get("/api/admin/recent-errors?limit=20")
    assert r.status_code == 200
    recs = r.json()["records"]
    mine = [x for x in recs if x["request_id"] == rid]
    assert mine and all(x["level"] in ("ERROR", "CRITICAL") for x in recs)
    rec = mine[0]
    assert rec["status"] == 500 and rec["code"] == "INTERNAL" and rec["exc_type"] == "RuntimeError"
    assert "/srv/secret" not in str(recs) and "Traceback" not in str(recs)
    assert "GET /api/boom" in rec["message"]  # URL paths in request lines are not mistaken for file paths


def test_codes_are_registered():
    for status in (400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504, 418, 599):
        assert code_for_status(status) in ERROR_CODES
    with pytest.raises(ValueError):
        ApiProblem(400, "NOT_A_CODE")
