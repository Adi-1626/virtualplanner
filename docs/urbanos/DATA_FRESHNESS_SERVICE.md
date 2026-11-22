# Data freshness service: how to run it, and its limits

The data-freshness service keeps the facts about Pune's infrastructure projects current. Examples of such facts are
tunnel depth, length, station count, cost, number of tunnel boring machines (TBMs), tunnelling start, completion target
and status. It reads **official pages and official feeds only** (government and agency sites) and **proposes** changes,
each with the exact sentence it came from. A person reviews each proposal in the app. Only an approved and applied
proposal becomes part of the dataset, as a new version that can be rolled back.

> **Official sources only (user rule, 2026-11-21):** *"dont get the dataset from news, unless it is from certified. We
> cannot get fake information into our data set and into the app. So please make sure it takes data from reliable sources
> only."* No newspaper, blog or aggregator can create a proposal or a value. The rule is code
> (`backend/updater/official.py`), not configuration; see §11. Sections 9 and 10 describe runs from before the rule.

The research behind every choice is in [DATA_FRESHNESS_RESEARCH.md](DATA_FRESHNESS_RESEARCH.md). The verified starting
list of facts is [PUNE_PROJECT_FACTS.md](PUNE_PROJECT_FACTS.md) (`pune_project_facts.json`).

---

## 1. What it does, in one picture

```
 python -m updater run          (a separate process: daily, or whenever you like)
   │  OFFICIAL pages and feeds only (Maha-Metro, PIB, PMRDA, …): the allow-list in updater/official.py
   │  any other URL (a newspaper story linked from an official feed, a redirect to another site) is skipped
   │  robots.txt respected · at least 2 s between requests to one site · cached
   ▼
 sentences / table rows → facts ("Swargate–Katraj · length · 5.46 km", with the quote, link, publisher and date)
   ▼
 proposals: the same value from different official sources is grouped; confidence is
            official / official_conflicting / slipped; compared with the current dataset
   ▼
 App → Reports → Data catalogue → "Fact updates"       (you)
   Approve / Reject (your name; a note is needed unless the fact is plain "official")
   "Apply N approved facts as a new version"  → dataset pune_infra_project_facts vN (registry)
   Roll back to any earlier version (never to one that holds non-official facts)
   ▼
 Underground: hovering a metro tunnel shows "Depth not mapped (no official figure)", or, once a reviewer has applied
 an official depth, "Depth not mapped in OSM · official ~X m below ground (agency date, site · official · not surveyed)"
```

Nothing is written to the dataset by the service itself. It writes only its own tables (`fu_*`) and an audit log.

---

## 2. Install (once)

The service is part of the backend and needs no new packages. Use the backend's normal environment:

```bash
cd backend
pip install -r requirements.txt
```

It uses the same settings as the app:

| Setting | Meaning | Example |
|---|---|---|
| `DATABASE_URL` | The app database. Proposals and the registry live here. | `sqlite:///./twincity.db` (the default when run from `backend/`) |
| `URBANOS_DATA_DIR` | Data folder. Fact versions are written to `derived/pune_infra_project_facts/vN/`, the page cache to `updater/cache/`. | `D:\urbanos-data` |
| `UPDATER_CACHE_DIR` | Optional. Where fetched pages are cached. | default `<data dir>/updater/cache` |
| `UPDATER_WATCHLIST` | Optional. Another watch-list file. | default `backend/updater/watchlist.json` |
| `UPDATER_SEED` | Optional. Another official fact list for `seed-baseline`. | default `docs/urbanos/pune_project_facts.json` |
| `UPDATER_LLM_URL`, `UPDATER_LLM_KEY`, `UPDATER_LLM_MODEL` | Optional LLM extractor (your own OpenAI-compatible endpoint). Off when unset. | — |

The Google Custom Search plug-in (`GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX`) was removed with news discovery on 2026-11-21 (§11); the code no longer reads those variables, so setting them does nothing.

**Try it on a copy of the database first.** Copy `twincity.db` to `twincity.copy.db` and set
`DATABASE_URL=sqlite:///./twincity.copy.db`.

---

## 3. Commands

