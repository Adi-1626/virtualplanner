"""
Underground screening report (docs/urbanos/UNDERGROUND_CHECKS.md §2.8): one screening run → PDF / DOCX (the investigation
document renderers in feasibility/docgen.py) or CSV of every finding.

Contents, in order: header (alternative, date, engine and rules version, the banner), summary counts with what each status
means, findings (Potential conflict / Requires investigation / Verified in full with the five fixed parts; Insufficient data
as one line per shared reason — dataset, network or missing input — with its places listed), rules applied with their
sources, data used, what was not checked, and the next-investigation plan in the Indian order (owner as-builts → Call
Before u Dig → GPR → trial pits → Maha-Metro NOC → boreholes → specialist). The CSV carries the five parts of EVERY finding.

Wording: never safe / feasible / passed / compliant / approved (tests/test_underground_screening_report.py).
"""

from __future__ import annotations

import csv
import datetime
import io
from collections import OrderedDict
from typing import Optional
from zoneinfo import ZoneInfo

from feasibility import docgen
from feasibility.docgen import Block, DocModel, Section

from . import screening as S
from . import screening_config as C

REPORT_VERSION = "underground-screening-report 1.0 (2026-11-15)"
IST = ZoneInfo("Asia/Kolkata")
PDF_GAP_ROWS = 150            # places listed per Insufficient-data reason in the PDF (all of them are in the CSV)
DIM = {"H": "horizontal", "V": "vertical", "3D": "any direction"}
RULE_TYPE = {"normative": "normative", "draft_guideline": "draft guideline", "rule_of_thumb": "rule of thumb",
             "international": "international (comparison)", "no_norm": "no Indian norm", "user_override": "user override"}
CATEGORY = {"clearance": "Clearance", "metro": "Metro", "cover": "Cover / depth", "buildings": "Buildings", "watercourse": "Nalla / river",
            "groundwater": "Groundwater", "geology": "Ground conditions", "data_gap": "Missing data"}


