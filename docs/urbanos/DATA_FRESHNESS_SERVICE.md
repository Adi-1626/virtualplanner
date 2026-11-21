# Data freshness service: how to run it, and its limits

The data-freshness service keeps the facts about Pune's infrastructure projects current. Examples of such facts are
tunnel depth, length, station count, cost, number of tunnel boring machines (TBMs), tunnelling start, completion target
and status. It reads official pages and newspaper feeds and **proposes** changes, each with the exact sentence it came
from. A person reviews each proposal in the app. Only an approved and applied proposal becomes part of the dataset, as
a new version that can be rolled back.

The research behind every choice is in [DATA_FRESHNESS_RESEARCH.md](DATA_FRESHNESS_RESEARCH.md). The verified starting
list of facts is [PUNE_PROJECT_FACTS.md](PUNE_PROJECT_FACTS.md) (`pune_project_facts.json`).

---

## 1. What it does, in one picture

```
 python -m updater run          (a separate process: daily, or whenever you like)
   │  official pages (Maha-Metro …) + newspaper RSS feeds (HT, IE, TOI, Pune Mirror, Punekar News, …)
   │  robots.txt respected · at least 2 s between requests to one site · cached
   ▼
 sentences → facts ("Swargate–Katraj · tunnel depth · ~28 m", with the quote, link, publisher and date)
   ▼
 proposals: the same value from different sources is grouped; confidence is official / corroborated /
            single source / conflicting / unverified / slipped; compared with the current dataset
   ▼
 App → Reports → Data catalogue → "Fact updates"       (you)
   Approve / Reject (your name; a note is needed unless the fact is official or corroborated)
   "Apply N approved facts as a new version"  → dataset pune_infra_project_facts vN (registry)
   Roll back to any earlier version
   ▼
 Underground: hovering a metro tunnel shows "Depth not mapped in OSM · reported ~28 m below ground (sources … · not surveyed)"
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
| `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX` | Optional Google Custom Search plug-in. Only for existing customers; it stops working on 2027-01-01. | — |
| `UPDATER_LLM_URL`, `UPDATER_LLM_KEY`, `UPDATER_LLM_MODEL` | Optional LLM extractor (your own OpenAI-compatible endpoint). Off when unset. | — |

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
python -m updater seed-baseline --reviewer "Your Name"   # ONCE: load the verified fact list as the starting version
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
python -m updater seed-baseline --reviewer "Your Name"
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
| `add-evidence URL --reviewer NAME [--project id]` | Reads one page you found (for example a Maha-Metro press note), under the same rules. Nothing is typed in by hand. |
| `seed-baseline --reviewer NAME [--file …json]` | Loads `docs/urbanos/pune_project_facts.json` as the first real version. It is refused when the dataset already has facts. |
| `evaluate [--json out.json]` | An offline check of the extractor against the verified quotes. It exits 1 if any value is wrong. |
| `verify-audit` | Checks the hash chain of the audit log. |
| `purge-cache` | Deletes cached pages. |
| `check-config` | Validates the watch-list. |

### Scheduling
- **Windows Task Scheduler:**
  1. Create a basic task, trigger Daily, action Start a program.
  2. Program: `python`. Arguments: `-m updater run`. Start in: `C:\path\to\virtualplanner\backend`.
  3. Set the environment variables as system variables, or use a small `.bat` file containing the `set` lines above
     followed by `python -m updater run`.
- **cron (Linux):** `30 6 * * * cd /path/backend && DATABASE_URL=… URBANOS_DATA_DIR=… python -m updater run >> updater.log 2>&1`
- **Or `python -m updater serve --every 24h`** in a terminal that stays open.

Once a day is enough. Pune project news does not change faster, and a slow pace is fair to the publishers.

---

## 4. Reviewing in the app

**Reports → Data catalogue → Fact updates** (the third tab).

- **Set your name first:** Traffic data or Projects stores it as `td-user`. Every decision is recorded with that name.
- **Each card shows:**
  - the value and how it changes the dataset ("Changes the dataset: February 2029 → December 2030");
  - the confidence: *Official source*, *Corroborated (2 independent outlets)*, *Single source*, *Sources disagree*,
    *Not verified* or *Slipped (date passed)*;
  - "2 independent sources · 0 official";
  - a red warning when other sources give other values;
  - every quoted sentence, with the publisher, the kind of source (Official / Press / Other), the date and a link;
  - flags such as *Undated official page*, *Year inferred*, *Project named only in context*, *Old source* and
    *Official page may be out of date*.
- **Approve** needs a note unless the confidence is *Official* or *Corroborated*. Approving does **not** change the
  dataset yet. It also marks other values for the same fact as superseded.
- **Apply N approved facts as a new version** creates the next registry version of `pune_infra_project_facts` and
  activates it with your name. It then appears in the Datasets tab with its files, sha256 and lineage.
- **Versions → Roll back to vN** makes an earlier version active again. Proposals that were applied later show
  *Rolled back* and can be approved again.

---

## 5. How a fact reaches the app

- `GET /api/updater/facts` returns the **active** version only. The file's sha256 is checked against the registry
  every time it is read; an edited file is refused, and the app then shows nothing from it.
- **Underground:** when a reviewed fact has a tunnel depth for a project whose watch-list `osm_name_patterns` match an
  OpenStreetMap metro line, the hover tooltip reads:
  `Depth not mapped in OSM · reported ~28 m below ground (Hindustan Times 2026-08-21, Punekar News 2026-11-04 · 2 independent outlets · not surveyed)`.
  The 3D tunnel is still **not drawn at that depth**: a published figure is not a surveyed crown level.
  - OSM has no Swargate–Katraj line yet (checked 2026-11-21: the Overpass query near Katraj finds only the Purple, Aqua
    and Line 3 ways). So in today's app the path is visible on the **Purple Line**, whose seed fact is "up to 30 m"
    (maximum tunnel depth at Civil Court; Hindustan Times, 2019). The Swargate–Katraj depth will appear by itself once
    that line is mapped with "Katraj" in its name.
- **Other workspaces:** any feature can read `/api/updater/facts` (the TypeScript client is `frontend/src/lib/freshnessApi.ts`).
  Each fact carries `project_id`, `attribute`, `value_num` / `value_text`, `unit`, `qualifier`, `label`, `confidence`,
  its evidence, who approved it, and `certainty: reported` and `suitability: screening`.

---

## 6. The rules it follows

| Rule | How |
|---|---|
| **robots.txt** | Read once per site per run (RFC 9309, the same parser as the dataset update monitor). Disallowed means not fetched. Google News RSS is refused for this reason. |
| **Politeness** | At least 2 s between requests to one site (a larger robots Crawl-delay wins). At most 40 articles per run and 8 per site. A site that answers 401/403/429 is not asked again in that run. |
| **Identity** | User-Agent `UrbanOS-data-freshness/1.0 (+docs/urbanos/DATA_FRESHNESS_SERVICE.md)`. |
| **What is stored** | URL, publisher, title, publish date, retrieval time and the sha256 of the page; the quoted sentence (at most 400 characters). Full pages stay only in the cache, which you can purge. |
| **Source tiers** | 1 official (Maha-Metro, PIB, PMC, PMRDA, …), 2 reputable press (HT, IE, TOI, Pune Mirror, Punekar News, …), 3 other. The list is in `watchlist.json → publishers`. |
| **Corroborated** | At least 1 official source, **or** at least 2 independent tier-2 sources: different publishers, different wording, and not "as reported by …". Undated, old and tier-3 sources do not count. |
| **Slipped vs conflicting** | A planned date that has already passed and was replaced by a later date in newer reports is *slipped* (example: TBM start September 2026 → January 2027). Two future dates that disagree are *conflicting* (example: completion Feb 2029 vs Dec 2029 vs Dec 2030). |
| **Old sources** | Lengths, depths, costs and counts stay citable for 5 years; plans and status for 400 days. |
| **Undated official pages** | Read as "what the page showed on the retrieval date" and flagged. Official pages lag: Maha-Metro's Line 1B page says "three stations" in its text and **5** in its table, and both are shown. |
| **Human approval** | Approve and reject need a name. Apply writes a new immutable registry version. Rollback re-activates an earlier one. |
| **Audit** | `fu_audit` is append-only and hash-chained (`verify-audit`). Proposals and runs also appear in the app-wide audit log. |

---

## 7. Limits (please read)

- **It can still be wrong.**
  - Two newspapers can repeat the same wrong briefing.
  - An authority can change its plan.
  - A sentence about a neighbouring project can be attributed to the wrong one.
  - A publisher can mis-date its page.

  That is why every value needs a reviewer, and why facts are labelled *reported / screening*, never engineering levels.
- **It misses things.**
  - The extractor only understands the phrasings it was written for: 34 of 60 verified quotes reproduced, **0 wrong
    values** (`python -m updater evaluate`).
  - Tables in PDFs, Marathi text and figures spread over several sentences are not read.
  - A missed fact produces no proposal; it never changes the dataset.
- **Coverage depends on the feeds.**
  - RSS feeds show only the last 10–200 items, so an article older than the feed window is not discovered.
  - Use `add-evidence URL` for it. The live run of 2026-11-21 needed this for the August HT depth article.
- **Sources that do not work:**
  - Google News RSS: robots.txt disallows it, and its licence allows personal feed readers only.
  - mahatenders.gov.in: robots.txt disallows everything.
  - PMC pages: they return an empty page to non-browser clients.
  - Punekar News and metrorailnews.in: some pages answer 403.
  - GDELT: free and openly licensed, but it answered 429 and returned empty results for Pune queries from this machine,
    so it is **off by default**.
  - Google Custom Search: closed to new customers and ending on 2027-01-01, so it is off.
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
| `backend/updater/watchlist.json` | The 22 projects (ids from the seed list, aliases, tracked attributes, OSM name patterns), the sources and the publisher tiers |
| `backend/updater/__main__.py` | The command-line interface |
| `backend/updater/pipeline.py` | One run: sources → pages → claims → proposals |
| `backend/updater/fetch.py` | Fetching that follows robots.txt, waits between requests and caches |
| `backend/updater/sources.py` | Plug-ins: official_page, rss, gdelt, google_cse |
| `backend/updater/extract.py` | Deterministic extractors and project attribution |
| `backend/updater/proposals.py` | Grouping, corroboration, conflicts, slips, flags |
| `backend/updater/review.py` | approve / reject / apply / rollback / four-eyes |
| `backend/updater/facts.py` | Facts dataset versions in the registry; sha256-checked reading |
| `backend/updater/seed.py` | Seed baseline and golden evaluation |
| `backend/updater/llm.py` | The optional LLM extractor (guarded, off by default) |
| `backend/updater/audit.py` | The hash-chained audit log |
| `backend/updater/models.py` | The `fu_*` tables (additive) |
| `backend/api/updater_router.py` | `/api/updater/*` |
| `frontend/src/components/data/FactUpdatesPane.tsx`, `factUpdatesModel.ts` | The review queue UI |
| `frontend/src/engine/underground/reportedFacts.ts` | The reported depth in the Underground tooltip |
| `backend/tests/test_updater.py`, `backend/tests/fixtures/updater/` | 30 tests on stored copies of web pages (no network) |
| `frontend/src/engine/testing/FactUpdates.test.ts` | Vitest for the review card, the apply bar and the tooltip |

### API
`GET /api/updater/status` · `GET /api/updater/proposals?status=pending,approved&project=` ·
`POST /api/updater/proposals/{id}/approve|reject {reviewer, note}` · `POST /api/updater/apply {reviewer, note, activate}` ·
`POST /api/updater/versions/{id}/activate {reviewer}` · `POST /api/updater/rollback {version_id, reviewer}` ·
`GET /api/updater/facts[?project=]` · `GET /api/updater/versions` · `GET /api/updater/runs` · `GET /api/updater/audit`.
The API never fetches the web; only the CLI does.

---

## 9. Live check, 2026-11-21

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

## 10. Integration QA (next-phase), 2026-11-21

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