### Linux / macOS (bash)
```bash
cd backend
export DATABASE_URL=sqlite:///./twincity.db
export URBANOS_DATA_DIR=/path/to/urbanos-data

python -m updater check-config                 # watch-list is valid
python -m updater seed-baseline --reviewer "Your Name"   # ONCE, empty dataset: load the official fact list as the starting version
python -m updater migrate-official-only --reviewer "Your Name"   # an EXISTING database: apply the official-only rule (§11)
python -m updater run --dry-run                # look, change nothing
python -m updater run                          # fetch and store proposals
python -m updater proposals                    # list pending proposals in the terminal
python -m updater status
```

### Windows (PowerShell)
```powershell
cd backend
$env:DATABASE_URL = "sqlite:///./twincity.db"
$env:URBANOS_DATA_DIR = "D:\urbanos-data"

python -m updater check-config
python -m updater seed-baseline --reviewer "Your Name"            # empty dataset only
python -m updater migrate-official-only --reviewer "Your Name"    # existing database (§11.4)
python -m updater run --dry-run
python -m updater run
python -m updater proposals
```

### Windows (Command Prompt)
```bat
cd backend
set DATABASE_URL=sqlite:///./twincity.db
set URBANOS_DATA_DIR=D:\urbanos-data
python -m updater run
```

### All commands

| Command | What it does |
|---|---|
| `run [--dry-run] [--only id,id] [--sources id,id] [--refresh] [--json report.json]` | One run. `--dry-run` rolls everything back (the page cache is kept). `--only` limits it to some projects, `--sources` to some sources. `--refresh` re-reads articles read in the last 30 days. |
| `serve [--every 24h]` | Runs again and again until you press Ctrl+C. The minimum interval is 1 h. |
| `proposals [--status pending\|approved\|all] [--project id]` | Lists proposals with their quotes and flags. |
| `approve ID --reviewer NAME [--note TEXT]` | Same as Approve in the app. |
| `reject ID --reviewer NAME [--note TEXT]` | Same as Reject in the app. |
| `apply --reviewer NAME [--note TEXT] [--no-activate]` | Writes all approved facts as a new version. `--no-activate` leaves it *pending review* so that a second person can activate it (four-eyes check). |
| `rollback VERSION_ID --reviewer NAME` | Makes an earlier version active again. |
| `versions` | The version history of the facts dataset. |
| `add-evidence URL --reviewer NAME [--project id]` | Reads one OFFICIAL page you found (for example a Maha-Metro press note), under the same rules. A URL that is not on the official allow-list is refused before any request. Nothing is typed in by hand. |
| `seed-baseline --reviewer NAME [--file …json]` | Loads `docs/urbanos/pune_project_facts.json` (official-only, dataset_version 2) as the first real version. It is refused when the dataset already has facts; use `migrate-official-only` then. |
| `migrate-official-only --reviewer NAME [--dry-run]` | Brings an existing database in line with the official-only rule: deletes stored news pages and their claims (recorded in the audit log first), rejects proposals left without official evidence, and registers a new facts version = the official seed list + every fact a reviewer applied from an official proposal. Running it twice changes nothing the second time. See §11.4. |
| `evaluate [--json out.json]` | An offline check of the extractor against the verified quotes. It exits 1 if any value is wrong. |
| `verify-audit` | Checks the hash chain of the audit log. |
| `purge-cache` | Deletes cached pages. |
| `check-config` | Validates the watch-list (every source must be official) and prints the official allow-list. |

### Scheduling
- **Windows Task Scheduler:**
  1. Create a basic task, trigger Daily, action Start a program.
  2. Program: `python`. Arguments: `-m updater run`. Start in: `C:\path\to\virtualplanner\backend`.
  3. Set the environment variables as system variables, or use a small `.bat` file containing the `set` lines above
     followed by `python -m updater run`.
- **cron (Linux):** `30 6 * * * cd /path/backend && DATABASE_URL=… URBANOS_DATA_DIR=… python -m updater run >> updater.log 2>&1`
- **Or `python -m updater serve --every 24h`** in a terminal that stays open.

Once a day is enough. Official pages do not change faster, and a slow pace is fair to the publishers.

---

## 4. Reviewing in the app

**Reports → Data catalogue → Fact updates** (the third tab).

