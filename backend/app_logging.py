"""
Request logging and error visibility for the UrbanOS backend (docs/urbanos/DEVELOPER_HANDBOOK.md §5.7 "Logs and errors").

What it does
- configure_logging(): stdlib logging on the root logger: console + rotating file (backend/logs/urbanos.log, 5 MB x 5),
  text lines or JSON lines, level from LOG_LEVEL. Every line carries the request id of the request it belongs to.
- RequestLogMiddleware: one line per HTTP request (request id, method, path, redacted query, status, duration, client IP,
  response size, error code). Accepts an incoming X-Request-ID (if it is a safe token), else makes a UUID4, and returns it
  in the X-Request-ID response header. 4xx -> WARNING, 5xx -> ERROR, slower than URBANOS_SLOW_REQUEST_MS -> WARNING.
  Noisy paths (status polls, tiles, PNG overlays, docs) are logged at DEBUG unless they fail or are slow.
  An unhandled exception is logged with its traceback and answered with 500 JSON {error, code, request_id, detail};
  the client never sees the stack trace.
- Exception handlers: HTTPException -> JSON {detail, code, request_id}; validation errors (422) -> {detail, code,
  fields, request_id}, logged with the field names only (never the values or the body).
- A ring buffer of the last WARNING/ERROR records and GET /api/admin/recent-errors (only when URBANOS_DEBUG=1).

Environment variables (all optional)
  LOG_LEVEL                   DEBUG | INFO (default) | WARNING | ERROR
  URBANOS_LOG_FORMAT          text (default) | json
  URBANOS_LOG_FILE            log file path (default backend/logs/urbanos.log); "off" or "" disables the file
  URBANOS_SLOW_REQUEST_MS     slow-request threshold in ms (default 2000)
  URBANOS_LOG_QUIET_PATHS     comma-separated glob patterns logged at DEBUG when they succeed (default QUIET_DEFAULT)
  URBANOS_LOG_QUIET_SAMPLE    fraction 0..1 of successful quiet requests still logged at INFO (default 0)
  URBANOS_UVICORN_ACCESS_LOG  1 keeps uvicorn's own access log (default: disabled, this middleware replaces it)
  URBANOS_RECENT_ERRORS_MAX   ring buffer size (default 200)
  URBANOS_DEBUG               1 enables GET /api/admin/recent-errors
"""
from __future__ import annotations

import collections
import contextvars
import fnmatch
import json
import logging
import logging.handlers
import os
import random
import re
import sys
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from app_errors import code_for_status

REQUEST_ID_HEADER = "X-Request-ID"
HTTP_LOGGER = "urbanos.http"
ERROR_LOGGER = "urbanos.errors"
DEFAULT_LOG_FILE = Path(__file__).resolve().parent / "logs" / "urbanos.log"
QUIET_DEFAULT = "/,/api/sim/status,/docs,/docs/*,/redoc,/openapi.json,/favicon.ico,*.png,*/tile,*/tiles/*"
_SAFE_ID = re.compile(r"^[A-Za-z0-9._:\-]{1,128}$")
# query parameter names whose values never reach a log line
_SENSITIVE_EXACT = {"key", "token", "password", "passwd", "pwd", "secret", "auth", "authorization", "code", "sig",
                    "signature", "session", "cookie", "otp", "pin", "credential", "credentials"}
_SENSITIVE_PARTS = ("token", "password", "passwd", "secret", "apikey", "api_key", "api-key", "signature", "credential",
                    "auth", "session")
_ABS_PATH = re.compile(r"(?:[A-Za-z]:)?(?:[\\/][\w.\-~ ]+){2,}")

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("urbanos_request_id", default="-")


# ─── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────

def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


def slow_threshold_ms() -> float:
    return _env_float("URBANOS_SLOW_REQUEST_MS", 2000.0)


def is_sensitive_param(name: str) -> bool:
    n = name.strip().lower()
    return n in _SENSITIVE_EXACT or n.endswith("key") or any(p in n for p in _SENSITIVE_PARTS)


def redact_query(query: str, max_len: int = 1000) -> str:
    """The query string with the values of sensitive parameters replaced by ***; long values cut."""
    if not query:
        return ""
    try:
        pairs = parse_qsl(query, keep_blank_values=True)
    except ValueError:
        return "<unparsable>"
    out = []
    for k, v in pairs:
        if is_sensitive_param(k):
            v = "***"
        elif len(v) > 200:
            v = v[:200] + "…"
        out.append(f"{k}={v}")
    s = "&".join(out)
    return s if len(s) <= max_len else s[:max_len] + "…"


