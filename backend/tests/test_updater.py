"""
Data-freshness service (backend/updater; docs/urbanos/DATA_FRESHNESS_SERVICE.md). No live network: every HTTP request
is answered from tests/fixtures/updater (trimmed copies of real pages and robots.txt files, see routes.json).
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

import pytest
from sqlalchemy import text

FIX = Path(__file__).parent / "fixtures" / "updater"
ROUTES = json.loads((FIX / "routes.json").read_text(encoding="utf-8"))["routes"]
TODAY = dt.date(2026, 11, 21)

from main import app  # noqa: E402,F401  (creates every table, fu_* included)
from database.connection import SessionLocal  # noqa: E402
from updater import audit, config as cfgmod, facts as facts_mod, fetch, pipeline, review, seed  # noqa: E402
from updater.extract import extract_page, label  # noqa: E402
from updater.models import FuProposalEntity  # noqa: E402
from updater.proposals import agree, corroboration, evaluate_all  # noqa: E402
from updater.sources import google_cse  # noqa: E402

TEST_SOURCES = {"punemetrorail_line_1b", "ht_pune_rss", "ie_pune_rss", "toi_pune_rss", "punekarnews_rss", "punemirror_rss",
                "metrorailguy_pune_rss", "pmrda_feed"}


class FixtureTransport:
    def __init__(self):
        self.calls: list[str] = []

    def __call__(self, url, timeout, headers):
        self.calls.append(url)
        if url.endswith("/robots.txt") and url not in ROUTES:
            return 200, {"content-type": "text/plain"}, (FIX / "robots_allow_all.txt").read_bytes(), url
        r = ROUTES.get(url)
        if r is None:
            return 404, {"content-type": "text/html"}, b"not found", url
        name, status, ctype = r
        body = (FIX / name).read_bytes() if name else b""
        return status, {"content-type": ctype, "etag": f'"{name}"'}, body, url


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("URBANOS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("UPDATER_CACHE_DIR", str(tmp_path / "cache"))
    t = FixtureTransport()
    monkeypatch.setattr(fetch, "TRANSPORT", t)
    monkeypatch.setattr("updater.fetch.non_public_reason", lambda url: None)
    with SessionLocal() as db:   # clean slate: raw SQL bypasses the ORM append-only / immutability guards on purpose
        for tbl in ("fu_claims", "fu_documents", "fu_proposals", "fu_runs", "fu_audit"):
            db.execute(text(f"DELETE FROM {tbl}"))
        ids = [r[0] for r in db.execute(text("SELECT id FROM ds_dataset_versions WHERE dataset_id = :d"), {"d": facts_mod.DATASET_ID})]
        for vid in ids:
            db.execute(text("DELETE FROM ds_files WHERE version_id = :v"), {"v": vid})
            db.execute(text("DELETE FROM ds_processing_runs WHERE version_id = :v"), {"v": vid})
            db.execute(text("DELETE FROM ds_quality_checks WHERE version_id = :v"), {"v": vid})
        db.execute(text("DELETE FROM ds_dataset_versions WHERE dataset_id = :d"), {"d": facts_mod.DATASET_ID})
        db.commit()
    yield t


def fetcher():
    return fetch.PoliteFetcher(sleep=lambda s: None, min_delay=2.0)


def do_run(db, dry=False):
    cfg = cfgmod.load()
    return pipeline.run(db, cfg, dry_run=dry, sources=TEST_SOURCES, fetcher=fetcher(), today=TODAY, log=lambda *a: None)


def props(db, attr, project="pune_metro_line_1b_swargate_katraj"):
    return {label(p.attribute, p.value_num, p.value_text, p.qualifier): p for p in db.query(FuProposalEntity).filter_by(project_id=project, attribute=attr)}


# ── fetching rules ────────────────────────────────────────────────────────────────────────────────────────────────────
def test_robots_google_news_rss_is_refused(env):
    f = fetcher()
    with pytest.raises(fetch.Refused, match="robots.txt disallows"):
        f.get("https://news.google.com/rss/search?q=Swargate+Katraj+metro&hl=en-IN&gl=IN&ceid=IN:en")
    with pytest.raises(fetch.Refused):
        f.get("https://www.freepressjournal.in/pune/some-story/feed")
    assert not any("news.google.com/rss" in c for c in env.calls)   # only robots.txt was requested


def test_fetcher_caches_and_rate_limits(env):
    slept = []
    clock = iter(range(0, 1000)).__next__
    f = fetch.PoliteFetcher(sleep=slept.append, clock=lambda: float(clock()), min_delay=2.0)
    a = f.get("https://punemirror.com/feed/")
    b = f.get("https://punemirror.com/feed/")
    assert a.status == 200 and b.body == a.body
    assert any(s > 0 for s in slept)                                # second request to the host waited
    assert len(os.listdir(os.environ["UPDATER_CACHE_DIR"])) == 2    # body + meta


def test_host_refusal_not_retried(env, monkeypatch):
    def deny(url, timeout, headers):
        if url.endswith("robots.txt"):
            return 200, {}, b"User-agent: *\nDisallow:\n", url
        return 403, {}, b"denied", url
    monkeypatch.setattr(fetch, "TRANSPORT", deny)
    f = fetcher()
    assert f.get("https://www.punekarnews.in/a").status == 403
    with pytest.raises(fetch.Refused, match="refused"):
        f.get("https://www.punekarnews.in/b")


def test_google_cse_optional_and_ending():
    cfg = cfgmod.load()
    src = next(s for s in cfg["sources"] if s["id"] == "google_cse")
    assert src["enabled"] is False
    assert "not set" in google_cse(src, cfg["projects"], None, today=TODAY).errors[0]
    assert "discontinued" in google_cse(src, cfg["projects"], None, today=dt.date(2027, 1, 1)).errors[0]
    assert not any(s.get("url", "").startswith("https://news.google.com") for s in cfg["sources"])


# ── extraction (golden: real published sentences) ─────────────────────────────────────────────────────────────────────
def test_golden_seed_quotes_no_wrong_values():
    res = seed.run_golden(seed.load_seed(), cfgmod.load())
    assert res["wrong_value"] == 0, [d for d in res["details"] if d["result"] == "wrong_value"]
    assert res["reproduced"] >= 35, res["reproduced"]
    ok = {(d["project_id"], d["attribute"], d["quote"][:40]) for d in res["details"] if d["result"] == "reproduced"}
    assert ("pune_metro_line_1b_swargate_katraj", "tunnel_depth_m", "The TBMs will operate at a depth of arou") in ok
    assert ("pune_metro_line_1b_swargate_katraj", "completion_target", "MahaMetro has set a target of December 2") in ok


@pytest.mark.parametrize("sentence,attr,expected", [
    ("Swargate-Katraj tunnel will run about 28 m below ground, with boring starting in January.", "tunnel_depth_m", "~28 m"),
    ("Swargate-Katraj tunnel will run about 28 m below ground, with boring starting in January.", "tunnelling_start", "January 2027"),
    ("The Swargate-Katraj extension will span 5.46 km and will include five underground stations.", "station_count", "5 stations"),
    ("The estimated cost of the Swargate-Katraj project is Rs.2954.53 crore.", "cost_inr_crore", "₹2,954.53 crore"),
    ("The Swargate-Katraj original deadline of March 2026 has been extended to December 2029.", "completion_target", "December 2029"),
])
def test_extractor_patterns(sentence, attr, expected):
    cl = [c for c in extract_page([sentence], "", cfgmod.load()["projects"], dt.date(2026, 11, 4)) if c.attribute == attr]
    assert [label(c.attribute, c.value_num, c.value_text, c.qualifier) for c in cl] == [expected]
    assert cl[0].quote == sentence


@pytest.mark.parametrize("sentence", [
    "The Maharashtra government has approved ₹180 crore in fresh funding, including ₹100 crore in equity for the Swargate-Katraj corridor.",
    "A Letter of Acceptance worth Rs 1,364.59 crore has been awarded for the Swargate-Katraj stage 1.",
    "Swargate-Katraj: 144 piles, ~6 mtrs deep are done for the underground station.",
    "Two TBMs will operate from Swargate on the Swargate-Katraj line.",
])
def test_extractor_refuses_lookalikes(sentence):
    cl = extract_page([sentence], "", cfgmod.load()["projects"], dt.date(2026, 11, 4))
    assert [c for c in cl if c.attribute in ("cost_inr_crore", "tunnel_depth_m", "tbm_count")] == []


def test_multi_project_sentence_goes_to_nearest_alias():
    s = "The Vanaz-Chandani Chowk extension is 1.12 km long while the Ramwadi-Wagholi extension is 11.63 km long."
    cl = extract_page([s], "", cfgmod.load()["projects"], None)
    assert {(c.project_id, c.value_num) for c in cl if c.attribute == "length_km"} == {
        ("pune_metro_line_2a_2b_chandani_chowk_wagholi", 1.12), ("pune_metro_line_2a_2b_chandani_chowk_wagholi", 11.63)}


# ── corroboration rules ───────────────────────────────────────────────────────────────────────────────────────────────
class C:
    def __init__(self, q="a", llm=False, cites=False):
        self.quote_sha256, self.extractor, self.cites_other = q, ("llm:x" if llm else "pattern:x@1"), cites


class D:
    def __init__(self, domain, tier, pub="2026-11-01"):
        self.domain, self.tier, self.published_at = domain, tier, pub


def test_corroboration_rules():
    t = TODAY
    assert corroboration([(C("q1"), D("hindustantimes.com", 2)), (C("q2"), D("punemirror.com", 2))], t, 400)["corroborated"]
    syn = corroboration([(C("same"), D("hindustantimes.com", 2)), (C("same"), D("punemirror.com", 2))], t, 400)
    assert syn["independent_press"] == 1 and not syn["corroborated"]          # syndicated copy counts once
    assert not corroboration([(C("q1"), D("hindustantimes.com", 2)), (C("q2"), D("hindustantimes.com", 2))], t, 400)["corroborated"]
    assert not corroboration([(C("q1"), D("hindustantimes.com", 2)), (C("q2", cites=True), D("punemirror.com", 2))], t, 400)["corroborated"]
    assert not corroboration([(C("q1"), D("hindustantimes.com", 2)), (C("q2"), D("punemirror.com", 2, None))], t, 400)["corroborated"]
    assert not corroboration([(C("q1"), D("hindustantimes.com", 2)), (C("q2"), D("punemirror.com", 2, "2024-01-01"))], t, 400)["corroborated"]
    assert corroboration([(C("q1"), D("punemetrorail.org", 1))], t, 400)["corroborated"]                  # 1 official
    assert not corroboration([(C("q1", llm=True), D("punemetrorail.org", 1))], t, 400)["corroborated"]    # LLM: needs 2
    assert not corroboration([(C("q1"), D("primetime24.com", 3)), (C("q2"), D("magicbricks.com", 3))], t, 400)["corroborated"]


def test_agreement_precision_and_hedges():
    assert agree("length_km", 5.463, None, "exact", 5.46, None, "exact")
    assert not agree("cost_inr_crore", 2954.53, None, "exact", 2954.75, None, "exact")
    assert not agree("cost_inr_crore", 2945.0, None, "exact", 2954.75, None, "exact")
    assert agree("tunnel_depth_m", 28.0, None, "approx", 29.0, None, "exact")
    assert not agree("tunnel_depth_m", 28.0, None, "exact", 30.0, None, "exact")
    assert not agree("completion_target", None, "2029", "exact", None, "2029-12", "exact")


# ── the pipeline on recorded pages ────────────────────────────────────────────────────────────────────────────────────
def test_run_key_cases(env):
    with SessionLocal() as db:
        rep = do_run(db)
        assert rep["stats"]["pages_read"] >= 7
        assert any("HTTP 503" in e["error"] for e in rep["errors"])         # TOI feed down: recorded, run continues
        depth = props(db, "tunnel_depth_m")["~28 m"]
        assert depth.confidence == "corroborated" and depth.official_sources == 0 and depth.independent_sources == 2
        start = props(db, "tunnelling_start")
        assert start["January 2027"].confidence == "corroborated" and start["January 2027"].verdict == "corroborated"
        assert start["September 2026"].confidence == "slipped"
        assert any(f["code"] == "slipped" for f in json.loads(start["September 2026"].flags_json))
        assert not any(c["kind"] == "source_disagreement" for c in json.loads(start["January 2027"].conflicts_json))
        comp = props(db, "completion_target")
        assert {"February 2029", "December 2029", "December 2030"} <= set(comp)
        assert all(p.confidence == "conflicting" for k, p in comp.items() if k in ("December 2029", "December 2030"))
        st = props(db, "station_count")
        assert st["3 stations"].confidence == "conflicting" and st["5 stations"].confidence == "conflicting"
        assert any(f["code"] == "official_page_undated" for f in json.loads(st["5 stations"].flags_json))
        assert props(db, "length_km")["5.46 km"].confidence == "official"
        # nothing reached the dataset
        assert facts_mod.read_active(db)["facts"] == []
        assert audit.verify_chain(db)["ok"]


def test_dry_run_writes_nothing(env):
    with SessionLocal() as db:
        rep = do_run(db, dry=True)
        assert rep["pending"]
    with SessionLocal() as db:
        assert db.query(FuProposalEntity).count() == 0
        assert db.execute(text("SELECT COUNT(*) FROM fu_documents")).scalar() == 0


def test_second_run_is_idempotent(env):
    with SessionLocal() as db:
        do_run(db)
        n = db.query(FuProposalEntity).count()
        rep = do_run(db)
        assert db.query(FuProposalEntity).count() == n and rep["proposals_created"] == []


# ── review: approve → version → rollback; nothing applied without approval ────────────────────────────────────────────
def test_approve_apply_rollback(env):
    cfg = cfgmod.load()
    with SessionLocal() as db:
        do_run(db)
        depth = props(db, "tunnel_depth_m")["~28 m"]
        with pytest.raises(review.ReviewError, match="nothing to apply"):
            review.apply_approved(db, "Asha", cfg=cfg)
        with pytest.raises(review.ReviewError, match="reviewer"):
            review.approve(db, depth.id, "  ")
        review.approve(db, depth.id, "Asha (planner)")
        assert facts_mod.read_active(db)["facts"] == []                 # approve ≠ apply
        v2 = review.apply_approved(db, "Asha (planner)", "depth from HT + Pune Mirror", cfg=cfg)
        db.commit()
        act = facts_mod.read_active(db)
        assert act["version_label"] == "v2" and act["sha256_ok"]
        f = act["facts"][0]
        assert (f["attribute"], f["value_num"], f["confidence"], f["approved_by"]) == ("tunnel_depth_m", 28.0, "corroborated", "Asha (planner)")
        assert {e["publisher"] for e in f["evidence"]} >= {"Hindustan Times", "Pune Times Mirror"}
        assert all(e["quote"] and e["url"] and e["sha256"] for e in f["evidence"])
        assert db.get(FuProposalEntity, depth.id).status == "applied"
        vs = review.versions(db)
        v1 = next(v for v in vs if v["version_label"] == "v1")
        assert v1["review_status"] == "superseded" and v1["facts"] == 0
        # rollback to the empty baseline
        review.rollback(db, v1["id"], "Ravi (GIS)", "test rollback")
        db.commit()
        assert facts_mod.read_active(db)["facts"] == []
        assert db.get(FuProposalEntity, depth.id).status == "rolled_back"
        # and forward again
        review.rollback(db, v2.id, "Ravi (GIS)", "restore")
        db.commit()
        assert facts_mod.read_active(db)["facts"][0]["value_num"] == 28.0
        actions = [e["action"] for e in audit.entries(db)]
        assert {"run", "approve", "apply", "rollback"} <= set(actions)
        assert audit.verify_chain(db)["ok"]


def test_conflicting_needs_a_note_and_supersedes_competitors(env):
    with SessionLocal() as db:
        do_run(db)
        comp = props(db, "completion_target")
        with pytest.raises(review.ReviewError, match="needs a note"):
            review.approve(db, comp["December 2030"].id, "Asha")
        review.approve(db, comp["December 2030"].id, "Asha", "MahaMetro target stated Sep 2026; PIB date is 2024")
        assert db.get(FuProposalEntity, comp["December 2029"].id).status == "superseded"


def test_tampered_facts_file_is_refused(env):
    cfg = cfgmod.load()
    with SessionLocal() as db:
        do_run(db)
        review.approve(db, props(db, "tunnel_depth_m")["~28 m"].id, "Asha")
        v = review.apply_approved(db, "Asha", cfg=cfg)
        db.commit()
        p = Path(os.environ["URBANOS_DATA_DIR"]) / "derived" / facts_mod.DATASET_ID / v.version_label / "facts.json"
        p.write_text(p.read_text(encoding="utf-8").replace("28.0", "18.0"), encoding="utf-8")
        act = facts_mod.read_active(db)
        assert act["facts"] == [] and act["sha256_ok"] is False and "refused" in act["error"]


def test_audit_chain_detects_edit(env):
    with SessionLocal() as db:
        do_run(db)
        db.execute(text("UPDATE fu_audit SET actor = 'mallory' WHERE seq = (SELECT MIN(seq) FROM fu_audit)"))
        assert audit.verify_chain(db)["ok"] is False
        db.rollback()


def test_seed_baseline_is_compared(env):
    cfg = cfgmod.load()
    facts, counts = seed.baseline_facts(seed.load_seed(), cfg)
    assert counts["mapped"] >= 40 and all(f["evidence"] for f in facts)
    with SessionLocal() as db:
        facts_mod.register_version(db, facts, reviewer="coordinator", note="seed", proposal_ids=[], evidence=[], activate=True)
        db.commit()
        do_run(db)
        comp = props(db, "completion_target")
        cv = json.loads(comp["December 2029"].conflicts_json)
        assert any(c["kind"] == "dataset_value" and c["value"] == "December 2030" for c in cv)
        assert not any(c["kind"] == "dataset_value" for c in json.loads(props(db, "tunnel_depth_m")["~28 m"].conflicts_json))


# ── API ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_api_review_flow(env, client):
    with SessionLocal() as db:
        do_run(db)
    rows = client.get("/api/updater/proposals?status=pending").json()
    depth = next(p for p in rows if p["attribute"] == "tunnel_depth_m" and p["label"] == "~28 m")
    assert depth["evidence"][0]["quote"] and depth["confidence"] == "corroborated"
    assert client.post(f"/api/updater/proposals/{depth['id']}/approve", json={"reviewer": ""}).status_code == 400
    assert client.post(f"/api/updater/proposals/{depth['id']}/approve", json={"reviewer": "Asha"}).json()["status"] == "approved"
    assert client.get("/api/updater/facts").json()["facts"] == []
    r = client.post("/api/updater/apply", json={"reviewer": "Asha"})
    assert r.status_code == 200 and r.json()["review_status"] == "active"
    fx = client.get("/api/updater/facts?project=pune_metro_line_1b_swargate_katraj").json()
    assert fx["facts"][0]["label"] == "~28 m" and fx["sha256_ok"]
    vs = client.get("/api/updater/versions").json()
    v1 = next(v for v in vs if v["version_label"] == "v1")
    assert client.post("/api/updater/rollback", json={"version_id": v1["id"], "reviewer": "Ravi"}).status_code == 200
    assert client.get("/api/updater/facts").json()["facts"] == []
    st = client.get("/api/updater/status").json()
    assert st["audit"]["ok"] and st["facts"]["version_label"] == "v1"
    ds = client.get(f"/api/datasets/{facts_mod.DATASET_ID}").json()
    assert ds["theme"] == "project_facts" and len(ds["versions"]) == 2


def test_four_eyes_apply(env):
    cfg = cfgmod.load()
    with SessionLocal() as db:
        do_run(db)
        review.approve(db, props(db, "tunnel_depth_m")["~28 m"].id, "Asha")
        v = review.apply_approved(db, "Asha", activate=False, cfg=cfg)
        db.commit()
        assert v.review_status == "pending_review" and facts_mod.read_active(db)["facts"] == []
        review.activate_pending(db, v.id, "Ravi")
        db.commit()
        assert facts_mod.read_active(db)["facts"][0]["value_num"] == 28.0
        assert db.get(FuProposalEntity, props(db, "tunnel_depth_m")["~28 m"].id).status == "applied"


def test_llm_extractor_guards(monkeypatch):
    from updater import llm
    projects = cfgmod.load()["projects"]
    text_ = "The Swargate-Katraj tunnel will be about 28 metres deep. Other text."
    raw = [{"project_id": "pune_metro_line_1b_swargate_katraj", "attribute": "tunnel_depth_m", "value": 28,
            "quote": "The Swargate-Katraj tunnel will be about 28 metres deep."},
           {"project_id": "pune_metro_line_1b_swargate_katraj", "attribute": "tunnel_depth_m", "value": 30,
            "quote": "The Swargate-Katraj tunnel will be about 28 metres deep."},            # value not in quote
           {"project_id": "pune_metro_line_1b_swargate_katraj", "attribute": "tunnel_depth_m", "value": 28,
            "quote": "The tunnel is 28 metres deep."}]                                        # not verbatim
    out = llm.validate(raw, text_, projects, "m")
    assert len(out) == 1 and out[0].extractor == "llm:m"
    monkeypatch.delenv("UPDATER_LLM_URL", raising=False)
    assert llm.enabled() is False and llm.extract(text_, "", projects, None) == []


def test_watchlist_validates():
    cfg = cfgmod.load()
    assert len(cfg["projects"]) == 22
    seed_ids = {p["project_id"] for p in seed.load_seed()["projects"]}
    assert {p["seed_id"] for p in cfg["projects"]} == seed_ids
    with pytest.raises(cfgmod.ConfigError):
        cfgmod.validate({"projects": [{"id": "Bad-Id", "aliases": ["x"]}], "sources": []})