- **Set your name first:** Traffic data or Projects stores it as `td-user`. Every decision is recorded with that name.
- **Each card shows:**
  - the value and how it changes the dataset ("Changes the dataset: February 2029 → December 2030");
  - the confidence: *Official source*, *Official sources disagree* or *Slipped (date passed)*;
  - "2 official sources" (distinct official sites stating the value);
  - a red warning when other official sources give other values;
  - every quoted sentence, with the publisher, "Official · <site>" (for example *Official · pib.gov.in*), the date and a
    link;
  - flags such as *Undated official page*, *Year inferred*, *Project named only in context*, *Old official source* and
    *Newer official value exists*.
- The pane lists only proposals whose every source is official. A proposal from before the rule is not listed; if one
  ever reached the browser it would show only "Not from an official source", with no quote and no buttons.
- **Approve** needs a note unless the confidence is *Official* (and the value was not found only by the optional LLM
  extractor). A proposal with any non-official evidence is refused with or without a note. Approving does **not** change
  the dataset yet. It also marks other values for the same fact as superseded.
- **Apply N approved facts as a new version** creates the next registry version of `pune_infra_project_facts` and
  activates it with your name. It then appears in the Datasets tab with its files, sha256 and lineage.
- **Versions → Roll back to vN** makes an earlier version active again. Proposals that were applied later show
  *Rolled back* and can be approved again. A version that holds non-official facts (written before the rule) cannot be
  activated again.
- When the active version still holds non-official facts (a database not yet migrated), the pane says how many are
  hidden and names the command that replaces the version.

---

## 5. How a fact reaches the app

- `GET /api/updater/facts` returns the **active** version only. The file's sha256 is checked against the registry
  every time it is read; an edited file is refused, and the app then shows nothing from it. A fact whose evidence is not
  entirely official (a version written before the rule) is **withheld**: it is not returned, and `withheld` lists it.
- **Underground:** a metro tunnel that OSM maps with no depth shows **"Depth not mapped (no official figure)"**; an
  underground station shows "Depth not mapped (no official figure in the dataset)". Only when a reviewer has applied an
  official tunnel depth for a project whose watch-list `osm_name_patterns` match the line does the tooltip read
  `Depth not mapped in OSM · official ~X m below ground (Maha-Metro 2026-…, punemetrorail.org · official · not surveyed)`.
  The 3D tunnel is still **not drawn at that depth**: a published figure is not a surveyed crown level. The browser checks
  the evidence again (`frontend/src/lib/officialSources.ts`) and ignores a fact with any non-official source.
  - Today no official source states a tunnel depth for any Pune line (checked 2026-11-21), so every metro tunnel shows
    "Depth not mapped (no official figure)". The news-reported Swargate–Katraj "~28 m" and the 2019 "up to 30 m" for the
    Purple Line are no longer in the dataset (PUNE_PROJECT_FACTS.md, "Not in the dataset: unofficial reports").
- **Other workspaces:** any feature can read `/api/updater/facts` (the TypeScript client is `frontend/src/lib/freshnessApi.ts`).
  Each fact carries `project_id`, `attribute`, `value_num` / `value_text`, `unit`, `qualifier`, `label`, `confidence`,
  its evidence (official sites only), who approved it, and `certainty: reported` and `suitability: screening`.

---

## 6. The rules it follows

| Rule | How |
|---|---|
| **Official sources only** | `backend/updater/official.py` (code, not config): any site under gov.in or nic.in, plus punemetrorail.org, mahametro.org, sansad.in and msrdc.in. Checked at fetch (candidate and redirect target), ingest, proposal creation, approve, apply, version registration, activation/rollback and read. News, blogs, aggregators and contractors' press releases never qualify. |
| **robots.txt** | Read once per site per run (RFC 9309, the same parser as the dataset update monitor). Disallowed means not fetched. |
| **Politeness** | At least 2 s between requests to one site (a larger robots Crawl-delay wins). At most 40 articles per run and 8 per site. A site that answers 401/403/429 is not asked again in that run. |
| **Identity** | User-Agent `UrbanOS-data-freshness/1.0 (+docs/urbanos/DATA_FRESHNESS_SERVICE.md)`. |
| **What is stored** | URL, publisher, title, publish date, retrieval time and the sha256 of the page; the quoted sentence (at most 400 characters). Full pages stay only in the cache, which you can purge. |
| **Confidence** | *official*: stated by the responsible agency or Parliament, no other official value competes. *official_conflicting*: two official sources disagree; both are shown. *slipped*: an official planned date that has passed and was replaced by a later official date. Corroboration by news no longer exists. |
| **Slipped vs conflicting** | A planned date that has already passed and was replaced by a later official date is *slipped*. Two official dates that are both still in the future and disagree are *conflicting* (example: Line 1B completion September 2028, Maha-Metro brochure 2026, vs February 2029, Union Cabinet 2024). |
| **Old sources** | An old official source still counts and is flagged *Old official source* (lengths, depths, costs and counts after 5 years; plans and status after 400 days). |
| **Undated official pages** | Read as "what the page showed on the retrieval date" and flagged. Official pages lag: Maha-Metro's Line 1B page says "three stations" in its text and **5** in its table, and both are shown. |
| **Human approval** | Approve and reject need a name. Apply writes a new immutable registry version. Rollback re-activates an earlier one. |
| **Audit** | `fu_audit` is append-only and hash-chained (`verify-audit`). Proposals and runs also appear in the app-wide audit log. |