def redact_paths(text: str) -> str:
    """Absolute file-system paths reduced to their last part (exception texts can name server paths)."""
    return _ABS_PATH.sub(lambda m: "…/" + re.split(r"[\\/]", m.group(0))[-1], text)


def _quiet_patterns() -> list[str]:
    raw = os.environ.get("URBANOS_LOG_QUIET_PATHS")
    return [p.strip() for p in (QUIET_DEFAULT if raw is None else raw).split(",") if p.strip()]


def is_quiet_path(path: str) -> bool:
    return any(fnmatch.fnmatchcase(path, p) for p in _quiet_patterns())


def field_names(errors: list[dict[str, Any]]) -> list[str]:
    """Field names from validation errors: ('body', 'items', 0, 'width') -> 'items.width'; never the values."""
    names: list[str] = []
    for e in errors:
        loc = [str(p) for p in e.get("loc", ()) if not isinstance(p, int)]
        if len(loc) > 1 and loc[0] in ("body", "query", "path", "header", "cookie"):
            loc = loc[1:]
        name = ".".join(loc) or "body"
        if name not in names:
            names.append(name)
    return names


# ─── formatters, filter, ring buffer ────────────────────────────────────────────────────────────────────────────────

class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = request_id_var.get()
        return True


def _iso(created: float) -> str:
    return datetime.fromtimestamp(created).astimezone().isoformat(timespec="milliseconds")


class TextFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] %(message)s")

    def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:  # noqa: N802
        return _iso(record.created)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {
            "ts": _iso(record.created), "level": record.levelname, "logger": record.name,
            "request_id": getattr(record, "request_id", "-"), "msg": record.getMessage(),
        }
        http = getattr(record, "http", None)
        if isinstance(http, dict):
            out.update(http)
        if record.exc_info:
            out["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
            out["traceback"] = self.formatException(record.exc_info)
        return json.dumps(out, ensure_ascii=False, default=str)


class RecentErrorsHandler(logging.Handler):
    """Keeps the last N WARNING+ records as small dicts with no secrets (no headers, bodies, query values or tracebacks)."""

    def __init__(self, maxlen: int = 200) -> None:
        super().__init__(level=logging.WARNING)
        self.records: collections.deque[dict[str, Any]] = collections.deque(maxlen=maxlen)
        self._lock_rb = threading.Lock()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            rec: dict[str, Any] = {
                "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
                "level": record.levelname, "logger": record.name,
                "request_id": getattr(record, "request_id", request_id_var.get()),
                # request lines are built here from redacted parts (and hold URL paths, not file paths): keep them as is
                "message": (record.getMessage() if record.name == HTTP_LOGGER else redact_paths(record.getMessage()))[:500],
            }
            http = getattr(record, "http", None)
            if isinstance(http, dict):
                rec.update({k: http.get(k) for k in ("method", "path", "query", "status", "duration_ms", "code")})
            if record.exc_info and record.exc_info[1] is not None:
                exc = record.exc_info[1]
                rec["exc_type"] = type(exc).__name__
                rec["exc_message"] = redact_paths(str(exc))[:300]
                tb = traceback.extract_tb(record.exc_info[2]) if record.exc_info[2] else []
                if tb:
                    last = tb[-1]
                    rec["where"] = f"{Path(last.filename).name}:{last.lineno} in {last.name}"
            with self._lock_rb:
                self.records.append(rec)
        except Exception:  # pragma: no cover - logging must never raise
            self.handleError(record)

    def recent(self, limit: int, min_level: int) -> list[dict[str, Any]]:
        with self._lock_rb:
            items = list(self.records)
        items = [r for r in items if logging.getLevelName(r["level"]) >= min_level]
        return list(reversed(items))[:limit]


recent_errors = RecentErrorsHandler(int(_env_float("URBANOS_RECENT_ERRORS_MAX", 200)))
_configured = False


def configure_logging() -> None:
    """Idempotent logging setup (safe to call from main.py on every import, including uvicorn --reload workers)."""
    global _configured
    if _configured:
        return
    _configured = True
    level = logging.getLevelName((os.environ.get("LOG_LEVEL") or "INFO").upper())
    if not isinstance(level, int):
        level = logging.INFO
    fmt: logging.Formatter = JsonFormatter() if (os.environ.get("URBANOS_LOG_FORMAT") or "").lower() == "json" else TextFormatter()
    rid_filter = RequestIdFilter()

    handlers: list[logging.Handler] = []
    console = logging.StreamHandler(sys.stderr)
    handlers.append(console)
    file_setting = os.environ.get("URBANOS_LOG_FILE")
    log_file: Path | None = DEFAULT_LOG_FILE if file_setting is None else (
        None if file_setting.strip().lower() in ("", "off", "none", "0") else Path(file_setting))
    file_handler: logging.Handler | None = None
    if log_file is not None:
        try:
            log_file.parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.handlers.RotatingFileHandler(log_file, maxBytes=5 * 1024 * 1024, backupCount=5,
                                                                encoding="utf-8", delay=True)
            handlers.append(file_handler)
        except OSError as e:  # read-only checkout: console only
            print(f"[logging] cannot open {log_file}: {e}; logging to the console only", file=sys.stderr)
    for h in handlers:
        h.setFormatter(fmt)
        h.addFilter(rid_filter)
    recent_errors.addFilter(rid_filter)

    root = logging.getLogger()
    root.setLevel(level)
    for h in handlers:
        root.addHandler(h)
    root.addHandler(recent_errors)

    # uvicorn's loggers do not propagate to the root: send its startup/error lines to the file and the ring buffer too
    # (its own console handler already prints them).
    uv = logging.getLogger("uvicorn")
    if file_handler is not None:
        uv.addHandler(file_handler)
    uv.addHandler(recent_errors)
    # One access line per request comes from RequestLogMiddleware; uvicorn's access log would duplicate it.
    if os.environ.get("URBANOS_UVICORN_ACCESS_LOG") != "1":
        logging.getLogger("uvicorn.access").disabled = True

    logging.getLogger("urbanos").info(
        "logging ready: level=%s format=%s file=%s slow_ms=%.0f", logging.getLevelName(level),
        "json" if isinstance(fmt, JsonFormatter) else "text", log_file or "off", slow_threshold_ms())


# ─── middleware ─────────────────────────────────────────────────────────────────────────────────────────────────────

def _incoming_request_id(scope: dict[str, Any]) -> str:
    for k, v in scope.get("headers") or ():
        if k == b"x-request-id":
            cand = v.decode("latin-1").strip()
            if _SAFE_ID.match(cand):
                return cand
            break
    return str(uuid.uuid4())


class RequestLogMiddleware:
    """Pure ASGI middleware (works with streaming and file responses, measures the real body size)."""

    def __init__(self, app: Any) -> None:
        self.app = app
        self.log = logging.getLogger(HTTP_LOGGER)

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        rid = _incoming_request_id(scope)
        scope.setdefault("state", {})["request_id"] = rid
        token = request_id_var.set(rid)
        start = time.perf_counter()
        status = 0
        size = 0
        started = False

        async def send_wrapper(message: dict[str, Any]) -> None:
            nonlocal status, size, started
            if message["type"] == "http.response.start":
                started = True
                status = message["status"]
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"x-request-id"]
                headers.append((b"x-request-id", rid.encode("latin-1")))
                message = {**message, "headers": headers}
            elif message["type"] == "http.response.body":
                size += len(message.get("body", b""))
            await send(message)

        exc_for_log: BaseException | None = None
        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:  # unhandled: log with traceback, answer 500 JSON with no stack trace
            exc_for_log = exc
            state = scope["state"]
            state["error_code"] = "INTERNAL"
            state["error_detail"] = type(exc).__name__
            if started:
                self._log_line(scope, status or 500, start, size, exc)
                request_id_var.reset(token)
                raise
            resp = JSONResponse(status_code=500, content={
                "error": "Internal server error", "code": "INTERNAL", "request_id": rid,
                "detail": "Internal server error"})
            await resp(scope, receive, send_wrapper)
        try:
            self._log_line(scope, status, start, size, exc_for_log)
        finally:
            request_id_var.reset(token)

    def _log_line(self, scope: dict[str, Any], status: int, start: float, size: int, exc: BaseException | None) -> None:
        dur = (time.perf_counter() - start) * 1000.0
        path = scope.get("path", "")
        query = redact_query((scope.get("query_string") or b"").decode("latin-1"))
        client = scope.get("client")
        ip = client[0] if client else "-"
        state = scope.get("state") or {}
        code = state.get("error_code")
        slow = dur > slow_threshold_ms()
        if status >= 500 or exc is not None:
            level = logging.ERROR
        elif status >= 400 or slow:
            level = logging.WARNING
        elif is_quiet_path(path):
            sample = _env_float("URBANOS_LOG_QUIET_SAMPLE", 0.0)
            level = logging.INFO if sample > 0 and random.random() < sample else logging.DEBUG
        else:
            level = logging.INFO
        if not self.log.isEnabledFor(level):
            return
        target = f"{path}?{query}" if query else path
        parts = [f"{scope.get('method', '-')} {target}", f"status={status}", f"dur_ms={dur:.1f}", f"size={size}", f"ip={ip}"]
        if code:
            parts.append(f"code={code}")
        if state.get("error_fields"):
            parts.append("fields=" + ",".join(state["error_fields"]))
        if state.get("error_detail") and status >= 400:
            parts.append(f"reason={state['error_detail']!r}")
        if slow:
            parts.append(f"slow(>{slow_threshold_ms():.0f}ms)")
        http = {"method": scope.get("method"), "path": path, "query": query, "status": status,
                "duration_ms": round(dur, 1), "size": size, "client_ip": ip, "code": code, "slow": slow}
        self.log.log(level, " ".join(parts), exc_info=(type(exc), exc, exc.__traceback__) if exc is not None else None,
                     extra={"http": http})


