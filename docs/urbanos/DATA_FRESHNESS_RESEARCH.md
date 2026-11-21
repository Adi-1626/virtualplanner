# Data freshness service — research and decisions

Written Sat 2026-11-21 (IST) on branch `data-updater` (from `main` 9e56ccc). This is Phase 1 of the "keep the
dataset current" request:

> "implement a technology in the app that will get the latest data from the google just like how you made the dataset …
> there are multiple new things building and the data gets stale, for ex MahaMetro's Swargate–Katraj tunnel will run
> about 28 m below ground, with boring starting in January. Make a service that we run separately to update the
> dataset, and it should be perfect, no mistake in it."

The user said he does not know how it should be done. This document compares the options, then **decides** each point
and gives the reason (§9). The implementation that follows these decisions is described in
[DATA_FRESHNESS_SERVICE.md](DATA_FRESHNESS_SERVICE.md).

Every web fact below was checked on 2026-11-21 from this sandbox (robots.txt files and feeds were fetched directly; the
command and result are summarised next to each claim).

---

## 1. The honest short answer

- **"Get it from Google" is no longer a sound foundation.**
  - Google's programmable web-search API is closing.
  - Google News RSS forbids exactly this use, both in its robots.txt and in its feed licence (§2.1, §2.2).
  - We keep Google as an optional plug-in only where it is still lawful.
- **We use the sources Google itself indexes.** These are the official publishers (MahaMetro, PMC, PMRDA, PIB,
  Maharashtra government) and the newspapers' own RSS feeds. GDELT, an open global news index whose licence allows any
  use with a citation, is the free "search engine" layer.
- **"Perfect, no mistake" cannot be promised by software.** Newspapers misquote, numbers get rounded, and official pages
  go out of date.
  - Real example found today: MahaMetro's own project-profile page still says the Swargate–Katraj extension has
    **3** stations. MahaMetro statements quoted in the press since 2025 say **5**.
  - The cost appears as ₹2,954.53 cr (Union Cabinet, Aug 2024), ₹2,954.75 cr (HT, Sep 2026) and ₹2,945 cr (Indian
    Express, Nov 2025).
- **What software can promise is a process where every change is:**
  - traceable to a quoted sentence on a dated, hashed page;
  - corroborated, or flagged as not corroborated;
  - checked against what we already hold;
  - approved by a named person;
  - versioned and reversible.

  That is what this service implements. It proposes; a person decides.

---

## 2. How to find new facts — options compared