---

## 7. Limits (please read)

- **It can still be wrong.**
  - An official page can be out of date, and two official sources can disagree (both are shown).
  - An authority can change its plan.
  - A sentence about a neighbouring project can be attributed to the wrong one.
  - A publisher can mis-date its page.

  That is why every value needs a reviewer, and why facts are labelled *reported / screening*, never engineering levels.
- **It misses things, by design more than before.**
  - Figures that only newspapers report (for example the Swargate–Katraj tunnel depth and TBM start) are not captured at
    all. The tooltip then says "no official figure". This is the intended trade-off: unknown is shown as unknown.
  - The extractor only understands the phrasings it was written for: 13 of 26 official seed quotes reproduced, **0 wrong
    values** (`python -m updater evaluate`; before the rule it was 34 of 60 on mixed news and official quotes).
  - Tables in PDFs, Marathi text and figures spread over several sentences are not read.
  - A missed fact produces no proposal; it never changes the dataset.
- **Coverage depends on the official sources.**
  - Maha-Metro publishes press releases as PDFs with no feed; the PIB feed returned Hindi titles (off); PMRDA's feed is
    mostly tenders. Use `add-evidence URL` for an official press note, Lok Sabha / Rajya Sabha reply or sanction letter.
- **Sources that do not work:**
  - mahatenders.gov.in: robots.txt disallows everything.
  - PMC pages: they return an empty page to non-browser clients.
- **Removed on 2026-11-21 (official-only rule):** the newspaper RSS feeds (Hindustan Times, Times of India, Indian
  Express, Pune Mirror, Punekar News, The Metro Rail Guy, Prime Time 24), the GDELT news index and the Google Custom
  Search plug-in. Their code is gone; `config.validate` refuses any source that is not official.
- **Status words are coarse.** Only approved, awarded, under construction and operational are recognised, and only
  when the project is named in the same sentence.
- **Projects that combine two lines.** Line 2A/2B and Line 4/4A are each one project in the seed list, so a length for
  one arm shows up as a conflicting length for the combined project.
- **It does not change geometry.** New alignments still come from Design or from OpenStreetMap.
- **The dataset is for internal use.** Quotes are short excerpts kept for verification; the licence caveats for
  PMC/OpenCity data apply here too.

---

## 8. Files

| Path | What |
|---|---|
| `backend/updater/official.py` | **The official-only rule**: the allow-list (gov.in, nic.in + four verified agency domains) and the checks every gate calls |
| `backend/updater/migrate.py` | `migrate-official-only` for an existing database |
| `backend/updater/watchlist.json` | The 22 projects (ids from the seed list, aliases, tracked attributes, OSM name patterns), the official sources and their display names |
| `backend/updater/__main__.py` | The command-line interface |
| `backend/updater/pipeline.py` | One run: sources → pages → claims → proposals |
| `backend/updater/fetch.py` | Fetching that follows robots.txt, waits between requests and caches |
| `backend/updater/sources.py` | Plug-ins: official_page, rss (official feeds; links off the allow-list are dropped) |
| `backend/updater/extract.py` | Deterministic extractors and project attribution |
| `backend/updater/proposals.py` | Grouping, official-source counting, conflicts, slips, flags; rejects pre-rule non-official proposals |
| `backend/updater/review.py` | approve / reject / apply / rollback / four-eyes |
| `backend/updater/facts.py` | Facts dataset versions in the registry; sha256-checked reading |
| `backend/updater/seed.py` | Seed baseline and golden evaluation |
| `backend/updater/llm.py` | The optional LLM extractor (guarded, off by default) |
| `backend/updater/audit.py` | The hash-chained audit log |
| `backend/updater/models.py` | The `fu_*` tables (additive) |
| `backend/api/updater_router.py` | `/api/updater/*` |
| `frontend/src/components/data/FactUpdatesPane.tsx`, `factUpdatesModel.ts` | The review queue UI |
| `frontend/src/engine/underground/reportedFacts.ts` | The official depth (or "no official figure") in the Underground tooltip |
| `frontend/src/lib/officialSources.ts` | The UI mirror of the allow-list (a backend test checks it names the same domains) |
| `backend/tests/test_updater.py`, `backend/tests/fixtures/updater/` | 92 tests on stored copies of web pages (no network). The newspaper fixtures are kept only to prove they are refused |
| `frontend/src/engine/testing/FactUpdates.test.ts` | Vitest for the allow-list mirror, the review card, the apply bar and the tooltip |