def when(iso_utc: str) -> str:
    """'2026-11-15T12:41:00Z' → '2026-11-15 18:11 IST (12:41 UTC)'."""
    try:
        t = datetime.datetime.fromisoformat(iso_utc.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return str(iso_utc)
    return f"{t.astimezone(IST):%Y-%m-%d %H:%M} IST ({t.astimezone(datetime.timezone.utc):%H:%M} UTC)"


def _m(v) -> Optional[str]:
    return f"{v:.1f} m" if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def key_numbers(f: dict) -> str:
    """The one or two numbers that matter, in words (same as the result panel)."""
    x = f.get("measurements") or {}
    out = []
    cat = f["category"]
    if cat in ("clearance", "metro"):
        out.append("Crosses in plan" if x.get("crossing") else f"Plan distance {_m(x.get('horizontal_m')) or 'unknown'}"
                   + (f" (needs {_m(x.get('required_horizontal_m'))})" if x.get("required_horizontal_m") else ""))
        if x.get("vertical_checkable") is False:
            out.append("Vertical: not checkable")
        elif x.get("vertical_gap_m") is not None:
            out.append(f"Vertical gap {_m(x['vertical_gap_m'])}" + (f" (needs {_m(x.get('required_vertical_m'))})" if x.get("required_vertical_m") else ""))
        else:
            out.append("Vertical gap unknown")
        if f.get("protection_zone"):
            out.append("Maha-Metro NOC")
    elif cat == "cover" and _m(x.get("crown_min_m")):
        out.append(f"Cover {_m(x['crown_min_m'])}")
    elif cat == "buildings" and x.get("buildings_in_zone") is not None:
        out.append(f"{x['buildings_in_zone']} building(s) within {_m(x.get('zone_m')) or '?'}")
    elif cat == "groundwater":
        if _m(x.get("shallowest_water_m")):
            out.append(f"Water {_m(x['shallowest_water_m'])} below ground")
        if _m(x.get("deepest_asset_m")):
            out.append(f"asset to {_m(x['deepest_asset_m'])}")
    return " · ".join(out)


def gap_groups(findings: list[dict]) -> list[dict]:
    """Insufficient-data findings by shared reason, largest first."""
    by: "OrderedDict[str, dict]" = OrderedDict()
    for f in findings:
        if f["status"] != "insufficient_data":
            continue
        g = f.get("gap_group") or S.gap_group(f)
        cur = by.setdefault(g["key"], {**g, "findings": []})
        cur["findings"].append(f)
    out = list(by.values())
    for g in out:
        g["crossings"] = sum(1 for f in g["findings"] if (f.get("measurements") or {}).get("crossing") is True)
        g["objects"] = len({f["proposed"]["id"] for f in g["findings"]})
    out.sort(key=lambda g: (-len(g["findings"]), g["label"]))
    return out


def count_text(g: dict) -> str:
    n, unit = len(g["findings"]), g["unit"]
    if unit == "crossing or near pass":
        t = "1 crossing or near pass" if n == 1 else f"{n} crossings or near passes"
        if 0 < g["crossings"] < n:
            t += f" ({g['crossings']} cross in plan)"
    else:
        t = f"{n} {unit}" + ("" if n == 1 else "s")
    if unit != "object" and g["objects"] > 1:
        t += f" · {g['objects']} proposed objects"
    return t


def rules_applied(run: dict) -> list[dict]:
    """Every rule cited by at least one finding (id, value, direction, type, source, clause) with how many findings cite it."""
    rows: "OrderedDict[str, dict]" = OrderedDict()
    for f in run["findings"]:
        for r in f.get("rules") or []:
            k = f"{r['id']}|{r['value_m']}|{r['dim']}"
            cur = rows.setdefault(k, {**r, "findings": 0})
            cur["findings"] += 1
    return sorted(rows.values(), key=lambda r: (r["id"], r["value_m"]))


def investigation_plan(run: dict, ladder: Optional[list] = None) -> list[dict]:
    """Next investigations of all findings merged, in the order of the Indian process; each with how many findings call for
    it and for which proposed objects. Steps outside the ladder (e.g. 'enter the crown depth') follow as 'other'."""
    ladder = ladder or (run.get("config") or {}).get("ladder") or [list(x) for x in C.LADDER]
    order = {text: i for i, (_, text) in enumerate(ladder)}
    keys = {text: k for k, text in ladder}
    by: dict[str, dict] = {}
    for f in run["findings"]:
        for s in f.get("next_steps") or []:
            cur = by.setdefault(s, {"step": s, "key": keys.get(s, "other"), "findings": 0, "objects": set(), "statuses": set()})
            cur["findings"] += 1
            cur["objects"].add(f["proposed"]["name"])
            cur["statuses"].add(f["status"])
    out = sorted(by.values(), key=lambda d: (order.get(d["step"], len(order)), -d["findings"], d["step"]))
    for i, d in enumerate(out, 1):
        d["order"] = i
        d["objects"] = sorted(d["objects"])
        d["statuses"] = [S.STATUS_LABEL[s] for s in S.STATUSES if s in d["statuses"]]
    return out


def not_checked(run: dict) -> list[str]:
    out = list(run["summary"].get("not_checked") or [])
    for s in run["summary"].get("skipped") or []:
        out.append(f"{s.get('name') or s.get('id')}: not screened ({s.get('reason')}).")
    for p in run["summary"].get("proposed_checked") or []:
        for c in p.get("checklist") or []:
            if c.get("result") == S.CHECK_NOT:
                out.append(f"{p['name']}: {c['check']} — {(c.get('detail') or 'not checked').rstrip('.')}.")
    return out


def _five(f: dict) -> list[Block]:
    data = "; ".join(f"{d['dataset']} ({d['quality_level']}{', datum ' + d['datum'] if d.get('datum') else ''})" for d in f.get("data_used") or [])
    blocks = [Block("para", text=f"Checked: {f['checked']}"), Block("para", text=f"Data used: {data or '—'}"),
              Block("bullets", items=[f"Found: {x}" for x in f["found"]])]
    if f.get("buildings"):
        near = ", ".join(f"{b.get('name') or 'building'} ({_m(b.get('distance_m')) or '?'})" for b in f["buildings"][:5])
        blocks.append(Block("note", text=f"Nearest buildings: {near}" + (f" and {len(f['buildings']) - 5} more." if len(f["buildings"]) > 5 else ".")))
    blocks.append(Block("bullets", items=[f"Not checked: {x}" for x in f["not_checked"]]))
    blocks.append(Block("bullets", items=[f"Next investigation {i}: {x}" for i, x in enumerate(f["next_steps"], 1)]))
    if f.get("verification"):
        v = f["verification"]
        blocks.append(Block("note", text=f"Field verification recorded by {v['verified_by']} ({v['method'].replace('_', ' ')})"
                                          + (" — an asset changed since; re-verify." if v.get("stale") else ".")))
    return blocks


def build_model(run: dict, alternative: str, now: Optional[datetime.datetime] = None) -> DocModel:
    sm = run["summary"]
    counts = sm["counts"]
    secs: list[Section] = []
    n = 0

    def sec(title: str, blocks: list[Block]):
        nonlocal n
        n += 1
        secs.append(Section(n, title, blocks))

    sec("Screening", [
        Block("table", header=["Item", "Value"], rows=[
            ["Alternative", alternative], ["Alternative id", run["scenario_id"]], ["Screened", when(run["generated_at"])],
            ["Engine", run["engine_version"]], ["Rules version", run["config_version"]], ["Report", REPORT_VERSION],
            ["Proposed objects screened", str(len(sm["proposed_checked"]))],
            ["Existing assets compared (within the clearance search distance)", f"{sm.get('existing_assets_read', 0):,}"]]),
        Block("para", text=run["banner"] + "."),
    ])
    sec("Summary", [
        Block("para", text=sm["headline"]),
        Block("table", header=["Status", "Count", "What it means"],
              rows=[[S.STATUS_LABEL[s], str(counts.get(s, 0)), S.STATUS_MEANING[s]] for s in S.STATUSES]),
        Block("table", header=["Proposed object", "Type", "Depth (crown to invert)", "Findings"],
              rows=[[p["name"], p.get("kind_label") or p.get("kind") or "",
                     f"{_m(p.get('crown_depth_m')) or 'unknown'} to {_m(p.get('invert_depth_m')) or 'unknown'}",
                     str(sum(1 for f in run["findings"] if f["proposed"]["id"] == p["id"]))] for p in sm["proposed_checked"]]),
    ])
    for status in ("potential_conflict", "requires_investigation", "verified"):
        fs = [f for f in run["findings"] if f["status"] == status]
        if not fs:
            continue
        blocks: list[Block] = [Block("note", text=S.STATUS_MEANING[status])]
        for i, f in enumerate(fs, 1):
            loc = f.get("location") or [None, None]
            head = f"{i}. {f['title']} — {CATEGORY.get(f['category'], f['category'])}"
            kn = key_numbers(f)
            blocks.append(Block("subhead", text=head + (f" · {kn}" if kn else "")
                                + (f" · at {loc[1]:.6f} N, {loc[0]:.6f} E" if loc[0] is not None else "")))
            blocks += _five(f)
        sec(f"{S.STATUS_LABEL[status]} ({len(fs)})", blocks)
    groups = gap_groups(run["findings"])
    if groups:
        blocks = [Block("note", text=S.STATUS_MEANING["insufficient_data"] + " Grouped by what is missing; every finding with its five parts "
                                     "is in the CSV export."),
                  Block("table", header=["What is missing", "How many"], rows=[[g["label"], count_text(g)] for g in groups])]
        for g in groups:
            f0 = g["findings"][0]
            blocks.append(Block("subhead", text=f"{g['label']} — {count_text(g)}"))
            blocks.append(Block("note", text=f"Checked: {f0['checked']} Not checked: {' '.join(f0['not_checked'])} "
                                             f"Next: {' → '.join(f0['next_steps'])}"))
            rows = []
            for f in g["findings"][:PDF_GAP_ROWS]:
                loc = f.get("location") or [None, None]
                rows.append([f["title"], key_numbers(f) or f["found"][0][:120], f"{loc[1]:.5f}, {loc[0]:.5f}" if loc[0] is not None else ""])
            blocks.append(Block("table", header=["Finding", "Key numbers", "Lat, lon"], rows=rows))
            if len(g["findings"]) > PDF_GAP_ROWS:
                blocks.append(Block("note", text=f"… and {len(g['findings']) - PDF_GAP_ROWS} more — see the CSV export."))
        sec(f"Insufficient data ({counts.get('insufficient_data', 0)})", blocks)
    ra = rules_applied(run)
    sec("Rules applied, with sources", [
        Block("note", text="Where two sources differ the stricter value is used and both are cited. Thresholds are widened by each "
                           "record's positional uncertainty (ASCE 38 quality level). Values live in backend/coordination/screening_config.py."),
        Block("table", header=["Rule", "Value", "Type", "Source", "Count"],
              rows=[[r["id"], f"{r['value_m']:.2f} m {DIM.get(r['dim'], r['dim'])}", RULE_TYPE.get(r["type"], r["type"]),
                     _src(r), str(r["findings"])] for r in ra]),
    ])
    sec("Data used", [Block("table", header=["Dataset", "Used", "Quality", "Datum / coverage"], rows=[
        [l["name"] + (f" · {l['records']:,} records" if isinstance(l.get("records"), int) else ""), "yes" if l.get("used") else "no",
         l.get("quality_level") or "", "; ".join(x for x in (l.get("datum"), l.get("coverage")) if x)] for l in run["layers"]])])
    sec("What was not checked", [Block("bullets", items=not_checked(run))])
    plan = investigation_plan(run)
    sec("Next-investigation plan (Indian order)", [
        Block("note", text="Owner as-builts → Call Before u Dig → GPR (QL-B) → trial pits (QL-A) → Maha-Metro NOC → boreholes → "
                           "specialist. Steps outside this ladder follow."),
        Block("table", header=["#", "Investigation", "Count", "For", "Statuses"],
              rows=[[str(d["order"]), d["step"], str(d["findings"]), ", ".join(d["objects"][:6]) + (f" +{len(d['objects']) - 6}" if len(d["objects"]) > 6 else ""),
                     ", ".join(d["statuses"])] for d in plan]),
    ])
    return DocModel(title="Underground screening report", subtitle=f"{alternative} · {when(run['generated_at'])}",
                    generated_at=(now or datetime.datetime.now(datetime.timezone.utc)).isoformat(), sections=secs,
                    header_text=run["banner"], disclaimer=run["disclaimer"],
                    template_version=REPORT_VERSION)


def render(m: DocModel, fmt: str) -> bytes:
    return docgen.render(m, fmt)


CSV_COLUMNS = ["finding_id", "status", "category", "title", "proposed_object", "proposed_id", "other_asset", "other_id", "other_dataset",
               "other_quality_level", "missing_data_group", "key_numbers", "plan_distance_m", "required_horizontal_m", "vertical_gap_m",
               "required_vertical_m", "vertical_checkable", "crosses_in_plan", "maha_metro_noc", "lat", "lon",
               "checked", "data_used", "found", "not_checked", "next_investigation", "rules", "verification"]


def to_csv(run: dict, alternative: str) -> bytes:
    """UTF-8 with BOM (Excel on Windows). '#' preamble lines carry the header; then one row per finding with its five parts
    (multi-item parts joined with ' | ')."""
    buf = io.StringIO()
    sm = run["summary"]
    pre = [("Underground screening report", ""), ("Alternative", f"{alternative} ({run['scenario_id']})"),
           ("Screened", when(run["generated_at"])), ("Engine", run["engine_version"]), ("Rules version", run["config_version"]),
           ("Banner", run["banner"]), ("Disclaimer", run["disclaimer"]),
           ("Summary", "; ".join(f"{S.STATUS_LABEL[s]} {sm['counts'].get(s, 0)}" for s in S.STATUSES)),
           ("Rules applied", "; ".join(f"{r['id']} {r['value_m']:.2f} m {DIM.get(r['dim'], r['dim'])} ({RULE_TYPE.get(r['type'], r['type'])}: "
                                       f"{_src(r)})" for r in rules_applied(run))),
           ("Not checked", " | ".join(not_checked(run))),
           ("Next-investigation plan", " | ".join(f"{d['order']}. {d['step']} ({d['findings']} findings)" for d in investigation_plan(run)))]
    w = csv.writer(buf, lineterminator="\r\n")
    for k, v in pre:
        w.writerow([f"# {k}", v])
    w.writerow([])
    w.writerow(CSV_COLUMNS)
    for f in run["findings"]:
        x = f.get("measurements") or {}
        o = f.get("other") or {}
        loc = f.get("location") or [None, None]
        v = f.get("verification")
        w.writerow([f["id"], f["status_label"], CATEGORY.get(f["category"], f["category"]), f["title"], f["proposed"]["name"], f["proposed"]["id"],
                    o.get("name", ""), o.get("id", ""), (o.get("dataset") or {}).get("name", ""), o.get("quality_level", ""),
                    (f.get("gap_group") or {}).get("label", ""), key_numbers(f),
                    _n(x.get("horizontal_m")), _n(x.get("required_horizontal_m")), _n(x.get("vertical_gap_m")), _n(x.get("required_vertical_m")),
                    _b(x.get("vertical_checkable")), _b(x.get("crossing")), _b(f.get("protection_zone")), loc[1], loc[0],
                    f["checked"], " | ".join(f"{d['dataset']} ({d['quality_level']})" for d in f.get("data_used") or []),
                    " | ".join(f["found"]), " | ".join(f["not_checked"]), " | ".join(f["next_steps"]),
                    " | ".join(f"{r['id']} {r['value_m']:.2f} m {r['dim']} ({r['source']})" for r in f.get("rules") or []),
                    f"{v['verified_by']} ({v['method']}){' — re-verify' if v.get('stale') else ''}" if v else ""])
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


def _src(r: dict) -> str:
    clause = (r.get("clause") or "").strip()
    return f"{r['source']} {clause}".strip() if clause not in ("", "—", "-") else r["source"]


def _n(v) -> str:
    return "" if v is None or isinstance(v, bool) else f"{v:g}" if isinstance(v, (int, float)) else str(v)


def _b(v) -> str:
    return "" if v is None else ("yes" if v else "no")


def report_text(m: DocModel) -> str:
    """All text of a document model (for wording tests)."""
    parts = [m.title, m.subtitle, m.header_text, m.disclaimer]
    for s in m.sections:
        parts.append(s.title)
        for b in s.blocks:
            parts += [b.text, *b.items, *b.header, *[str(c) for r in b.rows for c in r]]
    return "\n".join(parts)
