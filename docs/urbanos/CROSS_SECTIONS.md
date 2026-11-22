# Street cross-sections: templates, screening checks, upgrade

Branch `p5-xsection` (from `cbff478`). Design workspace. UrbanOS is decision-support for Pune authorities: every template
here is a **screening template** and every check is **screening only — not a design check or approval**. Values that are
not known (available right-of-way, frontage land use) stay **unknown**.

## Sources and how they were read

| Key | Document | URL | Status |
|---|---|---|---|
| USDG | *Urban Street Design Guidelines, Pune*, Pune Municipal Corporation, Version I: 2016 (130 pages) | https://pmc.gov.in/sites/default/files/road_img/USDG_Final_July2016.pdf | **official (PMC)** |
| IRC86 | IRC:86-2018 *Geometric Design Standards for Urban Roads and Streets* (1st revision, Nov 2018) | https://law.resource.org/pub/in/bis/irc/irc.gov.in.086.2018.pdf | IRC text, third-party copy — **unconfirmed** against an IRC-issued copy |

- **USDG copy.** The pmc.gov.in link now 301-redirects to the new PMC site (the file is no longer served there, and the new
  PMC S3 bucket has no such key). The text was read from the copy at
  `https://www.itdp.in/wp-content/uploads/2016/07/Urban-street-design-guidelines.pdf` (ITDP was PMC's technical partner).
  That file is **byte-identical in size (17,708,161 bytes) and in its first 1 MB** to the pmc.gov.in file as captured by
  the Internet Archive on 2021-03-05 (`web.archive.org/web/20210305135217id_/https://www.pmc.gov.in/sites/default/files/road_img/USDG_Final_July2016.pdf`,
  whose capture is truncated at 1 MB; `x-archive-orig-x-crawler-content-length: 17708161`). sha256 of the copy read:
  `2f0df4a020d041ab1913156010ea080735b809bf37435c7029a6a7084d21889a`. It is treated as the official PMC document.
- **Reading by code only.** Body text by `pdftotext -layout`. The **template pages (ch. 8) are 150 ppi JPEG drawings with no
  text layer**, so their dimension strings were read by OCR: `pdfimages` → 4–12× upscale → `tesseract` (psm 7/8/11/13,
  several thresholds), digits located by column runs and voted. A template was **accepted only when its strip widths add up to
  the RoW in its title**; every template carries the label *"Widths read by OCR from a raster drawing (no text layer); they add
  up to the RoW in the title. Verify against the drawing before use."* Two strips were settled by the sum rule rather than a
  clean OCR vote: the 24A left buffer (0.5 m) and the 18A cycle track / carriageway pair (2.5 / 6.5 m, the alternative
  2.0 / 7.0 m also sums to 18; the OCR repeatedly read a decimal "6.5"). Strip labels and the "Recommended for…" lines were
  OCR'd as text.
- **IRC:86-2018 has no street templates.** Its Table 5.3 refers to "Annexure 2: Street Design Templates", but the code has
  only Annexure I (grade-separated pedestrian/cycle facilities) and Annexure II (superelevation). IRC values are used only by
  the checks.
- Scratch copies (not committed): `/workspace/work/xs-refs/` (`usdg_itdp.pdf`, `usdg.txt`, `irc86.pdf`, `irc86.txt`, OCR scripts).

## Templates

Elements are listed from the left edge of the right-of-way to the right edge, looking along the drawn line. USDG printed page
= PDF page − 21. Only the "A" variant of each RoW is loaded (B–E variants differ in parking, one-way or BRT).

| Id | USDG template (ch. 8) | Page (PDF) | RoW | Strips, left → right (m) | Lanes | Recommended for (USDG) |
|---|---|---|---|---|---|---|
| `usdg-12a` | 12A "12 m right of way – A" | p. 55 (76) | 12 | walkway 2 · tree pit/furniture/bus stop 1 · carriageway 6 · tree pit/furniture 1 · walkway 2 | 2, two-way undivided (3.0 m) | through traffic in a residential or mixed land-use area |
| `usdg-18a` | 18A | p. 64 (85) | 18 | walkway 2.5 · tree pit/furniture 1 · cycle track 2.5 · buffer 0.5 · carriageway 6.5 · bus stop/parking/tree pit 2 · walkway 3 | 2, two-way undivided (3.25 m) | streets alongside educational institutes, with through traffic |
| `usdg-24a` | 24A | p. 73 (94) | 24 | walkway 2.5 · tree pits/furniture 1 · cycle 2 · buffer 0.5 · carriageway 5.5 · centre verge 1 · carriageway 5.5 · bus stop/tree pits 1.5 · cycle 2 · walkway 2.5 | 2 + 2 divided (2.75 m) | heavy through traffic, mobility corridors |
| `usdg-30a` | 30A | p. 78 (99) | 30 | walkway 4 · cycle 2 · buffer 0.5 · parking/tree pit 2 · carriageway 6 · centre verge 1 · carriageway 6 · bus stop/tree pit 2.5 · cycle 2 · walkway 4 | 2 + 2 divided (3.0 m) | heavy through traffic |
| `usdg-36a` | 36A | p. 82 (103) | 36 | walkway 3.5 · tree pits/vending 2 · cycle 2.5 · buffer 1.5 · parking 2 · carriageway 6 · centre verge 1 · carriageway 6 · bus stop/tree pits 3.5 · cycle 2.5 · tree pits/furniture 2 · walkway 3.5 | 2 + 2 divided (3.0 m) | through traffic |

- **In-between RoW** (USDG ch. 8 introduction, p. 48, PDF p. 69): use the template of the next **smaller** RoW and give the
  rest to footpath / cycle track / MUZ (`templateForRow`, used to suggest a template when the available RoW is entered).
- **Suggested road class** (collector for 12A/18A, arterial for 24A–36A) is an **UrbanOS mapping, not stated by USDG**; the
  Road class chosen in the tool is kept.
- The USDG templates use lanes narrower than IRC:86 (2.75–3.25 m) and a 1 m centre verge (IRC:86 minimum median 1.2 m). The
  checks flag these on the templates themselves: the two sources differ, and the screen shows it rather than hiding it.

### How a template maps onto the road model
Stored as the road's section profile (what the renderer, traffic model and feasibility screen already read) plus
`section.crossSection` (template id, code, RoW, the strips, source, `replaced` = the strips before). Clear walkway →
`footpathWidth`; tree pits / furniture / MUZ / buffer → `vergeWidth`; cycle track → `cycleTrackWidth`; parking (incl. mixed
bus-stop/parking strips) → `parkingWidth`; carriageway → carriageway A/B lanes and lane width; centre verge → median.
`totalRowWidth` = the template RoW. If a later edit (lane width, footpath slider …) changes the profile, the panel says
"Edited after template … was applied" and reads the strips from the stored profile.

## Checks (screening)

`checkCrossSection(elements, { roadClass, availableRowM, availableRowSource })`. Statuses: **fail** = below the lowest value
the source states (or wider than a known RoW); **warn** = below a desirable / Pune value; **unknown** = cannot be screened;
**info** = context; **pass** = no flag found. Every result carries `screening: true`, the text "Screening only — not a design
check or approval." and its source with clause and page.

| Check | Rule | Source |
|---|---|---|
| Footpath clear width, each side | < 1.8 m **fail**; 1.8–2.0 m **warn**; ≥ 2.0 m no flag | IRC86 §5.1 Table 5.1, p. 7 (PDF 15): pedestrian zone ≥ 1.8 m residential (unconfirmed copy); USDG §3.1, p. 7 (PDF 20): "clear and unobstructed minimum walking zone of 2m" (official) |
| Footpath for frontage land use | always **unknown** (land use not recorded): the 2.5 m commercial / 4.0 m high-intensity minimums are not screened | IRC86 Table 5.1 |
| Lane width, each carriageway | < 3.0 m **fail**; 3.0–3.5 m **warn** (**info** on a local road); > 3.5 m **info** (no maximum stated); 3.5 m no flag | IRC86 §5.4 / Table 5.5, p. 14 (PDF 22): "lane width should be 3.5 m"; 3.0 m permissible on access roads to residential areas |
| Fits the available right-of-way | no RoW recorded → **unknown**; total > RoW **fail**; else no flag (spare width noted) | the planner's entry and its stated source |
| Missing footpath | none on a side of an **arterial / collector** → **fail**; local → **info**; highway (urban expressway) not checked | IRC86 §2.1, p. 3 (PDF 11): collector streets "shall be designed with dedicated footpaths"; arterials provide safe, segregated NMT facilities; local streets "may not have a dedicated footpath" (shared, < 20 km/h). USDG §3.1: footpaths on both edges |
| Median width (when drawn) | < 1.2 m **fail** | IRC86 §5.1.2 / §5.6, p. 9 (PDF 17) |
| Cycle track width (when drawn) | < 2.0 m **fail** | IRC86 §5.3, p. 12 (PDF 20); USDG §3.2, p. 9 (PDF 22) |

The available right-of-way is a new optional road field (`availableRowM`, `availableRowSource`), entered by the planner from a
DP sheet or survey. The drawn road width is **not** the right-of-way and is never used as one.

## How to use

1. **Draw with a template.** Design → Road tool → *Cross-section*: "Class default (no template)" or one of the USDG
   templates. A diagram, the source with page, and the OCR note are shown. The drawn road gets one section over its line;
   the Road class still sets the speed limit.
2. **See and screen a road.** Select a road: the inspector shows *Street cross-section* (diagram, template source, legend),
   *Available RoW* + *RoW source* (blank = unknown) and *Cross-section checks* (labelled **screening**), in the same card
   layout as the flyover desk check.
3. **Upgrade an existing road.** In *Upgrade to a template*, pick a template (the one that fits the available RoW is
   pre-selected): before/after diagrams and a count of the template's screening results are shown. *Apply* is **one Undo
   step**. After applying, the panel keeps the before/after diagrams.
   - A **drawn** road is updated in place.
   - An **OSM-imported** road is **never edited in the baseline**: in the baseline the button is replaced by a note; inside a
     proposal (alternative) the change goes through `ObjectManager.update`'s copy-on-write, so it is stored as the
     proposal's copy and the baseline row is untouched (the available-RoW fields follow the same rule).
   - The plan geometry is not changed, so crossings and junction joins stay as they are; the section is rebuilt as one
     profile over the whole line with `normalizeRoadSections` (the coverage rule the geometry commit uses), replacing any
     several profiles. Provenance keeps `originalSource` (e.g. OSM) and sets `profileModified`, `lastModifiedBy: manual`.
     A drawn flyover's ramp capacity cut on the road is kept.

## Code

| File | What |
|---|---|
| `frontend/src/engine/crossSection/templates.ts` | sources (USDG, IRC86 with status), the five templates with source refs, `templateForRow`, in-between rule |
| `frontend/src/engine/crossSection/apply.ts` | template → section profile, profile → strips, `sectionView`, `templateRoadUpdates`, `upgradeBlockReason`, `commitCrossSectionTemplate` (one Undo step) |
| `frontend/src/engine/crossSection/checks.ts` | `checkCrossSection`, thresholds, sources |
| `frontend/src/components/design/CrossSectionDiagram.tsx` | strip diagram (SVG) and legend |
| `frontend/src/components/design/CrossSectionPanel.tsx` | road inspector panel: diagram, available RoW, checks, upgrade with before/after |
| `frontend/src/components/design/ToolSettings.tsx` | Road tool: template picker with diagram and source |
| `frontend/src/engine/editing/EditingEngine.ts` | `roadTemplateId`; a drawn road takes the template's section |
| `frontend/src/engine/objects/types.ts` | `RoadSectionProfile.crossSection`, `RoadObject.availableRowM` / `availableRowSource` |
| `frontend/src/components/PropertiesPanel.tsx` | mounts `CrossSectionPanel` for roads |
| `frontend/src/engine/testing/CrossSections.test.ts` | 14 tests: template sums and sources, mapping, edit detection, each check, upgrade undo, OSM baseline refusal and proposal copy-on-write, drawing with a template, static UI render |

## Not done / open
- Only the five "A" templates; B–E, BRT and 6–9 m / 15 m / 21 m / 27 m / 42–60 m templates are not loaded.
- OCR-read widths need a human check against the drawings (two strips settled by the sum rule, above).
- Frontage land use is not modelled, so commercial / high-intensity footpath minimums are not screened.
- Templates apply to the whole road (one section); a partial-length upgrade brush is not built.
- Flyover decks keep their own lane/footpath fields; templates are for surface roads.
- IRC text is a third-party copy; confirm against an IRC-issued copy before external use.