# ─── exception handlers ─────────────────────────────────────────────────────────────────────────────────────────────

def _rid(request: Request) -> str:
    return request.scope.get("state", {}).get("request_id") or request_id_var.get()


def _short(detail: Any) -> str:
    s = detail if isinstance(detail, str) else json.dumps(jsonable_encoder(detail), ensure_ascii=False)
    return redact_paths(s)[:200]


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> Response:
    code = getattr(exc, "code", None) or code_for_status(exc.status_code)
    state = request.scope.setdefault("state", {})
    state["error_code"] = code
    state["error_detail"] = _short(exc.detail)
    if exc.status_code >= 500:  # a deliberate 5xx (e.g. a wrapped simulation error): keep the cause's traceback in the log
        cause = exc.__cause__ or exc
        logging.getLogger(ERROR_LOGGER).error("HTTP %s %s raised: %s", exc.status_code, code, _short(exc.detail),
                                              exc_info=(type(cause), cause, cause.__traceback__))
    headers = getattr(exc, "headers", None)
    if exc.status_code in (204, 304):
        return Response(status_code=exc.status_code, headers=headers)
    return JSONResponse(status_code=exc.status_code, headers=headers,
                        content={"detail": jsonable_encoder(exc.detail), "code": code, "request_id": _rid(request)})


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> Response:
    errors = list(exc.errors())
    fields = field_names(errors)
    state = request.scope.setdefault("state", {})
    state["error_code"] = "VALIDATION_ERROR"
    state["error_fields"] = fields
    # FastAPI's default 422 detail is kept as is (clients and tests read it); the log line holds field names only.
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors), "code": "VALIDATION_ERROR",
                                                  "fields": fields, "request_id": _rid(request)})


# ─── admin endpoint ─────────────────────────────────────────────────────────────────────────────────────────────────

admin_router = APIRouter(prefix="/admin", tags=["admin"])


@admin_router.get("/recent-errors")
def get_recent_errors(limit: int = Query(50, ge=1, le=500), include_warnings: bool = False):
    """The last error records from memory (newest first). Enabled only when URBANOS_DEBUG=1; otherwise 404."""
    from app_errors import ApiProblem
    if os.environ.get("URBANOS_DEBUG") != "1":
        raise ApiProblem(404, "NOT_FOUND", "Not Found")
    min_level = logging.WARNING if include_warnings else logging.ERROR
    return {"records": recent_errors.recent(limit, min_level), "buffer_size": recent_errors.records.maxlen}


def install(app: FastAPI) -> None:
    """Add the middleware, the exception handlers and /api/admin/recent-errors. Call before adding CORS/GZip so this
    middleware sits inside them (its 500 answers then still get CORS headers)."""
    app.add_middleware(RequestLogMiddleware)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.include_router(admin_router, prefix="/api")
