"""Underground screening report (PDF / DOCX / CSV). SYNTHETIC objects; see test_underground_screening.py for the engine."""
import csv
import io
import json

from coordination import screening_report as R
from tests.test_underground_screening import FORBIDDEN, LON, LAT, _line, _screen, align, util  # noqa: F401


def _objs():
    return [align("T", _line(-200, 0, 200, 0), "bored_tunnel", [12, 12], 6.0),
            util("W", _line(0, -40, 0, 40), "water", 13.0, 300),
            util("B1", _line(-100, -40, -100, 40), "sewage", 3.0, 300, sid="base"),
            util("B2", _line(100, -40, 100, 40), "sewage", 3.0, 300, sid="base")]


def _clean(txt: str) -> str:
    return txt.lower().replace("not an engineering assessment or approval", "")


def test_report_model_has_every_part_and_honest_wording(client):
    run = _screen(client, _objs())
    m = R.build_model(run, "SYNTHETIC alternative")
    titles = [s.title for s in m.sections]
    assert titles[0] == "Screening" and titles[1] == "Summary"
    assert any(t.startswith("Potential conflict") for t in titles) and any(t.startswith("Insufficient data") for t in titles)
    assert titles[-4:] == ["Rules applied, with sources", "Data used", "What was not checked", "Next-investigation plan (Indian order)"]
    txt = R.report_text(m)
    assert run["banner"] in txt and run["engine_version"] in txt and "SYNTHETIC alternative" in txt and "IST" in txt
    for part in ("Checked:", "Data used:", "Found:", "Not checked:", "Next investigation 1:"):
        assert part in txt, part
    assert "vertical clearance not checkable" in txt                                  # Insufficient data grouped per reason
    for w in FORBIDDEN:
        assert w not in _clean(txt), w


def test_investigation_plan_follows_indian_order(client):
    run = _screen(client, _objs())
    plan = R.investigation_plan(run)
    ladder = [k for k, _ in run["config"]["ladder"]]
    ranks = [ladder.index(d["key"]) if d["key"] in ladder else len(ladder) for d in plan]
    assert ranks == sorted(ranks) and plan[0]["key"] == "as_builts"
    assert all(d["findings"] > 0 and d["objects"] for d in plan)


def test_rules_applied_cite_sources(client):
    run = _screen(client, _objs())
    ra = R.rules_applied(run)
    assert ra and all(r["source"] and r["findings"] > 0 for r in ra)


def test_report_endpoint_pdf_docx_csv(client):
    body = {"scenario_id": "alt", "objects": _objs()}
    pdf = client.post("/api/coordination/underground/screen/report?format=pdf", json=body)
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-" and pdf.headers["content-type"] == "application/pdf"
    assert "underground-screening-" in pdf.headers["content-disposition"] and int(pdf.headers["x-findings"]) > 0
    docx = client.post("/api/coordination/underground/screen/report?format=docx", json=body)
    assert docx.status_code == 200 and docx.content[:2] == b"PK"
    c = client.post("/api/coordination/underground/screen/report?format=csv", json=body)
    assert c.status_code == 200 and c.headers["content-type"].startswith("text/csv")
    text = c.content.decode("utf-8-sig")
    pre = [ln for ln in text.splitlines() if ln.startswith("# ")]
    assert any(ln.startswith("# Banner,Automated screening") for ln in pre) and any(ln.startswith("# Engine,") for ln in pre)
    assert any(ln.startswith("# Next-investigation plan,") for ln in pre)
    rows = list(csv.DictReader(io.StringIO("\n".join(ln for ln in text.splitlines() if ln and not ln.startswith("# ")))))
    assert len(rows) == int(c.headers["x-findings"])
    for r in rows:
        assert r["checked"] and r["data_used"] and r["found"] and r["next_investigation"] and r["status"]
    assert any(r["missing_data_group"] for r in rows if r["status"] == "Insufficient data")
    for w in FORBIDDEN:
        assert w not in _clean(text), w
    bad = client.post("/api/coordination/underground/screen/report?format=xls", json=body)
    assert bad.status_code == 422


def test_report_file_name_in_ist():
    """File names carry the planners' clock (IST), not the server's UTC: 14:25 UTC is 19:55 IST (same day), and a late
    UTC evening rolls over to the next IST date."""
    from api.coordination_router import report_stamp
    assert report_stamp("2026-11-21T14:25:00Z") == "2026-11-21-1955IST"
    assert report_stamp("2026-11-21T20:00:00Z") == "2026-11-22-0130IST"


def test_report_endpoint_file_name_is_ist(client):
    import re
    r = client.post("/api/coordination/underground/screen/report?format=docx", json={"scenario_id": "alt", "objects": _objs()})
    assert r.status_code == 200 and r.content[:2] == b"PK"
    assert re.search(r'filename="underground-screening-[^"]+-\d{4}-\d{2}-\d{2}-\d{4}IST\.docx"', r.headers["content-disposition"])