### API
`GET /api/updater/status` (includes `official_rule` and `facts.withheld`) · `GET /api/updater/proposals?status=pending,approved&project=` (official proposals only; `include_unofficial=true` for audit) ·
`POST /api/updater/proposals/{id}/approve|reject {reviewer, note}` · `POST /api/updater/apply {reviewer, note, activate}` ·
`POST /api/updater/versions/{id}/activate {reviewer}` · `POST /api/updater/rollback {version_id, reviewer}` ·
`GET /api/updater/facts[?project=]` · `GET /api/updater/versions` · `GET /api/updater/runs` · `GET /api/updater/audit`.
The API never fetches the web; only the CLI does.

---

## 9. Live check, 2026-11-21 (before the official-only rule; historical)

> Superseded by §11. The news-based results below (the ~28 m "corroborated" depth, the Line 3 figures from IE and
> Punekar News) are no longer possible: those sources are refused and the values are not in the dataset.

Run against the live sites on a **copy** of the database, with the seed list loaded as the baseline.

- **Volume.** One run (official pages + 7 feeds): 33 requests, 17 pages read, 30 claims, 19 proposals, 0 errors,
  about 70 s.
- **Swargate–Katraj tunnel depth (`add-evidence`, using the HT and Punekar News article URLs):**
  - **~28 m: Corroborated, 2 independent / 0 official.** Sources: Hindustan Times 2026-08-21 "The TBMs will operate at
    a depth of around 28 metres below ground level." and Punekar News 2026-11-04 "The machines will operate at a depth
    of around 28 metres below ground level."
  - Prime Time 24 also says it, but it is tier 3 and does not count.
- **Swargate–Katraj station count:** Maha-Metro's project-profile table says **3** and its Line 1B page table says
  **5**. Both are official, so the proposal shows *Sources disagree*, against the dataset's 5.
- **Line 3:**
  - Length 23.3 km (Punekar News + IE) vs 23.203 km (IE). They disagree at the stated precision, and both are shown.
  - Cost ₹8,300 crore (IE) vs ₹8,313 crore in the dataset.
  - Completion January 2027 vs December 2026 (the second is for two stations).
- **The run fed back into the code (commit a2709bd and the commits before it).** These false proposals were removed:
  - national metro statistics and a sidebar headline attributed to Line 3;
  - "Purple Line's 5.46 km extension" given to Line 1;
  - "Phase 1's 3.3 km section" given to Line 1B.

---

## 10. Integration QA (next-phase), 2026-11-21 (before the official-only rule; historical)

> The review-flow fixes below still hold. The data used (news proposals, the "up to 30 m" Purple Line tooltip) does not:
> see §11.

Branch `next-phase` = main `9e56ccc` + `env-refine` + `data-updater` (both merged cleanly). Tested on a **copy** of the
database, with a separate data folder for the fact versions; the original `twincity.db` was never opened by the app.

**Gates on the merged tree:** `tsc -p tsconfig.app.json` 0 errors · oxlint 0 errors (8 warnings) · vite build OK ·
full vitest (`--maxWorkers=1`) **105 files passed, 6 skipped; 870 tests passed, 7 skipped** (868 before the fixes) · full backend pytest **355 passed, 3 skipped** (354 before the fixes). No merge-induced failure.

