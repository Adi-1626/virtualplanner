# Projects workspace — user guide

For city planners at PMC, PMRDA, MahaMetro, MNGL, MSEDCL and other agencies who use UrbanOS (Pune digital twin) to manage
planning projects and coordinate them with each other. Last updated 2026-11-21 (branch `projects-refine`).

What it is **not**: nothing in this workspace approves, permits or clears anything. A conflict check is a screening of the data
in the tool; a recorded decision is "a planning decision recorded in this tool", never a statutory approval. Depths, widths
and facts that are not known are shown as **UNKNOWN**, never as 0. Facts about Pune projects come only from official sources;
nothing is taken from news reports.

## 1. Words used

| Word | Meaning |
|---|---|
| Project | One planning activity (a flyover, a drainage upgrade, a metro extension). It collects alternatives, elements, checks, assessments and decisions. |
| Alternative | A proposal drawn in **Design** (a scenario). A project attaches one or more; one can be marked ★ preferred (a working flag, not a decision). |
| Proposal element | One work of the project that the conflict check compares: a road, a flyover, a tunnel, a utility, a building … with its plan geometry, width and depth range (metres relative to ground, up positive). |
| Conflict check | Compares this project's elements with other agencies' projects and the city data (see §5). |
| Finding | One result of a check: *Conflict*, *Potential conflict*, *Vertically separated*, *Unknown – no data coverage*, or *No conflict within available data* (not proof of no conflict). |
| Stale | An input changed after the check or assessment was made; run it again. *Stale: unknown* means the inputs were not recorded, so it cannot be told — not that it is current. |

## 2. First steps

1. **Projects** in the left rail. Enter **your name** at the top: it is recorded with every change (it is not verified).
   Without a name the workspace is read-only and says so.
2. **New planning project** (or *Create your first project* on the *Get started* card, shown until you have a project under
   your name, even when other agencies' projects are listed; *Hide* removes it): a name, the planning question it answers
   (purpose) and, optionally, a study area. The project notes the current base city, so a later change to it is flagged.
3. Open the project. The **Next steps** card on *Overview* ticks what is done and has a *Go* link for the next step:
   - attach the alternative you drew in Design (*Alternatives* tab);
   - add its proposal elements (*Add proposal elements* on the alternative);
   - run the conflict check (*Conflicts* tab);
   - export the report or the conflict summary (*Overview → Report*, or **Reports**).

## 3. The project list

- One card per project: status, study area, creator, date, number of alternatives and elements, **open conflicts** (conflict and
  potential conflict with status *Open*) and a *Stale* badge when the latest check is out of date. A project nobody has checked
  shows **conflicts: not checked** — never "0 open conflicts".
- With more than six projects the list has a **search** (name, study area, person), a **status** filter and a **sort**
  (newest, name, most open conflicts). The list is read in one request, so it stays quick with many projects.

## 4. Inside a project

| Tab | What you do there |
|---|---|
| **Overview** | Purpose, *Edit* (name, purpose, study area), *Next steps*, metric tiles (click to jump), status (*Draft / Under study / Under review*; *Decision recorded* is set only by recording a decision), report PDF / DOCX, all linked records (attach or detach any alternative, version, run, traffic dataset, feasibility screening), **Delete project**. |
| **Alternatives** | Attach an alternative (the base city is not offered: it is what every alternative is compared with); ★ preferred; *Open & compare in Design*; **Add proposal elements** — one checkbox per drawn work (all ticked to start) with its kind and depth range; untick a work you do not want in the project (it stays a drawing of the alternative, which the check still compares — see §5); the basis is under *Technical details*; elements list with *Show on map* and *Remove* (the alternative itself is not changed). |
| **Assessments** | Feasibility screenings (+ investigation documents), traffic model runs (they fail validation, TAG M3.1, and say so), conflict checks — each with its stale badge. |
| **Datasets** | Traffic datasets with provenance; subsurface datasets imported for the project (coverage UNKNOWN unless stated). |
| **Conflicts** | Run the check; findings grouped by class (15 per class, *Show all N* for more); respond (see §6). |
| **Reviews & decisions** | Append-only decision record (every decision says *Statutory approval: No*); reviews of the attached screenings. |
| **Activity** | Who did what, newest first: created, edited, attached, elements added, checks run, responses, exports, decisions. The individual finding rows written by each check are not listed one by one (the check is); their number is stated. |

### Adding proposal elements from a drawing

| Drawn object | Element | Depth range used |
|---|---|---|
| Road | road | top 0 m; pavement depth UNKNOWN |
| Flyover / double-deck | flyover | underside = design elevation; deck thickness, piers, foundations UNKNOWN |
| Metro line / station | metro viaduct / station | design elevation (+ height for a station) |
| **Tunnel / underground alignment** | tunnel, metro tunnel, utility or drainage (by its kind) | **per point**: top = −crown depth, bottom = −(crown + section height); the per-point profile is stored with the element. A point without a crown depth or an unknown section leaves that bound UNKNOWN. |
| **Utility** | utility | **per point** from the depths entered in Underground (to the top, centre or invert of the pipe) and the diameter; a typical-cover default counts as *hypothetical* and is named. A depth that is only a drawing placeholder stays UNKNOWN. |
| Building | building | top = height; foundation UNKNOWN |
| Zone, gateway, junction edit, removal | not added | not physical works |

Values from a drawing are design values (*hypothetical*), not surveys.

Example: an alternative holds a storm-water tunnel, a water main and an 11 kV cable. Tick the tunnel and the water main, untick
the cable: the project gets two elements; the cable is still checked as an object *drawn in Design* in an attached alternative
(the finding says "Objects drawn in Design: … 11 kV cable"), but it is not one of the project's works.

## 5. What the conflict check compares

This project's elements against:

- other projects' **elements** (another agency's drawing is seen only once it is added to their project);
- objects **drawn in Design** in the base city and in **every alternative attached to this project** — tunnels, utilities,
  metro — even when they were not added as elements;
