"""
Data-freshness service (backend/updater; docs/urbanos/DATA_FRESHNESS_SERVICE.md). No live network: every HTTP request
is answered from tests/fixtures/updater (trimmed copies of real pages and robots.txt files, see routes.json).

Official-only rule (user, 2026-11-21): only government / agency pages may create a proposal or a value in the dataset.
The newspaper fixtures (HT, Pune Mirror, Punekar News, Prime Time 24, feeds) are kept ONLY to prove that they are
refused at every gate.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

FIX = Path(__file__).parent / "fixtures" / "updater"
ROUTES = json.loads((FIX / "routes.json").read_text(encoding="utf-8"))["routes"]
TODAY = dt.date(2026, 11, 21)

from main import app  # noqa: E402,F401  (creates every table, fu_* included)
from database.connection import SessionLocal  # noqa: E402
from updater import audit, config as cfgmod, facts as facts_mod, fetch, migrate, official, pipeline, review, seed  # noqa: E402
from updater.extract import extract_page, label  # noqa: E402
from updater.models import FuClaimEntity, FuDocumentEntity, FuProposalEntity  # noqa: E402
from updater.proposals import agree, assign, corroboration, evaluate_all  # noqa: E402
from updater.sources import Candidate  # noqa: E402
from updater.text import quote_hash  # noqa: E402

P1B = "pune_metro_line_1b_swargate_katraj"
PIB = "https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2046088"
LINE_B = "https://www.punemetrorail.org/Line_b.aspx"
NEWS_PAGES = [u for u in ROUTES if any(h in u for h in ("hindustantimes.com/cities", "punemirror.com/city", "punekarnews.in/pune",
                                                        "primetime24.com"))]
NEWS_FEEDS = {"ht": "https://www.hindustantimes.com/feeds/rss/cities/pune-news/rssfeed.xml",
              "pm": "https://punemirror.com/feed/", "pk": "https://www.punekarnews.in/feed/",
              "ie": "https://indianexpress.com/section/cities/pune/feed/",
              "mrg": "https://themetrorailguy.com/category/pune-metro/feed/"}


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


def do_run(db, dry=False, cfg=None):
    cfg = cfg or cfgmod.load()
    return pipeline.run(db, cfg, dry_run=dry, fetcher=fetcher(), today=TODAY, log=lambda *a: None)


def add_pib(db):
    return pipeline.add_evidence(db, cfgmod.load(), PIB, "Asha", fetcher=fetcher())


def props(db, attr, project=P1B):
    return {label(p.attribute, p.value_num, p.value_text, p.qualifier): p for p in db.query(FuProposalEntity).filter_by(project_id=project, attribute=attr)}


def all_evidence_urls(db):
    return [d.final_url or d.url for d in db.query(FuDocumentEntity)]


def legacy_news(db, url="https://www.hindustantimes.com/cities/pune-news/four-tbms.html", value=28.0, status="pending"):
    """A news page, claim and proposal as a database written BEFORE the official-only rule holds them (raw rows)."""
    d = FuDocumentEntity(id=f"fud_{uuid.uuid4().hex[:8]}", url=url, final_url=url, domain="hindustantimes.com",
                         publisher="Hindustan Times", tier=2, title="Four TBMs", published_at="2026-08-21",
                         published_from="meta", sha256="ab", text_sha256="cd")
    q = "The TBMs will operate at a depth of around 28 metres below ground level."
    p = FuProposalEntity(id=f"fup_{uuid.uuid4().hex[:8]}", project_id=P1B, attribute="tunnel_depth_m", value_key="28",
                         value_num=value, unit="m", qualifier="approx", status=status, verdict="corroborated",
                         confidence="corroborated", independent_sources=2)
    c = FuClaimEntity(id=f"fuc_{uuid.uuid4().hex[:8]}", document_id=d.id, project_id=P1B, attribute="tunnel_depth_m",
                      value_num=value, unit="m", qualifier="approx", quote=q, quote_sha256=quote_hash(q),
                      extractor="pattern:tunnel_depth_m@1", proposal_id=p.id)
    db.add_all([d, p, c])
    db.flush()
    return d, c, p


# ── the allow-list (code, not config) ─────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("url,domain", [
    ("https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2046088", "pib.gov.in"),
    ("https://www.pib.gov.in/x", "pib.gov.in"),
    ("https://www.punemetrorail.org/Line_b.aspx", "punemetrorail.org"),
    ("https://punemetrorail.org/download/PR.pdf", "punemetrorail.org"),
    ("https://www.mahametro.org/", "mahametro.org"),
    ("https://sansad.in/getFile/lsapps/loksabhaquestions/annex/188/AU1943.pdf", "sansad.in"),
    ("https://mohua.gov.in/upload/x.pdf", "mohua.gov.in"),
    ("https://www.pmrda.gov.in/feed/", "pmrda.gov.in"),
    ("https://www.pmc.gov.in/en/b/parmm-project", "pmc.gov.in"),
    ("https://msrdc.in/1218/About-us", "msrdc.in"),
    ("https://nhai.gov.in/", "nhai.gov.in"),
    ("https://morth.nic.in/", "morth.nic.in"),
    ("https://rajyasabha.nic.in/", "rajyasabha.nic.in"),
    ("https://egazette.gov.in/x", "egazette.gov.in"),
    ("https://greentribunal.gov.in/x", "greentribunal.gov.in"),
    ("https://cag.gov.in/x", "cag.gov.in"),
    ("http://www.maharashtra.gov.in/", "maharashtra.gov.in"),
    ("https://urban.maharashtra.gov.in/x", "maharashtra.gov.in"),
    ("https://www.pmindia.gov.in/en/news_updates/x/", "pmindia.gov.in"),
])
def test_official_domains_allowed(url, domain):
    assert official.official_domain(url) == domain
    assert official.is_official_url(url)


@pytest.mark.parametrize("url", [
    "https://www.hindustantimes.com/cities/pune-news/x.html", "https://indianexpress.com/section/cities/pune/feed/",
    "https://timesofindia.indiatimes.com/rssfeeds/-2128821991.cms", "https://punemirror.com/feed/",
    "https://www.punekarnews.in/feed/", "https://themetrorailguy.com/category/pune-metro/feed/",
    "https://primetime24.com/en/e/pune/story/x/", "https://press.siemens.com/global/en/pressrelease/x",
    "https://news.google.com/rss/search?q=x", "https://api.gdeltproject.org/api/v2/doc/doc",
    # look-alikes and tricks
    "https://pib.gov.in.evil.com/x", "https://gov.in.example.com/", "https://notpunemetrorail.org/",
    "https://punemetrorail.org.example.com/", "https://evilgov.in/", "https://pib.gov.in@evil.com/x",
    "ftp://pib.gov.in/x", "file:///etc/passwd", "https://10.0.0.1/", "https://xn--pb-gov-in.com/", "", None,
    "https://gov.in/", "https://nic.in/",
])
def test_everything_else_refused(url):
    assert not official.is_official_url(url)
    with pytest.raises(official.NotOfficialSource):
        official.require_official(url or "")


def test_watchlist_cannot_add_news(monkeypatch):
    cfg = cfgmod.load()
    assert all(official.is_official_url(s["url"]) for s in cfg["sources"])
    assert {s["kind"] for s in cfg["sources"]} <= {"official_page", "rss"}
    names = {s.get("publisher", "") for s in cfg["sources"]}
    for bad in ("Hindustan Times", "The Indian Express", "The Times of India", "Pune Times Mirror", "Punekar News",
                "The Metro Rail Guy", "Prime Time 24"):
        assert bad not in names
    bad = dict(cfg)
    bad["sources"] = cfg["sources"] + [{"id": "ht", "kind": "rss", "url": NEWS_FEEDS["ht"], "publisher": "HT"}]
    with pytest.raises(cfgmod.ConfigError, match="not an official source"):
        cfgmod.validate(bad)
    with pytest.raises(cfgmod.ConfigError, match="kind"):
        cfgmod.validate({**cfg, "sources": [{"id": "g", "kind": "gdelt", "url": "https://api.gdeltproject.org/api/v2/doc/doc"}]})
    with pytest.raises(cfgmod.ConfigError, match="tier"):
        cfgmod.validate({**cfg, "sources": [{"id": "x", "kind": "official_page", "url": LINE_B, "tier": 2}]})
    with pytest.raises(cfgmod.ConfigError, match="not an official domain"):
        cfgmod.validate({**cfg, "publishers": {"hindustantimes.com": {"name": "HT"}}})
    # the publishers list cannot raise a tier any more: tier is decided by code
    from updater.text import publisher_for
    assert publisher_for("https://www.hindustantimes.com/a", {"hindustantimes.com": {"tier": 1, "name": "HT"}})[1] == 3


def test_ts_mirror_lists_the_same_agency_domains():
    """frontend/src/lib/officialSources.ts mirrors the rule for the UI; it must name the same domains and zones."""
    ts = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "officialSources.ts").read_text(encoding="utf-8")
    for d in list(official.AGENCY_DOMAINS) + list(official.GOVERNMENT_ZONES):
        assert f"'{d}'" in ts, d


# ── fetching rules ────────────────────────────────────────────────────────────────────────────────────────────────────
def test_robots_google_news_rss_is_refused(env):
    f = fetcher()
    with pytest.raises(fetch.Refused, match="robots.txt disallows"):
        f.get("https://news.google.com/rss/search?q=Swargate+Katraj+metro&hl=en-IN&gl=IN&ceid=IN:en")
    assert not any("news.google.com/rss" in c for c in env.calls)   # only robots.txt was requested


def test_fetcher_caches_and_rate_limits(env):
    slept = []
    clock = iter(range(0, 1000)).__next__
    f = fetch.PoliteFetcher(sleep=slept.append, clock=lambda: float(clock()), min_delay=2.0)
    a = f.get(LINE_B)
    b = f.get(LINE_B)
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
    assert f.get("https://www.pmc.gov.in/a").status == 403
    with pytest.raises(fetch.Refused, match="refused"):
        f.get("https://www.pmc.gov.in/b")


# ── extraction (golden: real published sentences from official sources) ──────────────────────────────────────────────
def test_golden_seed_quotes_no_wrong_values():
    res = seed.run_golden(seed.load_seed(), cfgmod.load())
    assert res["wrong_value"] == 0, [d for d in res["details"] if d["result"] == "wrong_value"]
    assert res["cases"] >= 10 and res["reproduced"] >= 8, (res["cases"], res["reproduced"])
    ok = {(d["project_id"], d["attribute"]) for d in res["details"] if d["result"] == "reproduced"}
    assert (P1B, "length_km") in ok and (P1B, "cost_inr_crore") in ok


@pytest.mark.parametrize("sentence,attr,expected", [
    ("Swargate-Katraj tunnel will run about 28 m below ground, with boring starting in January.", "tunnel_depth_m", "~28 m"),
    ("Swargate-Katraj tunnel will run about 28 m below ground, with boring starting in January.", "tunnelling_start", "January 2027"),
    ("The Swargate-Katraj extension will span 5.46 km and will include five underground stations.", "station_count", "5 stations"),
    ("The estimated cost of the Swargate-Katraj project is Rs.2954.53 crore.", "cost_inr_crore", "₹2,954.53 crore"),
    ("The Swargate-Katraj original deadline of March 2026 has been extended to December 2029.", "completion_target", "December 2029"),
])
def test_extractor_patterns(sentence, attr, expected):
    """The extractor itself (on sentences, whatever page they come from; only official pages ever reach it)."""
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


def test_ambiguous_and_other_phase_values_are_skipped():
    P = cfgmod.load()["projects"]
    s1 = "ITD Cementation was declared the lowest bidder for Pune Metro Purple Line's 5.46 km extension from Swargate to Katraj."
    s2 = "The Swargate-Katraj section will function as a natural extension of Phase 1's 3.3 km District Court-Swargate underground section."
    assert [c for c in extract_page([s1, s2], "", P, None) if c.attribute == "length_km"] == []


def test_agreement_precision_and_hedges():
    assert agree("length_km", 5.463, None, "exact", 5.46, None, "exact")
    assert not agree("cost_inr_crore", 2954.53, None, "exact", 2954.75, None, "exact")
    assert agree("tunnel_depth_m", 28.0, None, "approx", 29.0, None, "exact")
    assert not agree("tunnel_depth_m", 28.0, None, "exact", 30.0, None, "exact")
    assert not agree("completion_target", None, "2029", "exact", None, "2029-12", "exact")


# ── confidence: official only ─────────────────────────────────────────────────────────────────────────────────────────
class C:
    def __init__(self, q="a", llm=False):
        self.quote_sha256, self.extractor, self.cites_other = q, ("llm:x" if llm else "pattern:x@1"), False


class D:
    def __init__(self, url, pub="2026-11-01"):
        self.url, self.final_url, self.published_at = url, url, pub


def test_news_never_counts_however_many_outlets():
    t = TODAY
    news = [(C("q1"), D("https://www.hindustantimes.com/a")), (C("q2"), D("https://punemirror.com/b")),
            (C("q3"), D("https://www.punekarnews.in/c"))]
    i = corroboration(news, t, 400)
    assert i["official"] == 0 and not i["corroborated"] and not i["all_official"]
    assert corroboration([(C("q1"), D(PIB))], t, 400)["corroborated"]
    mixed = corroboration([(C("q1"), D(PIB)), (C("q2"), D("https://www.hindustantimes.com/a"))], t, 400)
    assert mixed["official"] == 1 and not mixed["all_official"] and not mixed["corroborated"]   # news taints the proposal
    old = corroboration([(C("q1"), D(PIB, "2019-01-01"))], t, 400)                               # an old official source still counts
    assert old["official"] == 1 and old["corroborated"]


# ── the pipeline on recorded pages ────────────────────────────────────────────────────────────────────────────────────
def test_run_on_fixtures_has_zero_news_proposals(env):
    with SessionLocal() as db:
        rep = do_run(db)
        add_pib(db)
        assert rep["stats"]["pages_read"] == 2 and rep["errors"] == []
        assert all(official.is_official_url(u) for u in all_evidence_urls(db))
        assert not any(h in c for c in env.calls for h in ("hindustantimes", "punemirror", "punekarnews", "indianexpress",
                                                             "timesofindia", "themetrorailguy", "primetime24"))
        ps = db.query(FuProposalEntity).all()
        assert ps and all(p.confidence in ("official", "official_conflicting", "slipped") for p in ps)
        assert all(p.official_sources >= 1 for p in ps)
        assert props(db, "tunnel_depth_m") == {}                      # no official depth: no proposal at all
        assert props(db, "length_km")["5.46 km"].confidence == "official"
        assert props(db, "length_km")["5.46 km"].official_sources == 2    # punemetrorail.org + pib.gov.in
        st = props(db, "station_count")
        assert set(st) == {"3 stations", "5 stations"}
        assert all(p.confidence == "official_conflicting" for p in st.values())   # Maha-Metro page table 5 vs text 3 / PIB 3
        assert any(f["code"] == "official_page_undated" for f in json.loads(st["5 stations"].flags_json))
        assert props(db, "completion_target")["February 2029"].confidence == "official"
        assert facts_mod.read_active(db)["facts"] == []               # nothing reached the dataset
        assert audit.verify_chain(db)["ok"]


def test_news_candidates_are_skipped_before_any_request(env, monkeypatch):
    """Even if a plug-in (or an official feed) offers newspaper URLs, they are never fetched or stored."""
    from updater import sources

    def leaky(src, projects, f):
        return sources.SourceResult(src["id"], [Candidate(u, src["id"], "Swargate-Katraj", "2026-11-04", {P1B}) for u in NEWS_PAGES], [])
    monkeypatch.setitem(sources.PLUGINS, "rss", leaky)
    monkeypatch.setattr(pipeline, "PLUGINS", sources.PLUGINS)
    with SessionLocal() as db:
        rep = do_run(db)
        assert rep["stats"]["not_official_skipped"] >= len(NEWS_PAGES)
        assert not any(u in env.calls for u in NEWS_PAGES)
        assert all(official.is_official_url(u) for u in all_evidence_urls(db))
        assert props(db, "tunnel_depth_m") == {}


def test_official_feed_links_to_news_are_not_followed():
    from updater.sources import rss
    feed = (b'<rss><channel><item><title>Swargate-Katraj metro update</title><link>https://www.hindustantimes.com/x</link></item>'
            b'<item><title>Swargate-Katraj metro tender</title><link>https://www.pmrda.gov.in/notice/1</link></item></channel></rss>')

    class F:
        def get(self, url):
            return type("R", (), {"status": 200, "body": feed})()
    res = rss({"id": "pmrda_feed", "url": "https://www.pmrda.gov.in/feed/"}, cfgmod.load()["projects"], F())
    assert [c.url for c in res.candidates] == ["https://www.pmrda.gov.in/notice/1"]


def test_redirect_off_the_allow_list_is_not_stored(env, monkeypatch):
    def redirect(url, timeout, headers):
        if url.endswith("robots.txt"):
            return 200, {}, b"User-agent: *\nDisallow:\n", url
        return 200, {"content-type": "text/html"}, (FIX / "ht_2026-08-21_tbms.html").read_bytes(), "https://www.hindustantimes.com/moved"
    monkeypatch.setattr(fetch, "TRANSPORT", redirect)
    with SessionLocal() as db:
        rep = do_run(db)
        assert any("non-official" in e["error"] for e in rep["errors"])
        assert db.query(FuDocumentEntity).count() == 0
        with pytest.raises(official.NotOfficialSource):
            pipeline.add_evidence(db, cfgmod.load(), LINE_B, "Asha", fetcher=fetcher())


def test_add_evidence_refuses_news(env):
    with SessionLocal() as db:
        for u in NEWS_PAGES:
            with pytest.raises(official.NotOfficialSource):
                pipeline.add_evidence(db, cfgmod.load(), u, "Asha", fetcher=fetcher())
        assert not any(u in env.calls for u in NEWS_PAGES)
        assert db.query(FuDocumentEntity).count() == 0
        res = add_pib(db)
        assert res["publisher"] == "Press Information Bureau" and res["tier"] == 1


def test_ingest_refuses_news_directly(env):
    with SessionLocal() as db:
        cand = Candidate(NEWS_PAGES[0], "manual", "", None, {P1B})
        with pytest.raises(official.NotOfficialSource):
            pipeline.ingest(db, cfgmod.load(), cand, b"<html></html>", NEWS_PAGES[0], 200, "", None, 1)


def test_dry_run_writes_nothing(env):
    with SessionLocal() as db:
        rep = do_run(db, dry=True)
        assert rep["pending"]
        assert all(e["url"] and official.is_official_url(e["url"]) for p in rep["pending"] for e in p["evidence"])
    with SessionLocal() as db:
        assert db.query(FuProposalEntity).count() == 0
        assert db.execute(text("SELECT COUNT(*) FROM fu_documents")).scalar() == 0


def test_second_run_is_idempotent(env):
    with SessionLocal() as db:
        do_run(db)
        n = db.query(FuProposalEntity).count()
        rep = do_run(db)
        assert db.query(FuProposalEntity).count() == n and rep["proposals_created"] == []


def _synthetic_official_claim(db, url, published, value_text, temporal="planned", attribute="completion_target"):
    d = FuDocumentEntity(id=f"fud_{uuid.uuid4().hex[:8]}", url=url, final_url=url, domain=official.official_domain(url),
                         publisher="Maha-Metro", tier=1, title="t", published_at=published, published_from="meta", sha256=uuid.uuid4().hex)
    q = f"Swargate-Katraj target {value_text} ({published})."
    c = FuClaimEntity(id=f"fuc_{uuid.uuid4().hex[:8]}", document_id=d.id, project_id=P1B, attribute=attribute,
                      value_text=value_text, qualifier="exact", temporal=temporal, quote=q, quote_sha256=quote_hash(q),
                      extractor="pattern:test@1")
    db.add_all([d, c])
    db.flush()


def test_slipped_needs_a_later_official_date(env):
    """Synthetic rows: an official planned month that has passed, replaced by a later official planned month."""
    with SessionLocal() as db:
        _synthetic_official_claim(db, "https://www.punemetrorail.org/pr-2025.pdf", "2025-05-01", "2026-09")
        _synthetic_official_claim(db, "https://www.punemetrorail.org/pr-2026.pdf", "2026-11-04", "2027-01")
        assign(db)
        evaluate_all(db, facts_mod.read_active(db), 400, TODAY)
        p = {x.value_text: x for x in db.query(FuProposalEntity).filter_by(attribute="completion_target")}
        assert p["2026-09"].confidence == "slipped" and p["2027-01"].confidence == "official"
        with pytest.raises(review.ReviewError, match="needs a note"):
            review.approve(db, p["2026-09"].id, "Asha")


# ── review: approve → version → rollback; nothing applied without approval ────────────────────────────────────────────
def test_approve_apply_rollback(env):
    cfg = cfgmod.load()
    with SessionLocal() as db:
        do_run(db)
        add_pib(db)
        length = props(db, "length_km")["5.46 km"]
        with pytest.raises(review.ReviewError, match="nothing to apply"):
            review.apply_approved(db, "Asha", cfg=cfg)
        with pytest.raises(review.ReviewError, match="reviewer"):
            review.approve(db, length.id, "  ")
        review.approve(db, length.id, "Asha (planner)")
        assert facts_mod.read_active(db)["facts"] == []                 # approve ≠ apply
        v2 = review.apply_approved(db, "Asha (planner)", "length from Maha-Metro + PIB", cfg=cfg)
        db.commit()
        act = facts_mod.read_active(db)
        assert act["version_label"] == "v2" and act["sha256_ok"] and act["withheld"] == []
        f = act["facts"][0]
        assert (f["attribute"], f["value_num"], f["confidence"], f["approved_by"]) == ("length_km", 5.46, "official", "Asha (planner)")
        assert {e["domain"] for e in f["evidence"]} == {"punemetrorail.org", "pib.gov.in"}
        assert all(e["quote"] and e["url"] and e["sha256"] and e["tier"] == 1 for e in f["evidence"])
        assert db.get(FuProposalEntity, length.id).status == "applied"
        vs = review.versions(db)
        v1 = next(v for v in vs if v["version_label"] == "v1")
        review.rollback(db, v1["id"], "Ravi (GIS)", "test rollback")
        db.commit()
        assert facts_mod.read_active(db)["facts"] == []
        assert db.get(FuProposalEntity, length.id).status == "rolled_back"
        review.rollback(db, v2.id, "Ravi (GIS)", "restore")
        db.commit()
        assert facts_mod.read_active(db)["facts"][0]["value_num"] == 5.46
        assert {"run", "approve", "apply", "rollback"} <= {e["action"] for e in audit.entries(db)}
        assert audit.verify_chain(db)["ok"]


def test_rolled_back_proposal_can_be_approved_and_applied_again(env):
    cfg = cfgmod.load()
    with SessionLocal() as db:
        do_run(db)
        length = props(db, "length_km")["5.46 km"]
        review.approve(db, length.id, "Asha")
        v2 = review.apply_approved(db, "Asha", cfg=cfg)
        v1 = next(v for v in review.versions(db) if v["version_label"] == "v1")
        review.rollback(db, v1["id"], "Ravi")
        assert db.get(FuProposalEntity, length.id).status == "rolled_back"
        review.approve(db, length.id, "Ravi")
        v3 = review.apply_approved(db, "Ravi", cfg=cfg)
        db.commit()
        assert v3.version_label == "v3" and v3.id != v2.id
        assert db.get(FuProposalEntity, length.id).status == "applied"
        assert db.get(FuProposalEntity, length.id).applied_version_id == v3.id
        assert audit.verify_chain(db)["ok"]


def test_official_conflicting_needs_a_note_and_supersedes_competitors(env):
    with SessionLocal() as db:
        do_run(db)
        add_pib(db)
        st = props(db, "station_count")
        with pytest.raises(review.ReviewError, match="needs a note"):
            review.approve(db, st["5 stations"].id, "Asha")
        review.approve(db, st["5 stations"].id, "Asha", "Maha-Metro PR May 2026 is newer than the 2024 sanction")
        assert db.get(FuProposalEntity, st["3 stations"].id).status == "superseded"


# ── the official-only gates on data written before the rule ───────────────────────────────────────────────────────────
def test_news_proposal_rejected_and_never_approvable_or_applicable(env):
    cfg = cfgmod.load()
    with SessionLocal() as db:
        d, c, p = legacy_news(db)
        evaluate_all(db, facts_mod.read_active(db), 400, TODAY)
        assert p.status == "rejected" and p.decided_by.startswith("system") and p.confidence == "not_official"
        for note in ("", "two newspapers say so"):
            with pytest.raises(review.ReviewError, match="official"):
                review.approve(db, p.id, "Asha", note)
        # even forced into "approved" by raw SQL, apply refuses it
        db.execute(text("UPDATE fu_proposals SET status='approved', applied_version_id=NULL WHERE id=:i"), {"i": p.id})
        db.expire_all()
        with pytest.raises(review.ReviewError, match="non-official"):
            review.apply_approved(db, "Asha", cfg=cfg)
        assert facts_mod.read_active(db)["facts"] == []


def test_news_claim_never_creates_or_joins_a_proposal(env):
    with SessionLocal() as db:
        d, c, p = legacy_news(db)
        c.proposal_id = None
        db.delete(p)
        db.flush()
        assert assign(db) == []
        assert db.get(FuClaimEntity, c.id).proposal_id is None
        # an official claim of the same value opens its own proposal; the news claim never joins it
        do_run(db)
        assert db.get(FuClaimEntity, c.id).proposal_id is None


def test_register_version_refuses_news_facts(env):
    with SessionLocal() as db:
        news_fact = {"project_id": P1B, "attribute": "tunnel_depth_m", "value_num": 28.0, "label": "~28 m",
                     "evidence": [{"url": "https://www.hindustantimes.com/a", "publisher": "Hindustan Times", "quote": "q"}]}
        with pytest.raises(facts_mod.UnofficialFactError):
            facts_mod.register_version(db, [news_fact], reviewer="x", note="", proposal_ids=[], evidence=[], activate=True)
        no_evidence = {**news_fact, "evidence": []}
        with pytest.raises(facts_mod.UnofficialFactError):
            facts_mod.register_version(db, [no_evidence], reviewer="x", note="", proposal_ids=[], evidence=[], activate=True)
        mixed = {**news_fact, "evidence": news_fact["evidence"] + [{"url": PIB, "publisher": "PIB", "quote": "q"}]}
        with pytest.raises(facts_mod.UnofficialFactError):
            facts_mod.register_version(db, [mixed], reviewer="x", note="", proposal_ids=[], evidence=[], activate=True)


def _write_legacy_version(db, facts):
    """A facts version as a pre-rule database holds it (written around the new check, as the old code did)."""
    real = facts_mod.official_check
    facts_mod.official_check = lambda f: []
    try:
        return facts_mod.register_version(db, facts, reviewer="old", note="pre-rule", proposal_ids=[], evidence=[], activate=True)
    finally:
        facts_mod.official_check = real


def test_old_news_facts_are_withheld_and_old_version_cannot_be_reactivated(env):
    with SessionLocal() as db:
        news = {"project_id": "pune_metro_line_1_purple", "attribute": "tunnel_depth_m", "value_num": 30.0, "label": "up to 30 m",
                "osm_name_patterns": ["purple"], "origin": "seed",
                "evidence": [{"url": "https://www.hindustantimes.com/pune-news/x.html", "publisher": "Hindustan Times", "quote": "q"}]}
        good = {"project_id": P1B, "attribute": "length_km", "value_num": 5.46, "label": "5.46 km", "origin": "seed",
                "evidence": [{"url": PIB, "publisher": "PIB", "quote": "q"}]}
        old = _write_legacy_version(db, [news, good])
        db.commit()
        act = facts_mod.read_active(db)
        assert [f["attribute"] for f in act["facts"]] == ["length_km"]
        assert act["withheld"] == ["pune_metro_line_1_purple·tunnel_depth_m"]
        facts_mod.register_version(db, [good], reviewer="x", note="", proposal_ids=[], evidence=[], activate=True)
        db.commit()
        with pytest.raises(review.ReviewError, match="not backed only by official"):
            review.rollback(db, old.id, "Ravi")


def test_api_facts_never_return_news(env, client):
    with SessionLocal() as db:
        news = {"project_id": P1B, "attribute": "tunnel_depth_m", "value_num": 28.0, "label": "~28 m", "osm_name_patterns": ["katraj"],
                "evidence": [{"url": "https://www.hindustantimes.com/a", "publisher": "Hindustan Times", "quote": "q"}]}
        _write_legacy_version(db, [news])
        db.commit()
    r = client.get("/api/updater/facts").json()
    assert r["facts"] == [] and r["withheld"] == [f"{P1B}·tunnel_depth_m"]
    st = client.get("/api/updater/status").json()
    assert st["facts"]["withheld"] and "gov.in" in st["official_rule"]["government_zones"]
    assert all(s["tier"] == 1 for s in st["sources"])


# ── migration of an existing database ─────────────────────────────────────────────────────────────────────────────────
def test_migrate_official_only_cleans_an_old_database(env):
    cfg = cfgmod.load()
    with SessionLocal() as db:
        # an old database: news pages, a news proposal that was APPLIED, and an old seed with news facts active
        do_run(db)                                               # official proposals (stay)
        d, c, p = legacy_news(db, status="applied")
        old_seed = {"project_id": "pune_metro_line_1_purple", "attribute": "tunnel_depth_m", "value_num": 30.0, "label": "up to 30 m",
                    "origin": "seed", "proposal_id": None,
                    "evidence": [{"url": "https://www.hindustantimes.com/pune-news/x.html", "publisher": "Hindustan Times", "quote": "q"}]}
        applied_news = {"project_id": P1B, "attribute": "tunnel_depth_m", "value_num": 28.0, "label": "~28 m", "proposal_id": p.id,
                        "evidence": [{"url": d.url, "publisher": "Hindustan Times", "quote": c.quote}]}
        _write_legacy_version(db, [old_seed, applied_news])
        db.commit()
        n_official = db.query(FuProposalEntity).filter(FuProposalEntity.id != p.id).count()

        dry = migrate.migrate(db, cfg, "Asha", dry_run=True)
        assert dry["unofficial_pages_deleted"] == 1 and dry["facts_version"]["action"] == "would register a new version"
        assert db.query(FuDocumentEntity).filter_by(id=d.id).count() == 1           # dry run changed nothing
        assert facts_mod.read_active(db)["withheld"]

        rep = migrate.migrate(db, cfg, "Asha")
        assert rep["unofficial_pages_deleted"] == 1 and rep["unofficial_claims_deleted"] == 1
        assert p.id in rep["proposals_rejected"]
        assert rep["facts_version"]["action"] == "registered"
        assert db.query(FuDocumentEntity).filter_by(id=d.id).count() == 0
        assert db.get(FuProposalEntity, p.id).status == "rejected"
        assert db.query(FuProposalEntity).filter(FuProposalEntity.id != p.id, FuProposalEntity.status != "rejected").count() == n_official
        act = facts_mod.read_active(db)
        assert act["withheld"] == [] and act["facts"]
        assert all(official.is_official_url(e["url"]) for f in act["facts"] for e in f["evidence"])
        assert not any(f["attribute"] == "tunnel_depth_m" for f in act["facts"])
        expected, _ = seed.baseline_facts(seed.load_seed(), cfg)
        assert len(act["facts"]) == len(expected)
        assert any(e["action"] == "purge_unofficial" for e in audit.entries(db))
        assert audit.verify_chain(db)["ok"]
        # idempotent
        again = migrate.migrate(db, cfg, "Asha")
        assert again["unofficial_pages_deleted"] == 0 and again["facts_version"]["action"] == "none"
        assert again["proposals_rejected"] == []


def test_migrate_keeps_reviewed_official_facts(env):
    cfg = cfgmod.load()
    with SessionLocal() as db:
        do_run(db)
        add_pib(db)
        comp = props(db, "completion_target")["February 2029"]
        review.approve(db, comp.id, "Asha")
        review.apply_approved(db, "Asha", cfg=cfg)
        db.commit()
        rep = migrate.migrate(db, cfg, "Asha")
        assert rep["facts"]["reviewed_facts_kept"] == 1
        act = facts_mod.read_active(db)
        f = next(x for x in act["facts"] if x["project_id"] == P1B and x["attribute"] == "completion_target")
        assert f["proposal_id"] == comp.id and f["value_text"] == "2029-02"
        assert db.get(FuProposalEntity, comp.id).status == "applied"


def test_migrate_fixes_the_noc_rule_citation_only_when_untouched(env):
    from coordination.models import ClearanceRuleEntity
    from coordination.seed import _S9, _S9_LEGACY
    with SessionLocal() as db:
        r = db.get(ClearanceRuleEntity, "metro_noc_20m")
        if r is None:
            pytest.skip("coordination seed not loaded in this test database")
        r.citation = _S9_LEGACY
        db.commit()
        migrate.migrate(db, cfgmod.load(), "Asha")
        assert db.get(ClearanceRuleEntity, "metro_noc_20m").citation == _S9
        db.get(ClearanceRuleEntity, "metro_noc_20m").citation = "my own note"
        db.commit()
        assert migrate.migrate(db, cfgmod.load(), "Asha")["noc_rule_citation"].startswith("left alone")
        db.get(ClearanceRuleEntity, "metro_noc_20m").citation = _S9
        db.commit()


# ── the seed list (docs/urbanos/pune_project_facts.json) ─────────────────────────────────────────────────────────────
def test_seed_json_is_official_only():
    data = seed.load_seed()
    assert data["meta"]["dataset_version"] == seed.SEED_VERSION and data["meta"]["official_only"] is True
    assert set(data["meta"]["confidence_levels"]) == {"official", "official_conflicting", "slipped"}
    for r in data["records"]:
        assert r["confidence"] in ("official", "official_conflicting", "slipped"), r["id"]
        assert r["sources"] and all(official.is_official_url(s["url"]) for s in r["sources"]), r["id"]
        for a in r.get("alt_values") or []:
            srcs = a["source"] if isinstance(a["source"], list) else [a["source"]]
            assert all(official.is_official_url(s["url"]) for s in srcs), r["id"]
        assert (r["confidence"] == "official_conflicting") == bool(r.get("alt_values")), r["id"]
    for u in data["update_sources"]:
        assert official.is_official_url(u["url"]), u
    for n in data.get("not_available", []):
        assert all(official.is_official_url(s["url"]) for s in n.get("sources", []))
    blob = json.dumps(data, ensure_ascii=False)
    for word in ("hindustantimes", "indianexpress", "timesofindia", "punemirror", "punekarnews", "primetime24",
                 "themetrorailguy", "3637.6", "3,637.6", "Hindustan Times", "Times of India", "Pune Times Mirror"):
        assert word not in blob, word
    ids = {r["id"] for r in data["records"]}
    assert f"{P1B.replace('_', '-')}::tunnel_depth" not in ids and f"{P1B.replace('_', '-')}::cost_revised" not in ids


def test_seed_baseline_is_official_and_compared(env):
    cfg = cfgmod.load()
    facts, counts = seed.baseline_facts(seed.load_seed(), cfg)
    assert counts["mapped"] >= 25 and counts["not_official"] == 0 and all(f["evidence"] for f in facts)
    assert not any(f["attribute"] == "tunnel_depth_m" for f in facts)
    assert {f["confidence"] for f in facts} <= {"official", "official_conflicting", "slipped"}
    tampered = seed.load_seed()
    tampered["records"][0]["sources"].append({"url": "https://www.hindustantimes.com/x", "publisher": "HT", "quote": "q"})
    assert seed.baseline_facts(tampered, cfg)[1]["not_official"] == 1
    with SessionLocal() as db:
        facts_mod.register_version(db, facts, reviewer="coordinator", note="seed", proposal_ids=[], evidence=[], activate=True)
        db.commit()
        do_run(db)
        add_pib(db)
        comp = props(db, "completion_target")["February 2029"]
        assert any(c["kind"] == "dataset_value" and c["value"] == "September 2028" for c in json.loads(comp.conflicts_json))
        assert not any(c["kind"] == "dataset_value" for c in json.loads(props(db, "length_km")["5.46 km"].conflicts_json))


def test_seed_baseline_cli_refuses_when_facts_exist_even_withheld(env, monkeypatch, capsys):
    from updater.__main__ import main
    with SessionLocal() as db:
        _write_legacy_version(db, [{"project_id": P1B, "attribute": "tunnel_depth_m", "value_num": 28.0,
                                    "evidence": [{"url": "https://www.hindustantimes.com/a", "quote": "q"}]}])
        db.commit()
    assert main(["seed-baseline", "--reviewer", "Asha"]) == 2
    assert "migrate-official-only" in capsys.readouterr().out


# ── API ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_api_review_flow(env, client):
    with SessionLocal() as db:
        do_run(db)
    rows = client.get("/api/updater/proposals?status=pending").json()
    assert len(client.get("/api/updater/proposals?status=all").json()) >= len(rows) > 0   # "all" = no filter, like the CLI
    assert all(e["official"] and e["tier"] == 1 for p in rows for e in p["evidence"])
    length = next(p for p in rows if p["attribute"] == "length_km" and p["label"] == "5.46 km")
    assert length["evidence"][0]["quote"] and length["confidence"] == "official"
    assert client.post(f"/api/updater/proposals/{length['id']}/approve", json={"reviewer": ""}).status_code == 400
    assert client.post(f"/api/updater/proposals/{length['id']}/approve", json={"reviewer": "Asha"}).json()["status"] == "approved"
    assert client.get("/api/updater/facts").json()["facts"] == []
    r = client.post("/api/updater/apply", json={"reviewer": "Asha"})
    assert r.status_code == 200 and r.json()["review_status"] == "active"
    fx = client.get(f"/api/updater/facts?project={P1B}").json()
    assert fx["facts"][0]["label"] == "5.46 km" and fx["sha256_ok"]
    vs = client.get("/api/updater/versions").json()
    v1 = next(v for v in vs if v["version_label"] == "v1")
    assert client.post("/api/updater/rollback", json={"version_id": v1["id"], "reviewer": "Ravi"}).status_code == 200
    assert client.get("/api/updater/facts").json()["facts"] == []
    st = client.get("/api/updater/status").json()
    assert st["audit"]["ok"] and st["facts"]["version_label"] == "v1"
    ds = client.get(f"/api/datasets/{facts_mod.DATASET_ID}").json()
    assert ds["theme"] == "project_facts" and len(ds["versions"]) == 2


def test_api_lists_only_official_proposals(env, client):
    with SessionLocal() as db:
        do_run(db)
        d, c, p = legacy_news(db)
        db.commit()
        pid = p.id
    ids = {x["id"] for x in client.get("/api/updater/proposals?status=all").json()}
    assert ids and pid not in ids
    assert pid in {x["id"] for x in client.get("/api/updater/proposals?status=all&include_unofficial=true").json()}


def test_api_approve_news_proposal_is_400(env, client):
    with SessionLocal() as db:
        d, c, p = legacy_news(db)
        db.commit()
        pid = p.id
    r = client.post(f"/api/updater/proposals/{pid}/approve", json={"reviewer": "Asha", "note": "two papers"})
    assert r.status_code == 400 and "official" in r.json()["detail"]


def test_four_eyes_apply(env):
    cfg = cfgmod.load()
    with SessionLocal() as db:
        do_run(db)
        review.approve(db, props(db, "length_km")["5.46 km"].id, "Asha")
        v = review.apply_approved(db, "Asha", activate=False, cfg=cfg)
        db.commit()
        assert v.review_status == "pending_review" and facts_mod.read_active(db)["facts"] == []
        review.activate_pending(db, v.id, "Ravi")
        db.commit()
        assert facts_mod.read_active(db)["facts"][0]["value_num"] == 5.46
        assert db.get(FuProposalEntity, props(db, "length_km")["5.46 km"].id).status == "applied"


def test_tampered_facts_file_is_refused(env):
    cfg = cfgmod.load()
    with SessionLocal() as db:
        do_run(db)
        review.approve(db, props(db, "length_km")["5.46 km"].id, "Asha")
        v = review.apply_approved(db, "Asha", cfg=cfg)
        db.commit()
        p = Path(os.environ["URBANOS_DATA_DIR"]) / "derived" / facts_mod.DATASET_ID / v.version_label / "facts.json"
        p.write_text(p.read_text(encoding="utf-8").replace("5.46", "6.46"), encoding="utf-8")
        act = facts_mod.read_active(db)
        assert act["facts"] == [] and act["sha256_ok"] is False and "refused" in act["error"]


def test_audit_chain_detects_edit(env):
    with SessionLocal() as db:
        do_run(db)
        db.execute(text("UPDATE fu_audit SET actor = 'mallory' WHERE seq = (SELECT MIN(seq) FROM fu_audit)"))
        assert audit.verify_chain(db)["ok"] is False
        db.rollback()


def test_llm_extractor_guards(monkeypatch):
    from updater import llm
    projects = cfgmod.load()["projects"]
    text_ = "The Swargate-Katraj tunnel will be about 28 metres deep. Other text."
    raw = [{"project_id": P1B, "attribute": "tunnel_depth_m", "value": 28,
            "quote": "The Swargate-Katraj tunnel will be about 28 metres deep."},
           {"project_id": P1B, "attribute": "tunnel_depth_m", "value": 30,
            "quote": "The Swargate-Katraj tunnel will be about 28 metres deep."},            # value not in quote
           {"project_id": P1B, "attribute": "tunnel_depth_m", "value": 28,
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