**Set-up used:** `python -m updater seed-baseline` (v2, 48 mapped facts) and one run on the recorded test pages
(`backend/tests/fixtures/updater`, no network): 11 proposals for Swargate–Katraj, among them **~28 m, Corroborated,
2 independent / 0 official** (Hindustan Times 2026-08-21, Pune Times Mirror 2026-11-04), and conflicts on stations
(3 vs 5) and completion (Feb 2029 / Dec 2029 / Dec 2030).

**Browser (headless Chromium, real clicks):**

| Check | Result |
|---|---|
| Fact updates layout: intro, last run, apply bar, project group, cards | Pass |
| Card: quote, source link, tier (Press / Official), corroboration count, conflict warning, flags | Pass |
| Reject with a note | Pass (stored with reviewer and note; leaves the queue) |
| Approve → Apply → v3 → Roll back to v2 | Pass |
| Approve the rolled-back proposal again → Apply → v4 | **Failed, fixed** (see below) → Pass |
| Empty state | Pass ("Nothing to review") |
| Backend down | **Misleading, fixed** → now only "Could not load the review queue … Last run unknown" |
| Underground: hover the Purple Line tunnel | Pass: "Depth not mapped in OSM · reported up to 30 m below ground (Hindustan Times 2019-12-24 · single source · not surveyed)" |
| Environment smoke: get-started, essentials, trees for a new 458 m road | Pass (47 trees, 168 with margin, 0.6 s) |
| Underground smoke: cutaway window, look from below, check conflicts | Pass (1.9 s; 7 Requires investigation, 4 Insufficient data) |
| Design smoke: draw a road | Pass |
| Console errors / 5xx | 0 / 0 (apart from the intended connection-refused errors in the backend-down test) |

**Fixed (commits `456fa61`, `a0fcd73`):**
- A rolled-back proposal disappeared from the queue (the app asked only for pending and approved), although §4 says it
  "shows Rolled back and can be approved again". It is now listed, with Approve and Reject.
- Approving a rolled-back proposal again did nothing useful: it kept its old version id, so Apply said "nothing to
  apply". Approving now puts it back in the apply queue (the old version stays in the registry and the audit log).
- With the backend down the pane said "The service has not run yet", "no version yet" and "Nothing to review". It now
  says only that the queue could not be loaded.
- Version notes showed registry ids ("superseded by dsv_6ad9…"); they now name the version ("superseded by v3").
- `GET /api/updater/proposals?status=all` filtered on the literal word "all" and returned nothing; it now means no
  filter, as in the CLI.
- Apply no longer looks up a proposal with an empty id for seed facts (SQLAlchemy warning).

**Open:**
- When a version is superseded, the registry overwrites its "reviewed by" with the person who superseded it, so the
  version list no longer shows who approved the old version (shared `datasets/registry.py`; the audit log still has it).
- `add-evidence` for the Punekar News TBM article finds the ~28 m depth only with `--project
  pune_metro_line_1b_swargate_katraj` (the sentence names "the machines", not the project). Without it the depth stays
  single-source. §9 should say the flag was used.
- The pane shows the browser's raw "Failed to fetch" text in the backend-down message.
- In Underground, an area imported with Study area adds OSM metro objects to the scenario, so a check lists the same
  Purple Line twice ("… Purple Line" and "… Purple Line (OSM)"). This was there before the merge.

---

## 11. Official sources only (2026-11-21)

