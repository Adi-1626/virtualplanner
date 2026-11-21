# Underground Planning: user guide

UrbanOS · updated 2026-11-15 · for planners and engineers at PMC, Maha-Metro, PMRDA, utility owners and consultants.

This guide covers what the Underground workspace does today, button by button. Technical background is in
[UNDERGROUND_CHECKS.md](UNDERGROUND_CHECKS.md) (how the conflict check works),
[UNDERGROUND_AUDIT.md](UNDERGROUND_AUDIT.md) (first-time-user audit and fixes) and
[UNDERGROUND_RESEARCH.md](UNDERGROUND_RESEARCH.md) (the standards and sources behind every number). Developer notes are in
the [appendix](#appendix--developer-notes).

> **Read this first.** Underground produces an **automated screening, not an engineering assessment**. It never says
> "safe", "clear", "passed" or "construction-ready". It checks a proposal against the records UrbanOS holds, and for Pune
> those records are incomplete: there is no water, power, gas or telecom network data, and sewer levels have no stated
> datum. A result that flags nothing only means *nothing was found in the data listed*. Utility owners, Maha-Metro and a
> qualified engineer must confirm before any work.

---

## 1. What Underground is for

Use it in the early planning of anything that goes below ground: a metro or road tunnel, a cut-and-cover box, a storm
drain, a sewer, a water main, a cable or gas line. It answers three questions:

1. **What is already recorded underground here?** By layer (sewers, storm drains, water, power, gas, telecom,
   boreholes, foundations), with how many records there are and how reliable they are, and with the layers that UrbanOS has
   *no data for*, named as such.
2. **Where would my proposal sit?** You draw it in plan and give it a depth and a size. You can then see it in 3D under
   the ground, on a long-section (Profile) and on a Cross-section.
3. **What should be investigated before it goes further?** The conflict check compares the proposal with the existing
   records, the metro, building footprints, nallas and rivers, groundwater wells and boreholes. It reports each case with
   one of four statuses and a next investigation step that follows the Indian sequence (owner as-builts → Call Before u Dig
   → GPR survey → trial pits → Maha-Metro NOC → boreholes → specialist).

It does **not** design a structure, model geology between boreholes, assess settlement or check an owner's own internal
standard.

## 2. Getting there

- **From the workspace rail:** click **Underground** (third icon, `Alt+3`). The Design tools stay available (same Build
  mode). Your alternative and its objects are the same as in Design.
- **From Design:** select an underground alignment and, in the inspector, click **Long-section, sections & conflicts →**.
  Underground opens on that alignment with the Profile tab open.
- **Leaving** Underground puts the ground back exactly as it was (opacity, see-through area, depth testing).

If the alternative has nothing underground yet, a **Get started** card offers three actions:
*See existing records in this view*, *Draw a proposed tunnel or metro*, *Lay a proposed pipe or cable*.

All depths in Underground are **metres below ground, positive downwards**.

## 3. The panel, top to bottom

| Section | What it is for |
|---|---|
| **Undo / Redo** and **Check conflicts** | Undo or redo any edit (also `Ctrl+Z` / `Ctrl+Y`). *Check conflicts* scrolls to the check; it appears once something is drawn. |
| **Drawing a proposed alignment / Laying a proposed utility** | Shown only while you draw: the drawing hint, the tool settings and **Stop drawing**. |
| **View** | Ground see-through, X-ray, camera depth, *Look from below*, *Back to surface*, and the **Legend**. See §5. |
| **Proposed alignments** | Your tunnels, metro, cut-and-cover boxes, utility trunks and storm drains: type, length, depth summary, a certainty badge. Click one to open it, fly to it and open the drawer. **Draw another** adds one. |
| **Check for conflicts** | The screening (§8). |
| **Edit · *name*** | The editor of the open alignment (§6.3). There is one editing place per alignment: in Underground it is this panel; the Design inspector only shows a section sketch and points here. |
| **Already recorded here** | What existing records are in the work area, per layer (§4). |
| **Utilities drawn in this alternative** | Your drawn pipes and cables: type, status, top-of-pipe depth (with *default — adjust* when a depth is still the typical-cover default) and a certainty badge. Click one to select it and fly there. |
| Footnote | Which ground the depths are measured from (§5.4). |

## 4. Reading "Already recorded here"

The records listed are for the **work area**: records within 250 m (plan distance) of a line you have drawn, or, if you have drawn nothing,
the area on the map. Click **Look here** (or *See existing records in this view* on the Get started card) to list the
area currently on the map. A very wide or oblique view is narrowed to the point the camera looks at; if that is still too
wide you are asked to zoom in.

There is one line per layer:

- **"N here"**: the number of records of that layer in the area, followed by their quality level (QL-A to QL-D, *QL ?*
  if not stated) and how many have a recorded depth. For PMC sewers the line says the levels are published design depths
  below the manhole top, **with no stated vertical datum, unverified**.
- **"None recorded in this area"**: the dataset exists, but has no record here. The dataset's coverage is not stated,
  so this is **Unknown, not "none"**.
- **"Not available"**: UrbanOS holds no dataset of this kind at all, so the layer is **Unknown everywhere**. The line says
  who would hold it, e.g. *PMC water supply GIS*, *MSEDCL / Tata Power cable records*, *MNGL CGD network*, *operators via the
  Call Before u Dig (CBuD) portal*, *PMC building-permission (basement levels)*.
- Under each available layer, a one-line **source** (publisher, licence in short) with **details**. Expand it to see the
  full licence, the stated coverage, who imported it, the file checksum and any warnings.

**List the N records here** opens the record list (first 200; up to 4,000 are drawn on the map). Each row shows the
depth, diameter, owner, QL chip and depth certainty. Click a row to fly to it. Only QL-A means a measured depth.

**Import records (AGS4 / CSV / JSON)** adds boreholes or utility records from a file. Give your name, and, if you know
them, the publisher, licence, data date and **stated coverage** (W,S,E,N in degrees). Without a stated coverage, the
absence of a record can never be read as "nothing there". The file's checksum and your provenance details are stored
with the dataset.

> Records show where a utility *was recorded*, not that nothing else is there. Before construction: owner as-builts, a
> GPR survey and trial pits.

## 5. Views

### 5.1 See-through ground

- **Ground opacity** (0–100 %, 35 % by default): how solid the ground is.
- **See-through only around the work area** (default): the ground is see-through only around your drawn objects (or,
  with nothing drawn, around the listed records). The rest of the city stays solid, so the surface, buildings and roads
  stay lined up above what you are looking at. Tick **See-through everywhere** to make the whole ground see-through.
- **X-ray**: draws buried objects through the ground everywhere (forces the ground to at most 50 % opaque).

### 5.2 Camera below ground

- **Camera depth readout**: *Camera 420 m above ground* or, in orange, *Camera 8 m below ground*.
- **Look from below** puts the camera 8 m below ground, looking along the work area.
- **Back to surface** brings the camera back to an oblique view above the work area. It is highlighted while the camera
  is below ground.

### 5.3 Legend: how objects are drawn

- **Line style = status:** solid = existing (records), dashed = proposed, dotted = conceptual, long dashes = abandoned
  in place.
- **Colour = type:** sewers, storm-water drains, water, power, gas, telecom (see the Legend in the panel).
- **Paler = less certain:** records only (QL-D), or user-drawn.
- **No depth, no guess:** a record with no depth is drawn on the surface, not at an assumed depth. A tunnel stretch whose
  depth is Unknown is a dashed line on the surface; a tunnel with an unknown size is a dashed line at crown depth.
- A drawn pipe also has a plan trace just above the ground, so you can find it from above.

### 5.4 Which ground each view uses

| View | Ground | Notes |
|---|---|---|
| 3D map | Cesium World Terrain when a terrain service is available, otherwise **flat** (the panel says which) | Every buried object is drawn at its typed depth below the 3D ground directly above each point. |
| Profile, Cross-section, editor elevations | **Copernicus GLO-30 DSM v3** (m EGM2008) | A surface model: it **includes roofs and trees**, accuracy ±2–4 m. "Below ground" can therefore be measured from a rooftop. Screening only. Where the DSM does not cover a point, ground is **Unknown**. |

At each point the depth is the same number in both views; only the shape of the ground differs.

## 6. Drawing and editing

### 6.1 Drawing a tunnel (or metro, cut-and-cover box, utility trunk, storm drain)

1. Click **Draw a proposed tunnel or metro** (or **Draw** / **Draw another**).
2. In the tool settings choose the **Alignment type**, the **Cross-section** (circular: outer diameter; box: width ×
   height), a **Crown depth** and how certain the depth and section are.
3. Click plan points on the map; double-click (or press Enter) to finish; Esc cancels.
4. When you finish, the editor of the new alignment opens.

**What the defaults mean.** Each type pre-fills a crown depth and section so that you can draw quickly: bored tunnel /
underground metro 15 m, Ø 6 m; cut-and-cover 3 m, 10 × 7 m box; utility trunk 4 m, Ø 2 m; storm drain 2 m, 2 × 1.5 m box.
These are **drawing placeholders, not standards**, and are stored as *hypothetical*. Replace them with your design
values.

### 6.2 Laying a pipe or cable

1. Click **Lay a proposed pipe or cable** (Get started card, or *Lay a pipe or cable* under *Utilities drawn in this
   alternative*).
2. In the tool settings choose the **Utility type**, the **Top of pipe** depth (m), the **Diameter** (mm) and how
   certain the depth is.
3. Click points along the line; double-click (or Enter) to finish; Esc cancels. The new line is selected and its editor
   opens.

**Blank depth = typical-cover default.** If you leave the depth blank, every point gets the usual minimum cover for the
type, measured to the top of the pipe. It is stored as **"default — adjust"** and treated as hypothetical, never as
measured:

| Type | Default cover to top of pipe | From |
|---|---|---|
| Water | 1.0 m | IRC:98-2024 draft §3.3.3 (trunk 1–6 m, service 0.6–1 m); ≥ 0.6 m in a road trench §3.3.1 |
| Sewer | 1.0 m | CPHEEO sewerage manual Ch. 3 (excerpt, unverified) |
| Electrical | 0.9 m | IS 1255 §6.3.2: 0.9 m for 3.3–11 kV (LV 0.75 m, 22–33 kV 1.05 m) |
| Gas | 1.0 m | PNGRB T4S Table 3 / Sch. 1D |
| Fibre / telecom | 0.6 m | IRC:98-2024 draft §3.3.1/§3.3.3 |

A blank diameter is stored as **Unknown**, not 0.

### 6.3 Editing a tunnel

Open it from *Proposed alignments*. The **Edit · *name*** section has:

- **Alignment type** and **Status**: *Proposed*, *Conceptual / illustrative*, or *Existing (entered from records)*.
  An alignment marked Existing is treated by the conflict check as something proposals are checked against.
- **Cross-section** (shape and size; blank = Unknown) and its certainty.
- **Depth reference**: which ground model the elevations come from (the DSM, with its caveat), or "Ground level
  UNKNOWN here".
- **Set all depths**: one crown depth for every point.
- **Per-point table**: chainage and grade to the next point (+ = getting deeper), **crown depth** (blank = Unknown), the
  crown elevation it gives in m EGM2008 (ground − depth), and the certainty (measured / estimated / hypothetical).

### 6.4 Editing a pipe or cable

Select it (on the map or in *Utilities drawn in this alternative*). Its editor is in the inspector:

- **Status**: *Proposed*, *Conceptual / illustrative*, *Existing (in service)*, *Abandoned in place*. Status decides how
  it is drawn and how the conflict check treats it (§8.1).
- **Evidence**: how its position is known. *User-drawn (no quality level)*, *QL-D records only*, *QL-C records + surface
  features*, *QL-B geophysically designated*, *QL-A surveyed / exposed (test pit)*, or *Unknown*. Status and evidence are
  separate. For example, an existing pipe you drew from an as-built drawing is *Existing* + *QL-D*.
- **Type** and **Diameter (mm)**.
- **Depths are measured to**: *Top of pipe (crown)* (default, because cover rules are set to the top of the pipe),
  *Centre line*, or *Invert (bottom of bore)* (PMC sewer records publish inverts). With centre or invert, the top of the
  pipe needs the diameter; without it the top is shown as Unknown.
- A summary: plan length, top-of-pipe range, bottom (invert) range, and how many depths are still defaults.
- **Depth reference**, **Set all depths**, and a **per-point table** (depth, elevation in m EGM2008, certainty), as for a
  tunnel.

Utilities saved before per-point depths existed show a note: they are read from their single depth until you edit them.

### 6.5 Rules that apply everywhere

- **Blank = Unknown.** An Unknown depth is never 0, never guessed, and never interpolated across. It is shown as "?" on
  the Profile.
- Between two known points the depth varies in a straight line.
- Every edit is one Undo step. Edits in an alternative do not change the base city.

## 7. The drawer tabs

The bottom drawer has four tabs.

- **Profile**: the long-section of the open alignment, or of the selected pipe (then labelled *depth = top of pipe*).
  It shows the DSM ground line on an elevation axis (m EGM2008), the crown-to-invert band for each run of known depths
  (dashed when hypothetical), a "?" at each Unknown point, the least crown depth below the DSM per run (and a warning if a
  straight grade between two points would rise above the DSM), PMC sewer crossings with their published invert (purple
  ○: design/unverified, QL-D, no datum), and a marker for every object crossed in plan. A dotted marker means that
  object's depth is **Unknown** in the model (road structure, pier foundations and basements are not modelled). The
  vertical scale is exaggerated. Click to set the cross-section chainage.
- **Cross-section**: the section at the chosen chainage (slider), with your structure and the objects the section line
  cuts. "Structure position UNKNOWN here" appears where its depth or size is missing. Horizontal and vertical scales differ.
- **Utility table**: every drawn utility with name, type, status, evidence, top of pipe (m below ground; *default —
  adjust* where it applies), diameter, length and depth certainty. Click a row to fly to it.
- **Subsurface evidence** (for the open alignment): groundwater wells within the search radius (NWDP, CGWB / GSDA
  manual readings: latest depth to water, date, a history sparkline; point observations, not interpolated), imported
  boreholes nearby (or **"No borehole records — required: site investigation"**), SoilGrids topsoil properties every
  ~250 m (Unknown in urban cells), and PMC sewers crossing or near the alignment with their published inverts and
  invert-below-DSM. Missing evidence is shown as Unknown.

## 8. Running a conflict check

### 8.1 What is checked against what

- **Proposals**: drawn tunnels and utilities whose status is *Proposed* or *Conceptual*, wherever they were drawn (a
  proposal drawn in the base city is checked in every alternative). Objects with no recorded status (older drawings) count
  as proposals when they belong to the alternative you are in; in the base city every drawn tunnel or utility counts.
  The button shows the count: **Check N proposed objects**.
- **What they are checked against**:
  - drawn objects marked *Existing* or *Abandoned in place*. An abandoned pipe is still in the ground, so it is an
    obstacle.
  - PMC sewer and storm-drain records and any imported records;
  - OpenStreetMap metro (tunnels, viaducts, stations) and drawn metro;
  - building footprints, PMC nallas and rivers, NWDP groundwater wells (3 km) and imported boreholes (500 m);
  - the other proposals (each pair once).

### 8.2 Running it

Click **Check N proposed objects** (later **Check again**). A typical check takes a few seconds. The result shows:

1. The **banner**: *Automated screening — not an engineering assessment*.
2. A one-sentence **summary** in plain words.
3. **Show findings for**: all proposed objects, or one of them.
4. **Status badges** with counts. Click a badge to show only that status.
5. **Findings**, most serious first. Click a finding to fly the camera there; the proposal is highlighted in magenta and
   the other asset (or the buildings) in amber.
6. **What was checked for *object***: the object's checklist. A check that flagged nothing reads **"nothing found in
   the available data"**. That is a checklist entry, never a pass.
7. **What wasn't checked**, always visible. Examples: water, power, gas and telecom (no dataset), vertical clearance to
   PMC sewers (no datum), metro tunnel and pier levels, building foundations, real ground levels, owners' standards,
   settlement and structural adequacy.
8. **Data used** (each layer with record count, quality level and datum) and **Clearance rules (by asset pair)**.

### 8.3 The four statuses

| Status | What it means | What to do |
|---|---|---|
| **Potential conflict** | With the data as recorded, the two assets are closer than the rule allows, or they overlap (or a rule about which goes on top is broken, e.g. water must be above sewer). | Confirm the existing asset's position on site before redesigning. |
| **Requires investigation** | Close to a limit within the data's accuracy, inside the **Maha-Metro 20 m zone** (NOC required), a case with **no Indian numeric rule** (e.g. tunnel next to a utility: specialist), or a cover, groundwater or nalla/river flag. | Another authority or a specialist must look at it. |
| **Insufficient data** | Something needed is missing (depth, datum, size, or no records at all for a network), so nothing can be concluded. **This is not a pass.** | Get the missing data (see the next-investigation steps). |
| **Verified** | A person recorded field evidence (QL-A) for this pair, and neither asset has changed since. **Never set by the software.** | Keep the evidence reference; re-verify if either asset changes. |

### 8.4 Inside a finding

Every finding has the same five parts:

- **Checked**: what was compared.
- **Data used**: datasets with their quality level and datum.
- **Found**: the numbers in metres (plan distance edge to edge, depths where they meet, vertical gap), the requirement
  with every rule cited, and how much was added for data uncertainty. It also notes where a depth used is a
  typical-cover default, or where the other asset is abandoned in place.
- **Not checked**: what this finding could not cover.
- **Next investigation**: the steps in order.

**Rules applied** lists the clauses. **Record field verification…** is described in §8.8.

### 8.5 Grouped data gaps

Insufficient-data findings are grouped by their **shared reason**, one line per reason, for example *"PMC sewer network:
levels have no stated datum"*, *"No water supply, electricity, gas (CGD) or telecom records in this area"*, or *a
proposed object without depth*. Each line gives the count (e.g. "501 crossings or near passes · 21 proposed objects").
Open a line to see each place.

### 8.6 Report (PDF / Word / CSV)

**PDF report**, **Word (DOCX)** and **Findings CSV** re-run the check on the objects as they are now and download
(file names carry the time in IST):

- **PDF**: header (alternative, date in IST, engine and rules versions, the banner on every page), counts with what each
  status means, the full findings, Insufficient data as one table per reason, rules applied with sources, data used,
  what was not checked, and the next-investigation plan in the Indian order.
- **Word (DOCX)**: the same content as the PDF, editable.
- **CSV** (opens in Excel): one row per finding with all five parts, the numbers and the location.

### 8.7 Saved runs and "Stale"

Every check is saved per alternative (the newest 20 are kept). When you come back to the alternative, the panel shows
**"Last saved check, *date*"**. If something changed since, it is marked **Stale**, with the reason: *objects in this
alternative changed*, *utility records were imported or changed*, or *the screening engine changed*. Editing after a
check also marks it stale. Click **Check again** for current results.

### 8.8 Recording a verification (the only way to "Verified")

Open a clearance or metro finding and click **Record field verification…**. Choose the method (**trial pit**,
**vacuum excavation** or **survey of exposed asset**), describe the evidence (what was seen, record reference) and give
your name. It is saved with an audit entry. On the next check that pair shows **Verified** until either asset changes,
after which the finding says *re-verify*. Only use this for evidence seen in the field.

### 8.9 Sharing with a planning project (optional)

**Share *alignment* with a planning project** registers the open alignment as a proposal element of a project in
Projects. Other projects' coordination checks can then see it.

## 9. How data accuracy is taken into account

Each threshold is widened by the positional uncertainty of both assets. This uncertainty comes from the evidence (ASCE 38
quality level):

| Evidence | Added horizontally | Vertical level usable? |
|---|---|---|
| QL-A (exposed / surveyed) | 0.05 m | yes (0.03 m) |
| QL-B (geophysics) | 0.3 m | no |
| QL-C (records + surface features) | 1.0 m | no |
| QL-D (records only), Unknown | 3.0 m | no |
| User-drawn existing object | 3.0 m (treated like QL-D) | only if every depth used is marked *measured* (then 0.3 m) |
| Your proposal (proposed / conceptual) | 0 | yes: it is the design intent |

A drawn **proposal** is screened as what you intend to build, so "user-drawn" adds no uncertainty to it (a quality level
set on a proposal is ignored and noted). A drawn **existing** pipe has no survey behind it unless you give its QL.

When a level is not usable (QL-B/C/D, or PMC sewer levels with no datum), the vertical gap is shown as "relative only,
vertical not checkable". A pair within the horizontal limit then becomes Insufficient data rather than being judged on
an unreliable level. A footprint of unknown width (storm drains, OSM metro) is assumed to extend 1.0 m either side of its
centreline. The check looks for assets within 50 m of each proposal.

## 10. Data sources and their limits

| Data | What it is | Limits |
|---|---|---|
| PMC sewer network (44,482 lines, OpenCity) | Pipe lines with published design levels | **QL-D**, records only; levels are design values **without a stated vertical datum** (relative only, vertical clearance not checkable); coverage not stated. |
| PMC storm-water drains (9,187 lines, OpenCity) | Drain lines | QL-D; **no depth or width**. |
| Imported records (AGS4 / CSV / JSON) | Whatever you import | As good as the file. Coverage only counts if you state it. |
| Copernicus GLO-30 DSM v3 | Ground for the Profile, Cross-section and elevations (m EGM2008) | **A surface model, not bare earth: includes roofs and trees**, ±2–4 m. Real cover is unknown until a levels survey. |
| OpenStreetMap metro | Metro lines, tunnels, viaducts, stations in plan | **Depth not mapped**: Pune stations are tagged without a level. Used in plan only (20 m zone); tunnel and pier levels are not checked. |
| Building footprints (OSM + Microsoft + Google) | Footprints near the proposal | Foundation, basement and pile depths are in no dataset: always Insufficient data, with the nearby buildings listed. |
| PMC nallas and rivers | Watercourses in plan | Plan only (QL-D). |
| NWDP groundwater wells (CGWB / GSDA) | Manual depth-to-water readings | Point observations, seasonal, not interpolated. |
| SoilGrids 2.0 | Topsoil predictions at 250 m | Not a geological model; urban cells often Unknown. |
| **Missing entirely** | Water supply, power, gas, telecom networks; building foundations and basements; borehole logs (none in the registry) | Every check against them is **Insufficient data**. Who holds them: PMC water supply, MSEDCL / Tata Power, MNGL, operators via CBuD, PMC building permissions, Maha-Metro / PMC site investigations. |

PMC / OpenCity, IMD, AutoDCR and Bhuvan-derived data are for internal, non-commercial use with attribution. Do not
redistribute them.

## 11. Standards and rules used

Rules live in one table (shown in the result under *Clearance rules*). Each rule carries its value, direction
(horizontal, vertical or 3D), its source clause and its type: **normative**, **draft guideline**, **rule of thumb**,
**international (comparison only)** or **no Indian norm**. Where two sources differ, the stricter value is used and both
are cited. Breaking a normative minimum gives *Potential conflict*; breaking a guideline or rule of thumb gives *Requires
investigation*.

| Rule | Value used | Source (see UNDERGROUND_RESEARCH.md) |
|---|---|---|
| Water × sewer / storm drain | 3.0 m horizontal or 1.0 m vertical, water above | CPHEEO Water Supply Manual 2024 §12.9.1–12.9.2 (normative, S12); IRC:98-2024 **draft** §3.2.3 / §3.3.3 (S14) |
| Power cable × water | 1.0 m horizontal and vertical | IS 1255:1983 §6.3.3 (0.3 m, S16); IRC:98-2024 draft (1.0 m) |
| Power × telecom | 1.0 m, power below | IS 1255 (0.3 m); IRC draft (1.0 m) |
| Gas × other services | 0.3 m vertical (gas below), 0.3 m horizontal; 3 m to buildings | PNGRB CGD T4S Regulations, consolidated 23-12-2024 (S15) |
| Tunnel × tunnel | 1 × larger diameter (specialist) | Maha-Metro Swargate–Katraj DPR, rule of thumb (S17) |
| Tunnel × anything else | **No Indian numeric clearance**: 1 × diameter is a referral distance for a specialist, not a clearance; only a physical clash is a Potential conflict | Research finding (no norm found) |
| Any other pair | 0.3 m 3D (rule of thumb) | No code value found |
| Metro protection zone | **20 m** from the edge of a metro structure → Requires investigation, **Maha-Metro NOC** (a permission trigger, not an engineering clearance) | UDCPR 2020 cl. 14.2.1.7 (S20); Pune Metro public notice (S21) |
| Minimum cover | Gas 1.0 m (PNGRB T4S Table 3); power 0.75 m LV, 1.05 m when the voltage is unknown (IS 1255 §6.3.2); sewer 1.0 m, storm 0.5 m (CPHEEO Sewerage Manual 2013, excerpt, S13); water, telecom and other 0.6 m (IRC:98-2024 draft §3.3.1); bored tunnel 2 × diameter (DPR, rule of thumb) | as listed; cover is measured from the DSM ground (see §5.4) |
| Positional uncertainty | QL-A..D tolerances (§9) | ASCE 38-22 quality levels (S3, S4); ASCE 75-22 accuracy levels (S5, S6, partly unverified); FHWA Subsurface Utility Engineering (S1, S2) |
| Next-investigation order | as-builts → CBuD → GPR (QL-B) → trial pits (QL-A) → Maha-Metro NOC → boreholes → specialist | FHWA SUE (S1, S2); DoT Call Before u Dig (S24); PMC GPR requirement (S25) |

Caveats: **IRC:98-2024 is a draft** (IRC:98-2011 is the published edition). The CPHEEO sewerage values and all metro
depth figures come from excerpts only. The ASCE 75-22 table is from a draft and a state DOT specification. Owners'
own standards (PMC, MSEDCL, MNGL, Maha-Metro) may be stricter and are not checked.

## 12. Glossary

- **Crown / top of pipe**: the highest point of a pipe or tunnel. **Invert**: the lowest inside point (bottom of bore).
- **Cover**: depth from ground to the crown.
- **Chainage**: distance along the alignment from its first point.
- **QL-A … QL-D** (ASCE 38): how a utility's position is known. A = exposed and surveyed; B = geophysics (GPR); C =
  records plus visible surface features; D = records only.
- **DSM**: digital surface model (includes roofs and trees). **DTM**: bare-earth terrain (not available here).
- **EGM2008**: the height reference used for elevations ("m EGM2008").
- **NOC**: no-objection certificate. **CBuD**: DoT *Call Before u Dig* portal. **GPR**: ground-penetrating radar.

---

## Appendix — developer notes

- **Code:** `frontend/src/shell/contexts/UndergroundContext*.tsx` (panel, drawer tabs, runtime),
  `frontend/src/components/underground/*` (AlignmentForms, UtilityForms, ViewControls, SubsurfaceRecords,
  SectionViews, ElevationProfile, SubsurfaceEvidence, ConflictCheck, conflictClasses, screeningGroups, stores),
  `frontend/src/engine/underground/*` (UndergroundView = globe translucency state and restore; UndergroundRenderer;
  alignmentGeometry / alignmentFactory; utilityModel = utility Z model; groundModels; recordsSummary; metroLevel;
  sectionLayout; terrainProfile; viewRect). Backend: `backend/coordination/{screening, screening_config,
  screening_report, screening_runs, service, subsurface, pmc_import}.py`, `backend/terrain/evidence.py`.
- **APIs:** `POST /api/coordination/underground/screen`, `…/screen/report?format=pdf|docx|csv`,
  `POST …/underground/runs/latest`, `GET …/underground/runs`, `POST …/underground/verifications`; subsurface
  datasets / records / import under `/api/coordination`; DSM samples and evidence under `/api/terrain`.
- **Data model:** alignments store per-vertex `depths[{crownDepthM, certainty}]`, a section and `lifecycle`. Utilities
  store per-vertex `depths[{depthM, certainty, isDefault, topDepthM, elevationM, groundM, groundModel}]`, `zRef`,
  `status`, `evidence`, plus the derived legacy `depth` / `depthCertainty`. The screening engine reads the per-vertex
  model and falls back to the legacy fields for older objects (UNDERGROUND_CHECKS.md §2.1).
- **How the check works, rule table, numbers and tests:** [UNDERGROUND_CHECKS.md](UNDERGROUND_CHECKS.md).
- **Audit, walkthrough and open issues:** [UNDERGROUND_AUDIT.md](UNDERGROUND_AUDIT.md).
- **Ground and evidence data:** [TERRAIN_AND_SUBSURFACE_DATA.md](TERRAIN_AND_SUBSURFACE_DATA.md),
  [COORDINATION_AND_SUBSURFACE.md](COORDINATION_AND_SUBSURFACE.md).
- **Tests:** `backend/tests/test_underground_screening*.py`, `frontend/src/engine/testing/Underground*.test.ts`.
- **Known limits of the tool itself:** the 3D globe has no terrain without a Cesium ion token (flat ground, labelled);
  vertex depths are edited in the tables, not by dragging; plan vertices are changed by redrawing; the phone layout of the
  Underground panels has not been checked.
