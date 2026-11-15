# Underground Mode — research → practical requirements (Pune)

Research-only input for the Underground Mode redesign. 2026-11-15. (Copied into the repository from the research work area; user guide: [UNDERGROUND_WORKSPACE.md](UNDERGROUND_WORKSPACE.md).) Every number below carries its source and a type:
**N** = normative (a regulation/standard/manual clause that an authority actually applies), **G** = guideline / draft guideline,
**R** = rule of thumb / project-specific value (one project's design figure, a typical practice), **I** = international reference.
Values are for **screening only**; the product must never present them as approval criteria.

---

## 1. Sources (✔ = opened and extracted from; [UNVERIFIED] = only a search summary/excerpt seen)

| # | Source | URL | Status |
|---|---|---|---|
| S1 | FHWA — Subsurface Utility Engineering (QL-A..D definitions, risk framing) | https://www.fhwa.dot.gov/programadmin/sueindex.cfm | ✔ |
| S2 | FHWA EDC-8 — SUE practices (map at QL, conflicts, condition, design-around, communicate) | https://www.fhwa.dot.gov/innovation/everydaycounts/edc_8/subsurface_utility_engineering.cfm | ✔ |
| S3 | ASCE 38-22 update deck (TxDOT Utility Week 2023): QL-B tolerance 60 mm, QL-A 30 mm vertical; attribute + metadata lists; "areas unable to be investigated" | https://www.txdot.gov/content/dam/docs/division/row/utility-week-2023/12-14-23/day3-pm-2-wes-kaisershot-asce-38-22-sue-standard-updates.pdf | ✔ (summary deck, not the standard) |
| S4 | ASCE 38-22 abstract (adds utility attributes and depth recording guidance) | https://ascelibrary.org/doi/book/10.1061/9780784415870 | [UNVERIFIED] |
| S5 | ASCE 75 white paper (2018 pre-ballot draft): accuracy levels, feature types, mandatory attributes, status domain, metadata, sensitivity | http://dl.icdst.org/pdfs/files4/c4de24090160bcdfc454b508d3d5e173.pdf | ✔ (draft, not final 75-22) |
| S6 | Final ASCE 75-22 accuracy levels 1–5 = 25/50/100/300/1000 mm, 0 = undefined (Iowa DOT DS-23045; NCHRP 20-07/418) | https://ia.iowadot.gov/specifications/ds/2023/DS-23045.pdf | [UNVERIFIED] |
| S7 | OGC CityGML 3.0 Part 1 Conceptual Model (Tunnel module, Construction module, `relativeToTerrain` enum incl. `entirelyBelowTerrain`) | https://docs.ogc.org/is/20-010/20-010.html | ✔ |
| S8 | OGC CityGML standard page (3.0 = information model; JSON/DB encodings allowed; ADEs) | https://www.ogc.org/standards/citygml/ | ✔ |
| S9 | CityGML Utility Network ADE (dual topographic+topological representation, FeatureGraph, commodity) | https://github.com/tum-gis/citygml3-utility-network-ade ; https://www.asg.ed.tum.de/en/gis/projects/citygml-utility-network-ade | [UNVERIFIED] |
| S10 | OGC 3D Tiles | https://www.ogc.org/standards/3DTiles/ | not opened (known: hierarchical LOD streaming; Cesium native) |
| S11 | PostGIS Special Functions Index (ST_3DDistance, ST_3DDWithin, ST_3DIntersects, ST_3DClosestPoint, ST_3DDFullyWithin, ST_3DExtent; SFCGAL CG_3DIntersects/CG_3DBuffer for solids) | https://postgis.net/docs/en/PostGIS_Special_Functions_Index.html | ✔ |
| S12 | CPHEEO Manual on Water Supply & Treatment Systems (Drink from Tap), Part A, Mar 2024, Ch.12 §12.9 | https://www.civilapps.in/files/Technical%20Publications/CPHEE/Part-A-Engineering/12-Service%20Reservoirs%20-%20Distribution%20System.pdf (official: https://mohua.gov.in/upload/uploadfiles/files/Manual-on-Water-Supply-and-Treatment-Systems-Drink-from-Tap-Part-A-Engineering.pdf) | ✔ (chapter copy) |
| S13 | CPHEEO Manual on Sewerage & Sewage Treatment 2013, Ch.3: min cover 1 m sanitary, 0.5 m storm; sewers encased if near water supply | https://phedharyana.gov.in/WriteReadData/WSSO/Manuals/manual_on_sewerage_and_sewage_treatment_%20edition_CPHEEO_2012.pdf | [UNVERIFIED] (excerpt; download timed out) |
| S14 | IRC:98-2024 **draft** third revision, Guidelines on Accommodation of Utility Services on Roads in Urban Areas | https://cdnc.heyzine.com/files/uploaded/20ac93cd57d27de95be942963ed63c37be5134e5-2.pdf | ✔ (draft; IRC:98-2011 is the published edition — values 2011 depth table seen only via excerpt) |
| S15 | PNGRB T4S CGD Regulations, consolidated post-amendment 23-12-2024 | https://pngrb.gov.in/OurRegulation/PNGRB%20Regulations/A.%20CGD%20Network/A.4.%20CGD%20T4S%20Regulations/20241223-CGD-T4S-Post-Amendment.pdf | ✔ (a 18-09-2026 consolidation exists; not opened) |
| S16 | IS 1255:1983 Installation & maintenance of power cables ≤33 kV, §6.3.2–6.3.3 | https://archive.org/stream/gov.in.is.1255.1983/is.1255.1983_djvu.txt | ✔ |
| S17 | Maha-Metro Swargate–Katraj Revised Final DPR (21-12-2022) | https://www.punemetrorail.org/download/Swargate-Katraj%20DPR.pdf | ✔ |
| S18 | Maha-Metro press release, tunnel segments (OD 6.35 m, ID 5.8 m, 275 mm) May 2026 | https://punemetrorail.org/download/PR-Casting%20work%20pune%20.pdf | [UNVERIFIED] |
| S19 | Pune Line-1 UG: station depths (Civil Court 28 m, Budhwar Peth 25, Mandai 20, Swargate 22, Agri College 18), max tunnel depth 30 m (HT 2019); TBM Ø6.61 m (Tunnelling Online 2020); tunnels ~19 m below Mutha riverbed (MetroRailGuy 2024) | hindustantimes.com/…/story-QqB4i5EWqbfWMRVVz1a0jO.html ; tunnelingonline.com/terratec-tbms-break-through-on-pune-metro | [UNVERIFIED] |
| S20 | UDCPR 2020 cl. 14.2.1.7 (Metro NOC within 20 m either side of edge of Metro Rail) | https://citiwise.in/udcpr/14-2-1-7 (official PDF linked there) | ✔ (secondary rendering of clause text) |
| S21 | Pune Metro public notice / Indian Express Apr 2026: NOC also for borewells, geotech investigation, utility laying within 20 m of tunnels | https://www.punemetrorail.org/download/PUBLIC-NOTICE-ENGLISH.pdf ; https://indianexpress.com/article/cities/pune/noc-mandatory-pune-metro-warns-of-action-over-borewell-drilling-near-tunnels-10641841/ | [UNVERIFIED] (PDF is image-only) |
| S22 | Chennai Metro NOC: 50 m from centre of alignment | https://chennaimetrorail.org/wp-content/uploads/2023/11/NOC-policy-guidelines.pdf | [UNVERIFIED] |
| S23 | CGWB Pune district brochure: Deccan Trap basalt; pre-monsoon DTW 0.90–30.35 m bgl, post-monsoon GL–25.2 m bgl (2017) | https://cgwb.gov.in/sites/default/files/2022-11/pune_f.pdf | [UNVERIFIED] (download failed) |
| S24 | DoT Call Before u Dig (CBuD): connects excavators ↔ asset owners; contact/notification only | https://cbud.gov.in/faq ; https://eservices.dot.gov.in/cbud | [UNVERIFIED] |
| S25 | PMC: no unified underground utility map (TOI Oct 2026); GPR mandatory before road works (HT/IE Apr 2026); ICCC mapping ~2,000 km, ~120 sewer–water contact spots | timesofindia…/134974854.cms ; hindustantimes…101775499268585.html ; infra.economictimes…/131114725 | [UNVERIFIED] |
| S26 | Esri 3D Workflows — Utilities (ground transparency, underground navigation, slice tool excluding utilities, local scenes, invert/rim attribute → 3D) | https://doc.arcgis.com/en/3d/workflows/visualization/utility-layers.htm | ✔ |
| S27 | Autodesk Civil 3D 2027 — Pipe network interference + 3D proximity check (distance or scale-factor buffer; interference objects listed) | https://help.autodesk.com/cloudhelp/2027/ENG/Civil3D-UserGuide/files/GUID-B7947549-4D31-476F-BC1C-880397DF20C6.htm | ✔ |
| S28 | CesiumJS GlobeTranslucency (front/back face alpha, alpha by distance, `rectangle` to limit translucency to an area) | https://cesium.com/learn/cesiumjs/ref-doc/GlobeTranslucency.html | ✔ |
| S29 | Repo doc TERRAIN_AND_SUBSURFACE_DATA.md (what our Pune data actually is) | [TERRAIN_AND_SUBSURFACE_DATA.md](TERRAIN_AND_SUBSURFACE_DATA.md) | ✔ |

Not researched (out of time; flag, don't invent): Bentley OpenUtilities/SUE, VUEWorks, ArcGIS Indoors, RDSO/MRTS tunnel code text, CEA safety regs, IS 3114 / IS 1239, GSI Pune geology map, PMC GIS portal content.

---

## 2. Data model requirements

### 2.1 Common attributes (every underground object) — from ASCE 75 (S5) + ASCE 38-22 (S3)
| Attribute | Required? | Notes |
|---|---|---|
| `id`, `name` | yes | stable id; documents/photos link by id (S5) |
| `asset_type` | yes | enum §2.2 |
| `owner` / `operator` | owner yes (S5 "M") | "Unknown" allowed and shown |
| `status` (lifecycle) | yes | **Existing (in service) · Out of service · Abandoned in place · Removed · Proposed · Conceptual/illustrative** (S5 domain + our "Conceptual") |
| `evidence` (how we know) | yes | **Surveyed/verified (QL-A) · Geophysically designated (QL-B) · Records + surface features (QL-C) · Records only (QL-D) · User-drawn (no QL) · Unknown** |
| `quality_level` | for existing assets | ASCE 38 QL-A..D; QL applies only where investigated (QL-A only at test hole) (S1, S3 via DelDOT) |
| `positional_accuracy` | yes | ASCE 75-22 level 1–5 (25/50/100/300/1000 mm) or 0 = undefined (S6); separate H and V; "Z unreliable" state (S5 level 6) |
| `horizontal_crs`, `vertical_datum` | yes, per record (S5: "managed and exchanged at the record level") | e.g. EPSG:4326/32643; EGM2008 / "stated MSL (unknown realisation)" / "not stated" |
| `z_reference` | yes for linear assets | which part of the cross-section the Z is: **crown/top · centre · invert · bottom** (S5 "Z Relative Position") |
| `source`, `source_date`, `collected_date`, `licence`, `certified_by` | yes / optional | metadata minimum: how, when, CRS/datum, who certified, known limitations (S5) |
| `sensitivity` | optional | Unrestricted / Restricted / SSI (S5) — gas, power, metro data may be restricted |
| `material`, `encased`, `conveyance` (gravity/pressurised), `outside_height`, `outside_width` (or OD), `wall_thickness`, `n_conduits` | optional | unknown stays **Unknown**, never defaulted silently |

### 2.2 Per asset type (beyond common)
| Type | Geometry | Key attributes (bold = needed for screening checks) |
|---|---|---|
| Metro / rail tunnel | 3D polyline axis + circular/horseshoe section; twin bores as two objects or `bores=2` + `bore_spacing_c2c` | **outer Ø** (Pune: OD 6.35 m, excavation 6.7 m — S17), inner Ø, **rail level or crown elevation per vertex**, **bore c/c spacing** (Pune DPR 15.35 m generally — S17), gradient (≤3%, 4% exceptional; drainage ≥0.25–0.5% — S17), construction method (TBM/NATM/cut-and-cover), **protection zone width** (20 m from edge, Pune — S20) |
| Station box / shaft | 3D solid (footprint + top/bottom elevation) | **footprint**, **base depth** (Pune Line-1 18–28 m — S19), method |
| Road / pedestrian tunnel / underpass | axis + rectangular/box section | **width, height (outer)**, crown/invert elevations, clear height (IRC subway min 1.5 m for service subways — S14) |
| Water main | 3D polyline + circular | **OD**, material, **pressure** class, **crown or centre Z** |
| Sewer (gravity) | 3D polyline + circular; manholes as points | **OD/ID**, **upstream & downstream invert**, slope, manhole top level (PMC data has these — S29) |
| Storm drain / culvert / nala | polyline or polygon; box or pipe | **width × height or Ø**, invert levels, open/closed |
| Power cable / duct | polyline; bundle | **voltage class** (LT / 11 kV / 33 kV / EHV — drives depth & clearance, S16), duct/direct-buried, **burial depth to top** |
| Telecom / OFC | polyline | direct-buried vs **duct**, n_conduits |
| Gas (CGD) | polyline | **steel vs PE**, pressure (steel main / PE distribution / service), **cover to top of pipe** (S15) |
| Utility corridor / duct bank / common utility tunnel | polygon section × length (box) | **outer W×H**, wet/dry compartments (S14: GIFT City up to 8 m W × 11 m D), contained utilities |
| Foundation / basement | 3D solid (footprint + base elevation) or pile group | **number of basement levels or base depth**, pile toe depth — usually **Unknown** in Pune data → say so |
| Borehole / trial pit | point + depth interval log | **collar elevation**, total depth, strata intervals, **groundwater strike/standing level + date**, source (AGS4) |
| Groundwater observation | point | DTW m bgl + date + season (pre/post-monsoon), well depth (often unpublished) |

### 2.3 Vertical reference & Z handling (hard requirements)
1. **Store absolute elevations, not depths.** ASCE 75 (S5): depth below ground "is subject to variations over time… inadequate for recording vertical positions" → store orthometric elevation with its datum; derive depth for display.
2. Keep **both**: what the user typed (e.g. "depth 18 m below ground at vertex 3") *and* the ground model + version used to convert it, so the conversion can be re-done when the DEM changes.
3. **Datum honesty for Pune:** our DEM is Copernicus GLO-30 **DSM** (EGM2008; includes roofs/trees — S29). Pune ground ≈ 559 m (S17). PMC sewer levels have **no stated datum**; DSM − published manhole top level has median **3.07 m** (p10 1.76, p90 5.05) (S29) → treat PMC invert *elevations* as **relative** only, use invert *depth below manhole top* where both exist, flag "datum not stated".
4. Every displayed elevation carries a unit + datum label ("m EGM2008", "m bgl (DSM)"); every depth says "below what".
5. Geometry ops must keep Z (densify/simplify/offset/clip in 3D; never round-trip through 2D GeoJSON without Z). PostGIS ≥ 2.2 no longer assumes Z=0 for missing Z in ST_3DDistance (S11) — so a 2D record mixed with 3D gives nonsense or errors: **reject or flag 2D records in 3D checks** ("no depth → vertical check not possible").
6. Z uncertainty is a first-class number: vertical tolerance = f(QL/accuracy level). QL-D/undefined ⇒ vertical position **unknown** ⇒ only plan-view (2D) screening is honest.

---

## 3. Screening checks — clearance/cover values with sources

All checks report **min 3D gap** (surface-to-surface: centre distance − radii, or ST_3DDistance on swept solids) **and** horizontal + vertical components separately, because Indian norms are written as H and V.

| # | Check | Value (screening threshold) | Source | Type |
|---|---|---|---|---|
| C1 | Water main ∥ sewer/drain, horizontal | ≥ **3.0 m** (else lined + MS-encased) | CPHEEO water 2024 §12.9.1 (S12) | N |
| C2 | Water main crossing sewer/drain | water **bottom ≥ 0.5 m above** sewer top, for 3 m each side | CPHEEO §12.9.2 (S12) | N |
| C2b | Water ↔ sewer (road ROW guidance) | 2–3 m apart; crossing clear **≥ 1.0 m**; water never below sewer | IRC:98-2024 draft §3.2.3, 3.3.3 (S14) | G (draft) |
| C3 | Power cable ↔ water main / gas | ≥ **0.3 m** | IS 1255 §6.3.3 (S16) | N |
| C3b | Electric cable ↔ water supply line | **1.0 m** H and V | IRC:98-2024 draft §3.2.4, 3.3.3(vi) (S14) | G — stricter than IS 1255; show both |
| C4 | Power ↔ telecom | ≥ **0.3 m**; power never above telecom | IS 1255 §6.3.3 + amendment (S16) | N |
| C4b | Electric ↔ OFC | **1.0 m** H and V | IRC:98-2024 draft (S14) | G |
| C5 | Steel gas pipeline crossing any service | laid ≥ **0.3 m below** it | PNGRB T4S CGD, clearance (a) (S15) | N |
| C6 | Steel gas pipeline parallel to cable/drain/utility | ≥ **0.3 m** clear | T4S (b) (S15) | N |
| C7 | Steel gas ↔ habitable/industrial building | ≥ **3 m**, else +0.3 m cover or slab/casing | T4S (g) (S15) | N |
| C8 | Steel gas ↔ transmission-tower footing | ≥ **3 m** (as far as practical) | T4S (c) (S15) | N |
| C9 | Cover: steel gas main | ≥ **1.0 m** normal; **1.2 m** road crossing; 1.7 m cased rail; 1.5 m lined nala | T4S Table 3 (S15) | N |
| C10 | Cover: PE gas service line | **1.0 m**; never < 0.6 m (with protection slab 0.3 m above) | T4S Sch. 1D (S15) | N |
| C11 | Cover: power cable (to top) | LV **0.75 m**, 3.3–11 kV **0.9 m**, 22–33 kV **1.05 m**, road crossing **1.0 m** | IS 1255 §6.3.2 (S16) | N |
| C12 | Cover: sanitary sewer start / storm drain | **1.0 m** / **0.5 m** | CPHEEO sewerage Ch.3 (S13) | N [UNVERIFIED excerpt] |
| C13 | Cover: any service in road trench | ≥ **0.6 m** (encase if < 0.6 m); uncased road crossing ≥ **1.2 m**; casing top ≥ 1.2 m below road & ≥ 0.3 m below drain invert | IRC:98-2024 draft §3.3.1, 3.7.2, 3.6.3.2 (S14) | G |
| C14 | Typical depth bands (sanity, not a rule) | trunk sewer > 1.5 m; water service 0.6–1, trunk 1–6 m; LT 0.6–1; HT 1.5–2; telecom 0.6–1 (duct 1–2); gas 2–3 m (trench bottom) | IRC:98-2024 draft §3.3.3 (S14) | R — use only to flag "unusual depth, verify" |
| C15 | Anything within Metro protection zone | **20 m** either side of edge of any Metro structure incl. tunnels → **Maha-Metro NOC required** (incl. borewells, geotech, utility laying) | UDCPR 14.2.1.7 (S20), Pune Metro notice (S21) | N (Pune/Maharashtra) |
| C16 | New tunnel ↔ existing tunnel (clear gap) | Pune twin bores c/c **15.35 m** with OD 6.35 m ⇒ ~9 m clear (≈1.4 D). Treat < 1 D clear as "requires specialist assessment" | DPR (S17) | R — project value, not a code minimum |
| C17 | Tunnel cover / overburden | NATM needs overburden ≈ **2–2.5 × D** (DPR); TBM in Pune ran at ~18–30 m depth | S17, S19 | R |
| C18 | Tunnel crossing below river / nala | Pune tunnels ~19 m below Mutha bed | S19 | R (context only) |
| C19 | Pipeline ↔ tunnel / basement / foundation | **No Indian numeric norm found** → use C15 (20 m NOC) + "specialist assessment"; never invent a clearance | — | gap |
| C20 | Water/sewer international cross-check | 3 m H / 0.45 m (18") V (BC, Ten-States) | northernhealth.ca guideline | I — show only as "international comparison" |
| C21 | Groundwater interaction | flag if structure base below recorded DTW (season-aware: pre-monsoon deeper, post-monsoon shallower); Pune DTW: Swargate–Katraj BHs Nil–17 m, mostly 2–6.5 m bgl (S17); district 0.9–30 m (S23) | S17, S23 | R (evidence, not criterion) |
| C22 | Rock head | Swargate–Katraj: fill 1–2 m, soil to 1–5 m, then completely→moderately weathered basalt; rock at 1–2 m in 5/9 BHs (S17) | S17 | R (evidence) |

**Rules for using the table**
- When two sources differ (C3 vs C3b, C4 vs C4b, C1 vs C2b) the check uses the **stricter** for "Potential conflict" and names both in the explanation.
- A clearance check is only valid if **both** objects have known Z (or the V-component is reported "not checked").
- Expand every threshold by the **positional uncertainty** of both objects (QL/accuracy level). E.g. QL-D + 1 m nominal clearance ⇒ "cannot confirm clearance".
- Owners' own specs often override (e.g. MNGL, MSEDCL, PMC water dept); the result must say "owner's standard not checked".

---

## 4. Result statuses & wording rules

**Statuses (only these):**
- **Potential conflict** — geometry intersects or is inside a threshold using the data as recorded.
- **Requires investigation** — near a threshold within data uncertainty, or inside a regulatory zone (C15) that mandates another authority's review, or relies on QL-D/undefined-accuracy data.
- **Insufficient data** — a needed input is missing (no Z, no diameter, no datum, no records in area). Not "pass".
- **No conflict found in available data** — never "Safe", "Clear", "Passed", "Compliant", "OK", "Construction-ready", "Approved". Green colour is avoided; use neutral grey.
- **Verified** — reserve for a human recording a field verification (e.g. QL-A test-hole evidence attached). The software never auto-assigns it.

**Every result card states (fixed order):**
1. **Checked:** "Horizontal and vertical clearance between *Proposed tunnel T1* and *PMC sewer S-2231* against CPHEEO 2024 §12.9 (3.0 m H / 0.5 m V)."
2. **Data used:** layer + version + date + QL + datum ("PMC sewer layer v1, design levels, QL-D, datum not stated; DEM Copernicus GLO-30 DSM v3, EGM2008").
3. **Found:** numbers with uncertainty ("min. vertical gap 0.4 m ± ≥1 m (QL-D)").
4. **Not checked:** explicit list ("owner's specification; utilities absent from our layers (water, power, gas, telecom not loaded); foundations; settlement; construction method").
5. **Next investigation:** concrete step ("Request PMC drainage as-built; GPR/QL-B survey of crossing; trial pit (QL-A) at ch. 1+240; Maha-Metro NOC — within 20 m of Line-1 tunnel; raise CBuD request").
- Summary banner for a run counts by status and always ends with: *"Automated screening on incomplete records. Not an engineering assessment or approval."*
- Absence of a layer is itself a finding: "No water-supply data for this area → water clearances **not checked**" (counts as Insufficient data, not as zero conflicts).

---

## 5. UX patterns

**Adopt**
| Pattern | Why | Seen in |
|---|---|---|
| Ground translucency **limited to the study area** (alpha ~0.3–0.6), fades with camera distance | users see depth context without losing surface reference; Cesium supports `rectangle` + `frontFaceAlphaByDistance` | S28, S26 |
| **Clipped/sliced local cutaway** (clip box or slice plane that excludes the underground layers) | gives an unmistakable "ground cut" with visible soil faces; better than global X-ray for depth reading | S26 (slice tool), Cesium ClippingPlane/Polygon |
| Allow camera **below ground**, with a depth HUD ("camera 12 m below ground") and a "back to surface" button | Esri and Cesium both gate this behind an explicit toggle; users get lost otherwise | S26 |
| **Long-section (profile)** with ground line, asset crowns/inverts, labelled datum, crossings drawn at their Z with uncertainty bars | primary engineering view for alignments; already partly built (S29) | Civil 3D profiles, S29 |
| **Cross-section at a chainage** with all assets within ±N m projected, dimensions of gaps | how clearances are actually judged | Civil 3D section views |
| **Colour by utility type (APWA-style: water blue, sewer green, power red, telecom orange, gas yellow), line style by status** (solid existing, dashed proposed, dotted conceptual), opacity/halo by QL | separates *what* from *how sure*; Indian utilities also use these conventions informally | APWA uniform colour code (not opened) |
| **Depth legend/scale bar** in metres below ground + absolute elevation | depth is unreadable in perspective without it | — |
| **Clash list ↔ 3D markers ↔ section**, click to fly-to, exportable CSV | Civil 3D interference objects in a list + markers; reviewers work from a list | S27 |
| Proximity check = **buffer distance per pair type** (Civil 3D "distance" or "scale factor × size") | matches how norms are written; table-driven rules | S27 |
| "**What's here?**" first: before drawing, a pane listing existing assets/zones in view with counts, sources, QL | SUE principle: investigate existing before proposing | S1, S2 |
| Evidence/source chip on every object (QL badge, datum badge) | ASCE 38 requires QL depiction "unambiguous" | S3 (TOC 2.1.6) |

**Avoid**
| Anti-pattern | Why |
|---|---|
| Global X-ray that makes buildings and ground disappear everywhere | loses surface alignment, the one cue that makes depth meaningful |
| Vertical exaggeration on by default without a label | users misjudge clearances; if offered, show "×N vertical" permanently |
| Green "✔ safe"/"passed" states | mission rule; ASCE/FHWA frame utility data as risk, not certainty |
| Rendering every pipe as a tube at city scale | thousands of primitives; use polylines/2D at far zoom, tubes only within the work area (LOD by distance) |
| Licence walls inline in the layer card | collapse to an "ⓘ licence" link; show attribution once in footer |
| Two places to edit the same alignment (inspector + profile editor) | causes divergent edits (known issue in repo brief) |
| Counting "no records" as "no conflicts" | the single most dangerous misread |
| Showing PMC invert elevations as absolute MSL | datum not stated, ~3 m median mismatch to DSM (S29) |

---

## 6. What is impossible with our Pune data, and what would be needed

| Capability | Today (S29 + S25) | Why impossible / limited | Data needed |
|---|---|---|---|
| True cover / depth below ground | DSM (roofs, trees), 30 m, EGM2008, ~0.4–4 m RMSE class | DSM ≠ bare earth; can't resolve road crown | PMC/Survey of India road levels, LiDAR DTM, or site survey benchmarks |
| Water / power / telecom / gas clearances | **no layers** (only PMC sewers 44k lines + stormwater not yet indexed) | nothing to check against → Insufficient data | PMC water GIS, MSEDCL/Tata Power cable GIS, MNGL CGD network, telecom via CBuD/PM GatiShakti |
| Vertical clearance to sewers | PMC design inverts, QL-D, datum not stated | relative only; ±metres | as-builts with datum, manhole surveys (QL-C), GPR (QL-B) — PMC now mandates GPR before roadworks (S25) |
| Clearance to Metro tunnels | alignment known approx.; depths from press (18–30 m) | no official 3D tunnel model | Maha-Metro as-built tunnel axis + rail levels (on NOC request) |
| Foundations / basements / piles | none | building heights ≠ basement depths | AutoDCR/PMC building-permission basement levels; plans |
| Geology / rock head | 9 DPR boreholes (Swargate–Katraj) in a PDF table; no borehole layer | point data, corridor-specific | AGS4 borehole logs (Maha-Metro, PMC flyovers, private sites), GSI 1:50k map |
| Groundwater | 36 CGWB/GSDA wells, manual DTW | point, seasonal, no aquifer/well depth | piezometer series near site; DPR BH strikes |
| Settlement / structural impact, construction method risk | — | needs engineering analysis | specialist geotechnical/structural assessment (out of scope by design) |
| Utility condition, ownership certainty | — | not in records | owner records; CBuD contact lists |

---

## Top 12 implementation requirements (priority order)

1. **One honest source of truth for "what records exist here"** — fix the "No records imported" vs "9,187 PMC records" contradiction; per layer show count, QL, datum, date; missing layers listed as *not available*, never silently absent.
2. **Result model with fixed 5 fields + 4 statuses** (§4); no "safe"/green; "no records" ⇒ Insufficient data; banner "Automated screening — not an engineering assessment".
3. **Store absolute Z + datum + z_reference (crown/centre/invert) per vertex**, keep the typed depth and the DEM version used; label every number with datum ("m EGM2008", "m below DSM"). Flag 2D-only records as "vertical not checkable".
4. **Status vs evidence as two separate fields**: lifecycle (Existing / Proposed / Conceptual / Out of service / Abandoned / Removed) and evidence (QL-A/B/C/D, user-drawn, unknown); drive line style by status and opacity/badge by evidence.
5. **Table-driven clearance rules** (§3) keyed by asset-type pair, each row carrying value, H/V/3D, source clause, N/G/R type; stricter rule wins, both cited.
6. **3D proximity engine** returning min 3D gap + H + V components and location/chainage (ST_3DDistance/ST_3DDWithin semantics; swept solids by OD/W×H), with thresholds **widened by positional uncertainty**; include Design-drawn utilities in backend detection (known gap).
7. **Metro protection-zone check (20 m from edge, UDCPR 14.2.1.7)** as a first-class rule producing "Requires investigation — Maha-Metro NOC", covering tunnels, stations, borewells and geotech.
8. **Cover checks** per type (IS 1255 cables, PNGRB gas, CPHEEO sewer/storm, IRC 0.6 m trench) against ground — with explicit caveat that ground is a DSM.
9. **Localized ground cutaway** (translucency/clip limited to the work area, slice plane excluding underground layers) + below-ground camera with depth HUD and "back to surface"; buildings and roads stay aligned.
10. **Long-section and cross-section** as the primary inspection views: ground line, asset envelopes at true Z with uncertainty bars, dimensioned gaps; clash list ↔ 3D marker ↔ section linked; single editing surface per alignment.
11. **Evidence panel per proposal**: nearest boreholes/wells (DTW + date + season), DPR geology where available, "No borehole records — site investigation required"; groundwater-below-invert flag.
12. **Next-investigation generator** mapped to QL ladder and Indian process: request owner as-builts → CBuD request → GPR (QL-B; PMC-mandated) → trial pits (QL-A) at flagged crossings → Maha-Metro NOC → geotechnical boreholes; exportable report (CSV/PDF) listing checked / not checked.

### Caveats
- IRC:98-2024 is a **draft**; IRC:98-2011 is current. CPHEEO sewerage values (C12) and all Metro depth/press numbers are from excerpts only.
- ASCE 75-22 accuracy table here is from the 2018 draft (S5) and an Iowa DOT spec quoting the final (S6); the final standard itself was not opened.
- No normative Indian clearance between utilities and tunnels/foundations was found — the product must say "specialist assessment" rather than invent one.
- Source documents are cited by URL in §1. The downloaded copies and raw extraction notes are licensed / third-party material kept outside the repository for internal reference only; they are deliberately not included here.
