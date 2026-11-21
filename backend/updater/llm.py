"""
OPTIONAL LLM extractor — off unless the user sets UPDATER_LLM_URL, UPDATER_LLM_KEY and UPDATER_LLM_MODEL for their own
OpenAI-compatible chat-completions endpoint (DATA_FRESHNESS_RESEARCH.md §3.2).

Guard rails, so the model is never trusted more than a pattern:
  1. every returned quote must be an exact substring of the fetched text (else dropped)
  2. the numeric value must be found in that quote by the deterministic number parser (else dropped)
  3. the project must be named in the quote (sentence-level attribution only)
  4. claims carry extractor `llm:<model>` and always need 2 independent sources to be corroborated
Never runs in tests (no key) and sends page text only to the endpoint the user configured.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import urllib.request

from .extract import ATTRIBUTES, MAX_QUOTE, Claim, parse_number, projects_in
from .text import norm_for_match

PROMPT = ("Extract facts about these Pune infrastructure projects from the article. Return JSON {\"facts\": [{\"project_id\", "
          "\"attribute\", \"value\", \"quote\"}]}. attribute is one of: {attrs}. quote MUST be one sentence copied exactly "
          "from the article that states the value. value: a number (metres, km, count, INR crore) or YYYY-MM for dates. "
          "Return nothing you cannot quote. Projects: {projects}")


def enabled() -> bool:
    return all(os.environ.get(k) for k in ("UPDATER_LLM_URL", "UPDATER_LLM_KEY", "UPDATER_LLM_MODEL"))


def _call(text: str, title: str, projects: list[dict]) -> list[dict]:
    body = {"model": os.environ["UPDATER_LLM_MODEL"], "temperature": 0, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": PROMPT.replace("{attrs}", ", ".join(ATTRIBUTES)).replace(
                             "{projects}", json.dumps([{"id": p["id"], "name": p["name"]} for p in projects]))},
                         {"role": "user", "content": f"{title}\n\n{text[:20000]}"}]}
    req = urllib.request.Request(os.environ["UPDATER_LLM_URL"], data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {os.environ['UPDATER_LLM_KEY']}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 — the user's own configured endpoint
        data = json.loads(r.read())
    content = data["choices"][0]["message"]["content"]
    return json.loads(content).get("facts", [])


CALL = _call   # replaced in tests


def validate(raw: list[dict], text: str, projects: list[dict], model: str) -> list[Claim]:
    out = []
    known = {p["id"]: p for p in projects}
    for f in raw:
        pid, attr, quote = f.get("project_id"), f.get("attribute"), (f.get("quote") or "").strip()
        if pid not in known or attr not in ATTRIBUTES or attr not in known[pid].get("attributes", []):
            continue
        if not quote or quote not in text:
            continue                                              # rule 1: verbatim quote
        if pid not in projects_in(norm_for_match(quote), [known[pid]]):
            continue                                              # rule 3: project named in the quote
        kind = ATTRIBUTES[attr]["kind"]
        val = f.get("value")
        if kind in ("number", "integer"):
            v = parse_number(str(val))
            nums = [parse_number(x) for x in re.findall(r"\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?", quote)]
            if v is None or v not in nums:
                continue                                          # rule 2: value appears in the quote
            out.append(Claim(pid, attr, v, None, ATTRIBUTES[attr]["unit"], "exact", None, quote[:MAX_QUOTE], "sentence", f"llm:{model}"))
        elif kind == "month":
            if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", str(val)):
                continue
            mon = dt.date(int(str(val)[:4]), int(str(val)[5:7]), 1).strftime("%B").lower()
            if mon not in quote.lower() and mon[:3] not in quote.lower():
                continue
            out.append(Claim(pid, attr, None, str(val), "month", "exact", None, quote[:MAX_QUOTE], "sentence", f"llm:{model}"))
    return out


def extract(text: str, title: str, projects: list[dict], published: dt.date | None) -> list[Claim]:  # noqa: ARG001
    if not enabled():
        return []
    try:
        raw = CALL(text, title, projects)
    except Exception:  # noqa: BLE001 — the optional extractor failing never stops a run
        return []
    return validate(raw, text, projects, os.environ.get("UPDATER_LLM_MODEL", "llm"))