| Option | Cost / key | Legal position (checked 2026-11-21) | Robustness | Verdict |
|---|---|---|---|---|
| **Google Custom Search JSON API** | 100 queries/day free, then $5 per 1,000, max 10k/day; API key + engine id | Its overview page says it is *"closed to new customers"*. Existing customers must move off it by **1 Jan 2027** (41 days from now). Since 20 Jan 2026, new engines cannot "search the entire web" ([overview](https://developers.google.com/custom-search/v1/overview), [PSE blog 2026-01-20](https://programmablesearchengine.googleblog.com/2026/01/updates-to-our-web-search-products.html)) | Ends in 6 weeks | **Optional plug-in, off by default.** Only for a user who already holds a key; it warns about the end date |
| **Google News RSS search** (`news.google.com/rss/search?q=…`) | free, no key | `https://news.google.com/robots.txt` has `User-agent: *` / `Disallow: /`. Its allow-list covers `/topics/`, `/publications/`, `/stories/` and others, but **not `/rss`**. The feed's `<copyright>` says it is *"made available solely for the purpose of rendering Google News results within a personal feed reader for personal, non-commercial use. Any other use of the feed is expressly prohibited."* Google's feed terms also say *"You may not redistribute Google's feeds"* ([terms](https://www.google.com/intl/en_us/news_feed_terms.html)) | Undocumented; capped at 100 items | **Not used.** It breaks our own robots.txt rule (the repo's update monitor follows RFC 9309) and the feed licence |
| Scraping google.com result pages | free | Against Google's Terms of Service, CAPTCHA-protected, and disallowed by robots.txt | Fragile | **Never** |
| **GDELT DOC 2.0 API** (`api.gdeltproject.org/api/v2/doc/doc`) | free, no key | *"available for unlimited and unrestricted use for any academic, commercial, or governmental use of any kind without fee"*; redistribution requires a citation and a link ([about](https://www.gdeltproject.org/about.html)). `robots.txt` is a 404, which means no rules (RFC 9309). Rate limit: the API itself answered *"Please limit requests to one every 5 seconds"* (HTTP 429) | Global news index updated every 15 min; returns URL, title, domain and date, never article text | **Default discovery source** (6 s between requests). Each article it finds is then fetched from the publisher under the publisher's robots.txt |
| **Publisher RSS feeds** (HT Pune, Indian Express Pune, TOI Pune, Punekar News, Pune Mirror) | free | Each feed is the publisher's own syndication channel. robots.txt checked: HT `Allow: /`; IE `Allow: /`; Punekar News allows crawling and adds "content signals" (search = collecting links and short excerpts, which matches our use); Pune Mirror and TOI feeds respond. **Free Press Journal disallows `/*/feed`** and many article paths, so it is excluded. metrorailnews.in returned 403 to a non-browser client, so it is excluded | Stable, low volume, fast | **Default** |
| **Official pages** (punemetrorail.org project-profile / project-update / tenders; PIB RSS; PMRDA; PMC) | free | punemetrorail.org and mahametro.org robots.txt: `User-agent: *` / `Disallow:` (allow all) except `/cgi-bin/`. pmc.gov.in allows all. pmrda.gov.in disallows only `/wp-admin/`. PIB RSS (`pib.gov.in/RssMain.aspx`) responds; `pib.gov.in/robots.txt` 301-redirects to an HTML page, so it has no parseable rules | Pages change layout. **Official does not mean current** (the 3-station example) | **Default**, ranked tier 1. Change detection uses ETag and content hash |
| **mahatenders.gov.in** | free | robots.txt: `User-agent: *` / `Disallow: /`; the portal also uses CAPTCHA | — | **Not crawled.** Tender facts come from the issuer's own tender page (punemetrorail.org/tenders allows crawling) or are entered by hand |
| data.gov.in / OpenCity | free (data.gov.in API needs a free key) | data.gov.in: [GODL-India](https://data.gov.in/government-open-data-license-india). OpenCity: dataset-level licences; the repo already records the OpenCity/PMC caveats (DATA_CATALOGUE.md §5). Neither host answered from this sandbox today (data.gov.in timed out) | Datasets, not news | Already covered by the registry's **update monitor** (CKAN `package_show`). Not a fact source |
| **OpenStreetMap** (Overpass, minutely diffs) | free | ODbL; Overpass etiquette is a small number of requests | Tags rarely carry depth; under-construction lines are mapped late | Not a fact source for depths or dates. **Plug-in** that checks whether a watched project's geometry has appeared in OSM. The app already imports OSM through `/api/osm` |
| Commercial news/SERP APIs (SerpApi, Brave, Bing successors, Event Registry) | paid keys | Each has its own terms; SERP resellers carry legal uncertainty | Good | **Optional keyed plug-in** through the same interface. None is shipped enabled |
| **The repo's own update monitor** (`backend/datasets/update_monitor.py`) | — | Already reads robots.txt (RFC 9309), applies per-host delays and the SSRF guard | Proven, with tests | **Reused:** the new service fetches through the same `Fetcher` (robots, crawl delay, public-host guard), with caching added on top |

### 2.1 Why not lean on Google anyway?
The request names Google because that is how the original dataset felt to have been made: by searching. The capability
he needs is "notice when a published source says something new about a project we track". Google is one way to notice,
and from 1 Jan 2027 it has no self-serve API at all. GDELT plus the publishers' feeds plus the official pages cover the
same Pune coverage, lawfully and for free. Each kept proposal still names the exact page, publisher and sentence; no
fact rests on "Google said so".

### 2.2 robots.txt and licence rules the service follows
- **robots.txt (RFC 9309)**, read once per host per run.
  - The longest matching rule wins.
  - A 4xx response means no rules; a 5xx response means disallow everything.
  - Crawl-delay is honoured, with a floor of 2 s per host. GDELT gets 6 s.
  - A host that refuses (401/403/429) is not contacted again in that run.

  This is the same code as the update monitor.
- **The service identifies itself.** Its User-Agent is `UrbanOS-data-freshness/1.0 (+docs/urbanos/DATA_FRESHNESS_SERVICE.md)`.
- **It keeps only what it needs.**
  - It stores the URL, publisher, title, publish date, retrieval time and the SHA-256 of the body.
  - It stores the **quoted sentence**, at most 400 characters, that supports a claim.
  - Full article bodies stay in an internal cache only (`URBANOS_DATA_DIR/updater/cache`, git-ignored) so a reviewer
    can re-check them. They are never redistributed, and the cache can be purged at any time (`python -m updater purge-cache`).
- **The applied facts dataset carries publisher attribution and links.** It is labelled internal: quotes from news
  articles are short excerpts for verification, not a republication. The same internal-only rule already applies to
  the PMC/OpenCity material.

---

## 3. How to turn articles into structured facts

A **fact** has these parts:
- `project` (a watched id, e.g. `pune_metro_swargate_katraj`);
- `attribute` (e.g. `tunnel_depth_m`);
- `value` and `unit`;
- `qualifier` (`approx`, `max`, `min`, `exact`);
- `temporal` (`planned` / `reported` / `completed`), and the event date when the fact is a date;
- the evidence behind it: URL, publisher, publish date, quoted sentence, retrieval time, body hash and extractor id.

### 3.1 Deterministic extractors (chosen default)
Each attribute is extracted by a **named, versioned pattern** that runs only on a sentence already attributed to a
watched project. Examples:

| Attribute | Pattern idea | Normalisation |
|---|---|---|
| `tunnel_depth_m` | "(depth of / at a depth of / run / operate / be) (about / around / nearly / up to) N m(etres) below ground (level)" | metres; the qualifier comes from the hedge word |
| `length_km` | "N(.N) km (long / stretch / corridor / route / extension / elevated / underground)" | km; metres ÷ 1000 |
| `station_count` | "N (underground / elevated)? stations"; also number words ("five stations") | integer |
| `cost_inr_crore` | "₹ / Rs N(,NNN)(.NN) crore"; also "lakh crore" | crore |
| `tbm_count` | "N tunnel boring machines / TBMs" | integer |
| `tunnelling_start` | "(boring / tunnelling / TBM) … (begin / start / commence) in (Month) (Year)?" | ISO month. A missing year is resolved against the article's publish date, and the resolution is recorded |
| `completion_target` | "(complete / completion / deadline / target) … by (Month) (Year)" | ISO month |
| `status` | "operational / opened / inaugurated / under construction / work order / LoA / tender" | controlled vocabulary |

- **Strengths:** predictable, testable with golden sentences, explainable to a reviewer, free, offline.
- **Weaknesses:** misses unusual phrasing, so recall is lower. The defence: a missed fact means **no** proposal, which
  never produces a wrong change.
- **Attribution rule:** the project must be named in the same sentence, or in the previous sentence of the same
  paragraph when the sentence only says "the line / the corridor / the extension". That decision is recorded as
  `attribution: sentence | previous_sentence`. Articles that mention several watched projects make cross-attribution
  likely, so only `sentence` attribution is allowed in them.

### 3.2 Optional LLM extractor (off by default)
- **Enabled only** when the user sets `UPDATER_LLM_URL`, `UPDATER_LLM_KEY` and `UPDATER_LLM_MODEL` for their own
  OpenAI-compatible endpoint.
- **Guard rails**, which make it no more trusted than the patterns:
  1. Every returned fact must carry a quote that is an exact substring of the fetched text. Anything else is dropped.
  2. The numeric value must appear in that quote; the check recomputes it with the deterministic number parser.
  3. Proposals carry `extractor: llm:<model>` and **always need 2 independent sources**. A single official source is
     not enough for an LLM-extracted fact.
  4. It never runs in tests or without a key, and the article text is sent only to the endpoint the user configured.
- **Why off:** the project prefers no unnecessary AI/ML; the deterministic extractor covers the tracked attributes; an
  LLM adds cost, a key and a new failure mode (plausible but unsupported numbers), which guard rail 2 exists to catch.

---

## 4. How to make it "no mistakes" — the process

### 4.1 Source ranking
| Tier | Who | Examples |
|---|---|---|
| 1 · official | The implementing or approving authority's own publication | punemetrorail.org, mahametro.org, PIB / Union Cabinet, PMC, PMRDA, PCMC, MSRDC, NHAI, Maharashtra government GRs |
| 2 · reputable press | Established newsrooms with editors | Hindustan Times, Indian Express, Times of India, Pune Mirror, Punekar News, The Hindu, Lokmat, Sakal |
| 3 · other | Aggregators, blogs, real-estate portals, trade sites | magicbricks, infracapitalist, metro fan sites |

Tier 3 never corroborates on its own; it can only be a lead.

### 4.2 Corroboration rule
A proposal is **corroborated** when **any** of these holds:
- (a) at least 1 tier-1 source states the value; or
- (b) at least 2 **independent** tier-2 sources state it.

LLM-extracted facts always need (b).

**Independent** means:
- **different registrable domains**: hindustantimes.com and its e-paper count as one; and
- **not the same text**: the normalised quote's SHA-256 differs, so syndicated wire copy counts once; and
- **not just repeating each other**: when one article cites another ("as reported by HT"), the attribution phrase is
  detected and the citing article is not counted.

Values **agree** when, after unit normalisation:
- they are equal; or
- they are within ±5 % and at least one carries a hedge (`about`, `around`, `nearly`, `approximately`);
- dates must be the same month.

### 4.3 Conflict detection
Each proposal is checked:
1. **Against the dataset:** the active facts version already holds a different value for the same project and
   attribute. The UI shows "Changes 26 m → 28 m".
2. **Against other sources:** another candidate value exists for the same project and attribute with its own evidence.
   All candidates are shown side by side, and approving one marks the others `superseded_by_decision`.
3. **Official vs press:** a tier-1 page disagrees with newer press quotes of the same authority. This is flagged as
   *possibly out-of-date official page* and is never auto-resolved (the 3-vs-5 stations case).

### 4.4 Staleness
- **Old articles:** an article older than `max_article_age_days` (default 400) is flagged `stale_source`; it still
  shows, but greyed out.
- **Unknown date:** an article with no machine-readable publish date is flagged `undated`. Undated sources never count
  towards corroboration.
- **Planned dates:**
  - A date fact ("boring starts in January") is `planned` when the sentence is future tense ("will", "expected to",
    "set to", "scheduled") and `reported` when past tense.
  - A planned date earlier than today is flagged `planned_date_passed — verify`.
  - A month with no year ("January") is resolved to the first such month **after** the article's publish date, and the
    resolution is shown ("January → 2027-01, from an article dated 2026-11-04").
- **Overtaken by newer evidence:** a proposal whose newest evidence is older than the newest evidence of a competing
  value is ranked lower and labelled.

### 4.5 Human approval, versioning, rollback, audit
- **Nothing reaches the dataset without a named reviewer.** The service writes only proposals.
  - Approve and reject need a reviewer name; this is the same rule as `registry.review_version`.
  - Approving does not change the dataset by itself.
- **Apply.** Applying the approved proposals writes a **new immutable registry version** of `pune_infra_project_facts`:
  - `facts.json` and `processing.json` under `URBANOS_DATA_DIR/derived/pune_infra_project_facts/<label>/`, with the
    file's SHA-256;
  - a `ds_processing_runs` row whose inputs are the previous version, every proposal id, and every evidence document's
    URL and hash. That row is the lineage.
- **Activation goes through the registry's review flow.** The new version is registered `pending_review`. The same
  request activates it with the reviewer's name, or a second person can activate it later (four-eyes mode).
- **Rollback** re-activates a superseded version through `registry.review_version`. Registry versions are never edited
  or deleted.
- **Audit.** An append-only `fu_audit` table records every run, proposal, decision, apply and rollback, with actor,
  time and a hash chain (each row hashes the previous row's hash). The proposal, decision and version tables are also
  registered with the app-wide audit log (`planning.audit`).
- **Read-time check.** The app reads facts only from the **active** version's file and checks its SHA-256 at read time.
  A tampered file is refused and reported, never shown.

### 4.6 What can still go wrong (and why review is required)
- **A wrong source:** two newspapers repeat the same wrong press briefing, or the authority itself changes its plan.
- **A fact missed in odd phrasing.** This is a false negative: no proposal is made.
- **Wrong attribution:** a sentence about a neighbouring project is attributed to the wrong one in an article that
  mentions both. The `sentence`-only attribution rule makes this rare, not impossible.
- **A wrong or missing publish date** on the publisher's page.
- **A changed article:** the publisher edits it after retrieval. The stored hash and quote show what we saw.
- **Site changes:** sites change layout or block clients. The run then records an error, and coverage drops silently
  until someone reads the run report. The run summary in the UI shows per-source errors for this reason.

Published figures are labelled **reported** (data class `inferred`, suitability `screening`). The app never draws them
as surveyed depths, which keeps the honesty rule used in Underground: a reported depth is not a surveyed level.

---

## 5. How others do it
- **Wikidata.**
  - Every statement carries **references**: the source, the retrieval date and often a quote.
  - **Ranks** distinguish the current consensus value (preferred), others (normal) and known-wrong or outdated values
    (deprecated), instead of deleting them ([Help:Ranking](https://www.wikidata.org/wiki/Help:Ranking)).
  - We copy this: competing values stay visible; a decision marks one current and keeps the rest.
- **OpenStreetMap.**
  - Every edit is a changeset with a source tag.
  - Quality assurance happens after the fact (OSMCha review, revert tools).
  - We do the review **before** applying, because the dataset feeds planning screening.
- **UK NUAR** (National Underground Asset Register).
  - Data comes from the asset owners (over 350 so far) under a statutory footing (Data (Use and Access) Act 2025), not
    from press reports.
  - Users remain responsible for safe-dig decisions ([gov.uk NUAR](https://www.gov.uk/guidance/national-underground-asset-register-nuar)).
  - The lesson: authoritative depth data comes from the owner (MahaMetro's GADs and DPR) and press numbers are context.
    That is why our facts are `screening` and the app keeps "request MahaMetro drawings" as the next investigation.
- **Government open-data portals (CKAN / data.gov.in).**
  - Harvesters poll catalogue metadata and register new resource versions.
  - The repo's update monitor already does this; this service adds the "unstructured news" side.
- **Common practice in news-monitoring pipelines** (GDELT-based research systems, newsroom fact-check desks):
  machine discovery, rule-based extraction, a human editor before publication, and the source text kept for audit.

---

## 6. Architecture (decided)

```
            ┌────────────── separate process: python -m updater ──────────────┐
 watchlist  │  sources (plug-ins) → fetch (robots, cache, delay) → documents   │
 .json  ───►│  → attribute to project → extract claims → group into proposals  │
            │  → corroborate / conflict / staleness → fu_* tables + fu_audit   │
            └──────────────────────────────┬───────────────────────────────────┘
                                           │ same DB (DATABASE_URL), additive fu_* tables
            ┌──────────────── FastAPI app (/api/updater) ──────────────────────┐
            │ list proposals · approve / reject (named reviewer) · apply →     │
            │ registry.add_version + review_version · rollback · facts (sha-   │
            │ verified) · runs · audit                                         │
            └──────────────────────────────┬───────────────────────────────────┘
                                           │
            Data catalogue → "Fact updates" tab (review queue)  ·  Underground → reported depth
```

- **Process.**
  - `python -m updater run [--dry-run] [--only id,…] [--sources a,b] [--json out.json]` runs once.
  - `python -m updater serve --every 24h` is a simple loop scheduler with no new dependency. On Windows, Task
    Scheduler runs `run` daily instead.
  - `status`, `proposals`, `review`, `apply`, `rollback` and `purge-cache` cover headless use.
- **Config.** `backend/updater/watchlist.json`, versioned in git:
  - projects with ids, aliases, the authority, the official pages to watch, the tracked attributes and OSM name
    patterns;
  - sources with tier, kind, URL, enabled flag and delay.
- **Storage.** New `fu_*` tables in the app DB, created by `create_all`; existing tables are untouched.
  - The DB is shared with the app because applying a fact must create the registry version in the same transaction.
  - SQLite handles one writer at a time: the service writes in short transactions and sets `busy_timeout`.
- **Cache.** HTTP bodies go to `URBANOS_DATA_DIR/updater/cache/<sha256>`, with conditional requests using
  ETag / If-Modified-Since. When `URBANOS_DATA_DIR` is unset, a temporary directory is used.
- **API.** `/api/updater/*` (§ in DATA_FRESHNESS_SERVICE.md).
- **UI.** Data catalogue → **Fact updates** tab (the catalogue already holds dataset versions and reviews).
  - It shows the quote, link, publisher, tier, publish date, corroboration count, the conflict warning, the current
    value, and Approve / Reject.
  - An Apply bar turns approved proposals into a new version; version history offers Roll back.
- **Into the app.** `GET /api/updater/facts` returns the active facts. Underground's metro hover tooltip shows
  "Reported tunnel depth ~28 m below ground (published figure; not surveyed)" with the source, for a metro line whose
  OSM name matches the project's patterns. The 3D drawing stays "depth not mapped" (§4.6).

---

## 7. Rate limits and politeness budget (default watch-list)
- **Per run:**
  - GDELT: one query per project, 6 s apart (about 12 queries, about 75 s);
  - five publisher RSS feeds;
  - about ten official pages;
  - candidate articles: at most 40 fetched per run, at most 8 per host, 2 s or more apart per host (crawl-delay wins
    if larger).

  A full run takes about 3–5 minutes and makes fewer than 80 requests in all.
- **Repeat requests:** cached pages are re-requested conditionally (304 = no body). An article whose URL has already
  been processed is not refetched for 30 days unless `--refresh` is given.
- **Default schedule:** daily. Pune project news does not move faster than that, and a slower cadence is kinder to the
  publishers.

---

## 8. What this does not do
- It does not edit geometry (alignments, stations); it records facts about projects. Drawing a new line still happens
  in Design, or through OSM once it is mapped.
- It does not create engineering-grade data. Depths from press or official statements are screening context, not
  levels.
- It does not watch social media (X/Twitter or Facebook posts by @metrorailpune). Those platforms' terms and APIs make
  automated reading paid or prohibited. A reviewer can paste a URL as manual evidence
  (`python -m updater add-evidence URL`).

---

## 9. Decision log

| # | Decision | Reason |
|---|---|---|
| D1 | Default discovery = official pages + publisher RSS + GDELT DOC API; Google CSE = optional keyed plug-in, off; Google News RSS and mahatenders are not used | Free, lawful and robots-compliant. Google CSE is closed to new customers and ends 2027-01-01. Google News RSS is robots-disallowed and limited to personal feed readers. mahatenders disallows all crawling |
| D2 | Deterministic, versioned extractors; LLM extractor optional, off, guarded by an exact-quote check and a value-in-quote check, and always needing 2 sources | The project prefers no unnecessary AI. A missed fact is safe; an invented one is not |
| D3 | Project attribution only within the sentence (or the previous sentence when the article names a single project) | Prevents cross-project mix-ups in roundup articles |
| D4 | Corroborated = 1 tier-1 source or 2 independent tier-2 sources (different domain and different quote hash) | The user's rule. Syndicated copies and citation chains do not count twice |
| D5 | Conflicts are always shown and never auto-resolved; official pages are not assumed current | The 3-vs-5 stations case found today |
| D6 | Undated sources never corroborate; stale and planned-date-passed facts are flagged; year-less months are resolved against the publish date, visibly | Publish date ≠ event date |
| D7 | Approve ≠ apply. Apply writes a new immutable registry version through `add_version` + `review_version`; rollback = re-activate a superseded version | Reuses the existing review flow and its immutability guard. Every change is reversible |
| D8 | Additive `fu_*` tables in the app DB, `create_all`; hash-chained `fu_audit`; also registered in `planning.audit` | Applying must be transactional with the registry. Tamper-evident history |
| D9 | Separate CLI process with an optional built-in loop scheduler; Task Scheduler or cron recommended | Runs without the web server. No new dependency |
| D10 | Store quotes (≤ 400 chars) + hashes in the DB; full bodies only in an internal, purgeable cache | Verifiability without republishing articles |
| D11 | Facts dataset = `pune_infra_project_facts`, data class `inferred`, suitability `screening`, licence "internal; quotes attributed to their publishers" | Honest classification. Published figures are not observations or engineering levels |
| D12 | The app reads facts only from the active version and verifies its SHA-256 at read time | A file edited outside the flow is refused |
| D13 | Underground shows a reported depth in the tooltip and keeps the 3D tunnel "depth not mapped" | A press figure is not a surveyed crown level; the honesty rule of the Underground workspace |
| D14 | Review queue lives in Data catalogue → "Fact updates" | Dataset versions and reviews already live there; same design components |
| D15 | Ask nothing during the run; every ambiguity becomes a flag on the proposal | The user asked for a service that runs on its own; the human step is review |

## 10. Changes after implementation (2026-11-21)

These points supersede earlier sections where they differ:
- **GDELT is off by default.** On 2026-11-21 it returned HTTP 429 even at 6–8 s spacing and empty results for Pune queries. It stays available as an opt-in source.
- **Versions record lineage in `provenance.json`** in each facts-dataset version folder, not in `processing.json`.
- **Attribution is tightened after the first live run:**
  - Only the `<article>` text is read (sidebars and footers are dropped).
  - Article-context attribution applies only when the page names a single project and the sentence is not national or network-wide.
  - Values from multiple projects or other phases are skipped.
  - Completion targets for parts of a project (some stations, ramps, phases) are ignored.
- **The confidence vocabulary matches the seed list:** official / corroborated / single_source / conflicting / unverified, plus `slipped`.
  - A planned date that has passed and has been replaced by a later one is *slipped*, not *conflicting*.
  - Two future dates that disagree are *conflicting*.
- **The seed baseline** (`seed-baseline`) loads `pune_project_facts.json` as the first reviewed version, recorded under the reviewer named at load time.
- **`add-evidence <url>`** adds a specific article that has left the RSS window, so it can corroborate a claim.
- **Golden evaluation:** 34 of 60 seed quotes reproduced, 0 wrong values.
