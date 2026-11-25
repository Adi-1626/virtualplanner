"""
Stable machine error codes for API error responses (docs/urbanos/DEVELOPER_HANDBOOK.md §5.7 "Logs and errors").

Every error response from the backend is JSON with:
    detail      the existing human/validation detail (kept so older clients and tests keep working)
    code        one of ERROR_CODES below; the frontend error catalogue (frontend/src/lib/errorCatalogue.ts) maps it to a
                short, user-facing message and a suggested action
    request_id  the X-Request-ID of the request; the same id is on the log line in backend/logs/urbanos.log
422 responses also carry `fields` (the names of the invalid fields, never their values).

A route that knows *why* it failed raises ApiProblem with a domain code (SIM_FAILED, AREA_NOT_COVERED, ...); any other
HTTPException gets the generic code for its status (STATUS_CODES). Codes are part of the API: add new ones, never rename.
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException

# code -> what it means (for the docs and the tests; the user-facing text lives in the frontend catalogue)
ERROR_CODES: dict[str, str] = {
    # generic, by HTTP status
    "BAD_REQUEST": "the request was malformed (400)",
    "UNAUTHORIZED": "not signed in (401)",
    "FORBIDDEN": "not allowed (403)",
    "NOT_FOUND": "the item or path does not exist (404)",
    "METHOD_NOT_ALLOWED": "wrong HTTP method (405)",
    "CONFLICT": "the item changed elsewhere or the request conflicts with its state (409)",
    "TOO_LARGE": "the request or upload is too large (413)",
    "VALIDATION_ERROR": "one or more fields are invalid (422); see `fields`",
    "RATE_LIMITED": "too many requests (429)",
    "UNAVAILABLE": "the server or an upstream it needs is not available (502/503)",
    "TIMEOUT": "an upstream took too long (504)",
    "INTERNAL": "unexpected server error (500); look up request_id in the log",
    # domain codes (raised with ApiProblem where the route knows the cause)
    "AREA_TOO_LARGE": "the selected area is larger than this endpoint accepts",
    "AREA_NOT_COVERED": "the local data does not cover the selected area",
    "NO_ROADS_IN_AREA": "the selected area has no roads",
    "DATA_NOT_AVAILABLE": "a dataset or index this needs is not installed on the server",
    "FILE_TOO_LARGE": "an uploaded file is larger than allowed",
    "SIM_UNAVAILABLE": "the simulation engine is not installed",
    "SIM_FAILED": "the simulation could not run",
    "SAVE_FAILED": "the change could not be saved",
    "EXPORT_FAILED": "the export could not be produced",
}

STATUS_CODES: dict[int, str] = {
    400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT", 413: "TOO_LARGE", 416: "AREA_NOT_COVERED", 422: "VALIDATION_ERROR", 429: "RATE_LIMITED",
    502: "UNAVAILABLE", 503: "UNAVAILABLE", 504: "TIMEOUT",
}


def code_for_status(status: int) -> str:
    """Generic code for an HTTP status (unknown 4xx -> BAD_REQUEST, unknown 5xx -> INTERNAL)."""
    if status in STATUS_CODES:
        return STATUS_CODES[status]
    return "INTERNAL" if status >= 500 else "BAD_REQUEST"


class ApiProblem(HTTPException):
    """An HTTPException with a stable domain `code` (must be in ERROR_CODES)."""

    def __init__(self, status_code: int, code: str, detail: Any = None, headers: dict[str, str] | None = None):
        if code not in ERROR_CODES:
            raise ValueError(f"unknown error code {code!r}; add it to app_errors.ERROR_CODES")
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code