The user's rule, verbatim: *"dont get the dataset from news, unless it is from certified. We cannot get fake information
into our data set and into the app. So please make sure it takes data from reliable sources only."* Decisions and the
domain verification are in [DATA_FRESHNESS_RESEARCH.md §11](DATA_FRESHNESS_RESEARCH.md#11-official-sources-only-2026-11-21--decisions).

### 11.1 What counts as official

`backend/updater/official.py` (code; the watch-list cannot change it):
- any site under **gov.in** or **nic.in** (PIB, MoHUA, MoRTH, NHAI, PMO, PMRDA, PMC, PCMC, the Maharashtra government,
  Gazette, CAG, NGT, courts, the old Lok Sabha / Rajya Sabha sites);
- **punemetrorail.org** and **mahametro.org** (Maha-Metro), **sansad.in** (Parliament), **msrdc.in** (MSRDC).

Nothing else: no newspaper, blog, aggregator, search engine or contractor's press release. `python -m updater
check-config` prints the rule.

### 11.2 What changed

- **Sources:** the seven news feeds (HT, TOI, IE, Pune Mirror, Punekar News, The Metro Rail Guy, Prime Time 24), GDELT
  and Google Custom Search are gone, code included. Watched now: Maha-Metro's project profile and Line 1B page, the PMRDA
  feed (on); Maha-Metro's project-update page and the PIB feed (present, off, as before).
- **News leads:** not kept, not even as an optional to-check list (research §11.3).
- **Enforcement:** at the watch-list, discovery, fetch (including redirects), ingest, `add-evidence`, proposal
  creation, approve, apply, version registration, activation / rollback, read (`withheld`), the proposals API and the
  browser (research §11.2).
- **Confidence:** `official` · `official_conflicting` · `slipped`. A note is needed to approve anything but a plain
  `official` value.
- **Dataset:** `pune_project_facts.json` is dataset_version 2, official only (108 records, 7 attributes with no official
  figure); the seed baseline maps 29 official facts (48 before). The news values are recorded only in
  PUNE_PROJECT_FACTS.md, section "Not in the dataset: unofficial reports".
- **App:** the Underground metro tooltip says **"Depth not mapped (no official figure)"** (stations: "… (no official
  figure in the dataset)"); the Fact updates pane shows "Official · <site>" for each quote and only official proposals;
  the station editor no longer quotes the 2019 newspaper station depths; the metro NOC rule cites Maha-Metro's own
  public notice (15/04/2026) instead of a newspaper.

### 11.3 How the app loads the facts

`docs/urbanos/pune_project_facts.json` is not read by the frontend. `seed-baseline` (empty dataset) or
`migrate-official-only` (existing database) converts its records into facts and registers them as a version of
`pune_infra_project_facts` (files under `<derived dir>/pune_infra_project_facts/vN/`); the app reads only the active
version through `GET /api/updater/facts`, which verifies the file's sha256 and withholds any non-official fact. The
Underground tooltip and any other feature use that endpoint.

### 11.4 Migration note for an existing database (Windows)

Your `twincity.db` still holds what the old service stored: newspaper pages, their quotes, proposals built on them, and
an active facts version that includes news values (for example the ~28 m Swargate–Katraj depth). Until you migrate, the
app already **hides** those facts (they are withheld at read) and the review pane does not list news proposals, but the
rows are still in the database. Migrate once:

```powershell
cd C:\path\to\virtualplanner
git pull                                   # the new code and docs\urbanos\pune_project_facts.json (dataset_version 2)
cd backend
Copy-Item .\twincity.db .\twincity.before-official-only.db       # backup first
$env:DATABASE_URL = "sqlite:///./twincity.db"
$env:URBANOS_DATA_DIR = "D:\urbanos-data"                         # the same folder the app uses
python -m updater migrate-official-only --reviewer "Your Name" --dry-run   # shows what it would do; saves nothing
python -m updater migrate-official-only --reviewer "Your Name"
python -m updater status        # facts: version vN · 29 facts … and no WITHHELD line
python -m updater versions
python -m updater verify-audit
```

Command Prompt: use `copy twincity.db twincity.before-official-only.db` and `set DATABASE_URL=sqlite:///./twincity.db`
/ `set URBANOS_DATA_DIR=D:\urbanos-data` instead of the `$env:` lines.

What it does (it fetches nothing from the web):
1. Deletes the stored non-official pages and their extracted claims from `fu_documents` / `fu_claims`, after writing
   their URLs and quote hashes to the audit log (`purge_unofficial`).
2. Re-evaluates every proposal; one left with no official evidence becomes *rejected* by "system (official-only rule)"
   (an applied news proposal included).
3. Registers and activates a **new** facts version: the official seed list plus every fact you applied earlier from an
   official proposal. Older versions stay in the registry for the record but can no longer be activated.
4. Replaces the news citation of the `metro_noc_20m` coordination rule with Maha-Metro's notice, unless you edited it.

Running it again changes nothing ("facts: none"). The backend does not need a restart; reload the browser tab so the
Underground tooltip fetches the new facts. If you prefer to keep the old database untouched, run the commands on a copy
and point `DATABASE_URL` at the copy. The dry run on the QA copy (a database written by the old code: v4 active with 48
facts, 26 of them news-based, one applied news proposal) reported: *deleted 6 non-official pages and 12 claims; rejected
1 proposal; facts: registered v5 (29 official facts); NOC rule citation replaced*. The second run: *nothing to do*.