- existing roads of the base city;
- **OpenStreetMap metro** from the local index. A metro line that a study-area import copied into the base city is the same OSM
  line: it is listed **once** (as OpenStreetMap metro). OSM maps a line as several ways (e.g. both bores of the Purple Line): one
  finding per named line and element, saying how many pieces were within reach;
- building footprints (OSM observed; Microsoft / Google ML inferred);
- utility records (PMC sewer / storm-drain records, ASCE 38 QL-D; their levels are design levels, unverified).

Plan distances are measured in UTM 43N; depths are compared separately. A depth or width that is UNKNOWN gives *Potential
conflict*, never "clear". The **metro NOC trigger** (20 m on either side of the edge of the Metro Rail: UDCPR 2020 cl. 14.2.1.7, and Maha-Metro Public
Notice 9549/2026 of 15.04.2026, which applies it to construction, excavation, geotechnical investigations, borewells and utility
laying near viaducts, stations and tunnels) says when a Maha-Metro NOC is needed; it is a permission distance, not an
engineering clearance. The tool measures it from the mapped centreline, not from the structure's edge.

A check is **stale** when, since it ran, this project's elements changed, an attached alternative was edited or another one was
attached, another project changed, the base city, clearance rules, subsurface records, the OSM or building index changed, or the
detection engine changed.

## 6. Working with another agency

- A finding between two projects appears in **both** projects ("Shared with project …"), **once**, even when both agencies ran the
  check. The other project's element is named ("Project "Water supply 2030": 600 mm main").
- **Respond** → *Acknowledge*, *Resolve* or *Reopen*, with a required note (e.g. "trial pit requested"). A response records a
  person's note; it does not change the finding, either project or any approval. If the other agency responded on their copy
  after your check, their response is shown.
- If the other project is deleted, its findings say "a deleted project"; run your check again to refresh.

## 7. Editing and deleting a project

- **Edit** (Overview): name, purpose, study area. Recorded in Activity; alternatives, elements and findings are not changed.
- **Delete this project…** (bottom of Overview): type the project's name to confirm. Deletes the project, its elements, its
  attachments and its own conflict checks with their findings. The alternatives, runs, datasets and screenings it linked to are
  kept; other projects keep their findings against it; Activity keeps the history.
- A project with a **recorded decision cannot be deleted**: decisions are append-only.

## 8. Export to Reports

- *Overview → Report*: project report PDF / DOCX (summary, baseline, datasets with provenance, alternatives and versions, runs,
  feasibility findings with certainty, reviews, decisions, unknowns, audit summary).
- *Conflicts → Conflict summary CSV*: every finding visible to the project with class, distances (empty = UNKNOWN), certainty,
  permission triggers, response and stale verdict.
- The report has a section **Proposal elements and conflict check**: the elements with their depth range, the latest check and
  whether it is stale, the number of findings per class, and the newest conflict / potential-conflict findings (the full list is
  the CSV). Findings raised by another project's check are included.
- **Reports** workspace lists every project with its inputs, the export buttons and when each was last generated. Every export is
  recorded in Activity (as "No name recorded" if no name was entered).

Activity rows show the name only; hover it to see where the name came from (typed in *Your name*, written on the record, or the
traffic-data change log). No name is verified.

Not to be confused with **Your drawn works**, the right-hand panel in Explore: it lists the objects drawn in the open alternative,
not planning projects.

## 9. Known limits

- Names are self-declared; there is no sign-in. *Get started* recognises your projects by the name you typed.
- A drawing that no project has added as elements is checked only for the projects that attach its alternative.
- The status of a finding is per check; a new check carries a response forward only for the same pair with the same class.
- Comparing alternatives inside a project and locking an alternative under review are not built.
- Pune metro tunnel and viaduct levels are not in OSM, so every finding against the metro is at best *Potential conflict*.
