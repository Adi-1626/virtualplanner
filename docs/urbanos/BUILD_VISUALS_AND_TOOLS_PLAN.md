# Design workspace: realistic visuals and new buildable tools (research + design, 2026-11-22)

Status: **plan only, nothing implemented, nothing built or tested.** Branch `p7-plan` (from `next-phase` at `640da42`).
Companions: [TRANSPORT_TOOLS_CS2_RESEARCH.md](TRANSPORT_TOOLS_CS2_RESEARCH.md) (CS2 inventory, palette, keys — not repeated
here), [CROSS_SECTIONS.md](CROSS_SECTIONS.md) (USDG templates + checks, built), [PLANNING_DEFAULTS_DECISIONS.md](PLANNING_DEFAULTS_DECISIONS.md)
(D1–D11), [GEOMETRY_EDITOR_DESIGN.md](GEOMETRY_EDITOR_DESIGN.md) (alignments, grades, ramps).

User request (2026-11-22): (1) everything built in Design should look realistic (today it looks fake); (2) add useful
buildable things, checking what Cities: Skylines II (CS2) offers, researched and done properly. UrbanOS stays a
decision-support tool for PMC / PCMC / Maha-Metro / PMRDA, not a game: realism serves reading a proposal correctly
(scale, clearances, what it takes from the street), never decoration that implies more certainty than the design has.

**Labels.** **[official]** read in this session from a government / agency site · **[IRC copy]** IRC text read from the
Public.Resource.Org mirror (law.resource.org), *unconfirmed against an IRC-issued copy* · **[app]** read in this repo's
code · **[assumed]** no source; a placeholder that must be labelled "assumed" in the UI · **[unknown]** not found; stays
unknown · **[proposed]** this document's choice. PDFs were read with `pdftotext` only (no OCR needed this session). No news
sources. Scratch copies (not committed): `/workspace/work/p7-refs/` plus the earlier `work/cs2-refs`, `work/p4-refs`,
`work/geometry-refs` of the project.

---

## 0. Summary

**Why it looks fake (audit, §A1).** Every Design object is drawn with `PerInstanceColorAppearance({ flat: true })`
(`engine/rendering/renderers/TileBatchRenderer.ts:229–235`): no lighting, no shading, no textures, so a 3D box reads as a
flat sticker. Normals are computed but ignored, and would be smoothed across box edges anyway. Colours are UI colours
(slate-blue asphalt `#2b313b`, navy/bright-blue metro `#1e3a5f`/`#1d4ed8`, amber divider stripes). Several dimensions are not
what Pune builds: kerbs and footpaths stand **0.22 m** high (USDG / IRC:86 max **150 mm**); lane lines are **continuous
120 mm** (IRC:35-2015 urban: **150 mm, 3 m mark / 6 m gap**); every undivided road gets a **US-style double-yellow centre
line** (IRC:35: white broken centre line on normal sections); the double-deck metro deck is **5.0 m** wide (Pune viaduct
**~8.5 m** [official]); the metro deck is a flat 0.4 m slab with bare cylinders and no pier caps (Pune uses a precast
segmental **box girder** on single circular piers [official]). On terrain, ribbons are not densified, so long segments chord
through or float over the ground, and the scene does not depth-test against terrain.

**Fix in four layers, ranked (§A6):** (1) a *Visual style* switch Realistic / Schematic with lit shading and hard-edge
normals (cheap, biggest jump); (2) standards-correct dimensions and markings, each value with its source in one file;
(3) terrain fit (densify, smoothed profile, embankment / cut skirts, terrain clipping at cuts and portals); (4) textured
materials (CC0 ambientCG / Poly Haven, world-metre UVs, one atlas, custom appearance that keeps traffic tint and
selection), structural profiles (box girder, Jersey barrier, pier caps, RE-wall ramps), instanced props (streetlights,
trees, bollards) and tunnel portals. Schematic stays one click away and is the automatic fallback on weak GPUs.

**One correction to the request.** The user asked for a "U-girder" metro viaduct "like Pune Metro". Maha-Metro's official
documents say Pune Metro's elevated viaduct is a **precast segmental box girder** on single piers: the Phase-2 DPR
(July 2024) lists double U-girder only as an option and **recommends the box girder "in continuation to the works in
Phase-1"**; Maha-Metro's Oct 2022 newsletter says Reach 1 has 426 PSC segmental box-girder spans. So the default is box
girder; U-girder is offered as a *type option* with dimensions **[unknown]** (no official Pune U-girder drawing found).

**Buildables (§B).** Most of the CS2 inventory and the Indian mapping already exist in TRANSPORT_TOOLS_CS2_RESEARCH.md, and
cross-section templates / checks / upgrade are built (CROSS_SECTIONS.md). New this session: the governing texts for
roundabouts (IRC:65-2017), BRT (IRC:124-2017), cycle tracks (IRC:11-2015), markings (IRC:35-2015 + MoUD CoP-3, official),
signals (IRC:93-1985), at-grade junctions (IRC:SP:41-1994) and vertical clearance (IRC:54-1974) were located; their
availability is in §B2. **IRC:65-2017 sizes differ from the MoUD CoP-2 table** the earlier plan used (§B3). Top 8 to build
next (§B4): junction control + IRC:35 junction markings; pedestrian crossings with screening; bus stops + bus lane / BRT;
streetlights and street trees as roadside elements; elevation while drawing with clearance checks and auto retaining walls;
roundabouts to IRC:65; standalone footpaths / cycle tracks / FOBs; kerbside parking and no-parking zones.

---

# Part A — Realistic visuals

## A1. Audit: how built objects are drawn today [app]

Pipeline: `ProceduralGeometryGenerator.ts` (2,378 lines) turns each object into `MeshData[]` (ECEF positions, indices,
`material.color`, `layerId`); `RoadRenderer` / `TransitRenderer` (both `TileBatchRenderer`) batch meshes into one Cesium
`Primitive` per (map tile, layer), built **synchronously** (`asynchronous: false`) with
`PerInstanceColorAppearance({ flat: true })`. Height above ground comes from `wgs84ToCartesian`, which adds
`groundAt(lng,lat)` (`engine/terrain/groundHeight.ts`, bilinear over a sampled `TerrainHeightField` of Cesium World Terrain
when the Terrain layer is on). `CesiumAdapter.buildGeometry` runs `GeometryPipeline.computeNormal` (smooth, shared
vertices), but flat shading ignores normals. `MeshData.uvs` exists in the type and is never filled.

| Object | Where (file:line) | What is drawn now | Problem against sources |
|---|---|---|---|
| Road carriageway | `ProceduralGeometryGenerator.ts:417–700` | ribbon per carriageway, colour by class `#262b34`…`#353b45`; class lift to avoid z-fight | flat, untextured, blue-grey; no camber; ribbon vertices only at polyline vertices (no densify) |
| Lane lines | `:498–540` | **continuous** white ribbons 0.12 m | IRC:35-2015 §4.6.2/§4.7.1: lane line **3 m mark + 6 m gap**, **150 mm in urban sections**; one-way / ramps **1.5 m + 3 m** (§4.8.1) [IRC copy]. MoUD CoP-3: lane line 100 mm, 1.5 m mark / 3 m gap [official] |
| Centre line (undivided) | `:544–561` | **double yellow** `#eab308` always | IRC:35-2015 §4.6.1: centre line **white broken 3 m / 6 m** on normal sections; yellow only for no-overtaking (§3.1.4) [IRC copy] |
| Edge lines, stop lines, zebras, arrows | — | none | IRC:35: edge line 150 mm on multi-lane divided roads (§4.5.3); stop line **200 mm** urban (§6.1.3); zebra ≥ 2.0 m wide (§11.3.5) [IRC copy]; CoP-3: edge lines 100 mm, 100 mm off the kerb [official] |
| Median | `:564–572` | box 0.15 m, `#334155` | ok height; no kerb face, no fill/planting, no barrier option |
| Kerb / footpath | `:582–600` | **0.22 m** extrusions, slate colours | USDG p. "footpath … uniform height of maximum 150 mm above road level" [official]; IRC:86-2018 kerb ≤ 150 mm [IRC copy] |
| Cycle track / verge / parking / drain | `:604–650` | 0.05 / 0.02 / 0 / −0.1 m ribbons, green/grey | no surface distinction, no markings (CoP-3 cycle lane symbols) |
| OSM bridge deck | `:655–690` | pale slab + parapets, cylinders every **30 m** | spacing [assumed] in code without a source |
| Flyover | `:797–965` | 0.3 m slab + 2 dark "girder" ribbons 0.65 m + tapered rectangular piers every `pierSpacing` (30), pier caps 1.7 m; amber divider stripe; near-black asphalt `#111827` | girder shape is two strips, not a box; amber stripe is not an IRC marking; deck/asphalt contrast artificial |
| Ramp abutments | `:1228–1435` | blue-grey wedges `#78909c` | no RE / retaining wall faces |
| Double-deck (road + metro) | `:1437–1795` | road deck as flyover; **metro deck 5.0 m** (`:1602`), navy beam, bright-blue parapets, steel-blue rails; single central pier 2.0→1.6 m | Pune viaduct **~8.5 m edge to edge** [official]; colours are UI blues; single pier is right (PIB: "single pier structure" [official], PUNE_PROJECT_FACTS) |
| Metro line (elevated) | `:1796–1830` | 0.4 m slab `#1e293b`, rails `#a5f3fc`, cylinders r = 1.0 m every 30 m, default elevation 12 m | Pune: box girder, track c/c **4.1 m** (code: up to 4.0), spans **13–34 m, avg 25–28 m**, circular pier **2–3 m dia** widening at the top, rail ≥ **8.4 m** above road [official] |
| Metro station | `:2139–2355` | 4 box pillars, concourse + platform slabs, railings, 5 steel arch ribs, translucent canopy; default 140 × 20 × 8 m at 12 m | length 140 m matches the Phase-2 DPR [official]; width: DPR max concourse **17 m (island) / 21 m (side platforms)**; rail level at stations **≥ 13.5 m** [official]; arched canopy style [unknown] |
| Junction (placed) | `:1986–2135` | flat polygons | no stop lines, zebras, kerb returns |
| Utility (in Design) | `:2356–2378` | square ribbon of pipe diameter, Underground legend colours | fine as a schematic; realism = round pipe + material (low value) |
| Tunnel / underground alignment | `engine/underground/UndergroundRenderer.ts:199–230` | Entity `polylineVolume` circle/box, kind colour; defaults circular 6 m, cut-and-cover box 10 × 7 m (`alignmentFactory.ts:17–21`) | **no portals**, no lining; Swargate–Katraj DPR tunnel internal diameter **5.8 m** [official] |
| Building (drawn) | `:113–310` | extruded footprint, usage colour (sky-blue / amber / slate) | usage colour is a legend, not a facade |
| Scene | `components/Viewport3D.tsx:37–65` | `globe.enableLighting = true`; no shadows, no `depthTestAgainstTerrain`, no MSAA/FXAA settings | buried geometry draws on top of terrain; no ambient occlusion cue |

Root causes, in order of visual effect: (1) flat shading; (2) UI colours instead of material colours / textures;
(3) missing street furniture and markings that give scale (lane dashes, kerbs, lights, barriers); (4) wrong proportions
(0.22 m kerbs, thin decks, 5 m metro deck, rectangular pier strips); (5) terrain chording / z-fighting.

## A2. Reference dimensions (single source of truth for the renderer)

All values go into one new file `frontend/src/engine/rendering/standards/visualDims.ts`, each as
`{ value, unit, source, clause, status: 'official' | 'irc-copy' | 'assumed' | 'unknown' }`, mirroring
`engine/geometry/alignment/criteria.ts`. The inspector shows the status next to any dimension it displays.

**Sources read this session**
| Key | Document | URL | Status |
|---|---|---|---|
| PM-DPR2 | Maha-Metro, *Detailed Project Report*, Pune Metro Phase-2 (Line 2A/2B), July 2024 (rev. R2) | https://www.punemetrorail.org/download/DPR01.pdf | **official** |
| PM-NL | Maha-Metro newsletter Oct 2022 ("Reach 1 … 426 are PSC segmental box girder spans … 13 m to 34 m") | https://www.punemetrorail.org/download/Newsletter/October-Newsletter-2022.pdf | **official** (search excerpt only, not opened) |
| SK-DPR | Pune Metro Swargate–Katraj Revised Final DPR (21-12-2022) | https://www.punemetrorail.org/download/Swargate-Katraj%20DPR.pdf (local copy from earlier session) | **official** |
| COP3 | MoUD/IUT Code of Practice for Urban Roads, Part 3 *Road Marking* (2012/13) | https://www.mohua.gov.in/static/uploads/2025/10/d8bd9f37bdbe920c6ff52a64e652baf7.pdf | **official** (recommended practice) |
| IRC35 | IRC:35-2015 *Code of Practice for Road Markings* (2nd rev.) | https://law.resource.org/pub/in/bis/irc/irc.gov.in.035.2015.pdf | IRC copy |
| IRC86 | IRC:86-2018 | https://law.resource.org/pub/in/bis/irc/irc.gov.in.086.2018.pdf | IRC copy |
| SP90 | IRC:SP:90-2023 (mirror file `irc.gov.in.sp.142.2024.pdf`) | see PLANNING_DEFAULTS_DECISIONS.md | IRC copy |
| IRC54 | IRC:54-1974 *Lateral and Vertical Clearances at Underpasses for Vehicular Traffic* | https://law.resource.org/pub/in/bis/irc/irc.gov.in.054.1974.pdf | IRC copy; whether 1974 is still the current edition **[unknown]** |
| USDG | PMC *Urban Street Design Guidelines* 2016 | see CROSS_SECTIONS.md | **official** |

**Values**
| Element | Value | Source | Status |
|---|---|---|---|
| Kerb / footpath height | ≤ **0.15 m** (render 0.15) | USDG §3.1 ("uniform height of maximum 150 mm above road level"); IRC86 median kerb max 150 mm, depressed kerb ≤ 150 mm | official; IRC copy |
| Lane line (urban) | **0.15 m** wide, **3 m mark / 6 m gap**; warning section 3 / 3 | IRC35 §4.6.2, §4.7.1–4.7.2 | IRC copy |
| Lane line (one-way, ramp, slip road) | 0.15 m, **1.5 m / 3 m** | IRC35 §4.8.1–4.8.2 | IRC copy |
| Centre line, undivided, normal section | white broken **3 m / 6 m**, 0.15 m urban | IRC35 §4.6.1 and note under Table 4.3 ("increased to 150 mm for urban sections") | IRC copy |
| Edge line, divided multi-lane | **0.15 m** (0.2 m expressway) | IRC35 §4.5.3 | IRC copy |
| Edge line offsets | 0.1 m from kerb (MV), 0.15 m (bus lane); median-side line yellow | COP3 §(3) Yellow solid line | official |
| Stop line | **0.2 m** urban, 2–3 m before a zebra (unsignalised); at signals zebra 1 m ahead of the signal and stop line 1 m before the zebra | IRC35 §6.1.3, §11.3.2 | IRC copy. (COP3 says 600 mm and 1.2 m — conflicting; use IRC35, show both in the source note) |
| Zebra crossing width | ≥ footpath width, min **2.0 m**, usually 2–4 m; refuge ≥ **1.2 m** if > 10.5 m in one go | IRC35 §11.3.5, §11.3.3 | IRC copy |
| Zebra stripe width / gap | 0.5 m / 0.5 m | IRC35 Table A.4 not transcribed | **assumed** |
| Marking colours | white; yellow = IS colour No. 356 | IRC35 §2.6 | IRC copy |
| Directional arrow length | 3.5 m (50 km/h) | COP3 §(4) | official |
| Streetlights | footpath/cycle track pole 4.5–6 m at 12–16 m; RoW ≤ 9 m: 8–10 m at 25–27 m; RoW > 9 m: 10–12 m at 30–33 m | IRC86 Table 5.6 (read 2026-11-21, TRANSPORT_TOOLS_CS2_RESEARCH §2.1) | IRC copy |
| Street trees | continuous tree line, pit ≥ 1 × 1 m, canopy clearance ≥ 3 m | IRC86 §5.1.10 | IRC copy |
| Vertical clearance under a road deck (road under) | **≥ 5 m** at underpasses | IRC54 §8 ("shall be at least 5 metres") | IRC copy (SP90 §4.18.2 refers to IRC:54 / SP:84 / SP:87; its Table 4.17 values did not extract) |
| Clearance under metro viaduct over road | **5.5 m** beyond the crash-barrier face; min rail level above road **8.4 m** | PM-DPR2 §5.7.1.2 | official |
| Footway / cycle-track clearance under structures | ≥ **2.25 m** | SP90 §4.18.3 | IRC copy |
| Flyover span (road) | 30 m (current code) | none found (SP90 points to IRC:SP:54, not read) | **assumed** |
| Flyover box-girder depth | 2.0 m | none found | **assumed** |
| Flyover crash barrier / parapet | Jersey profile, 0.9–1.0 m high | SP90 §4.4 requires crash barriers "as per IRC:5" (IRC:5 not read); PM-DPR2 uses a 1.0 m Jersey barrier around metro piers | height **assumed** |
| Flyover ramp | solid RE-wall ramp low, viaduct spans higher; "in built-up sections viaduct spans shall be provided in the approaches" | SP90 §7.2 | IRC copy; the RE-wall height limit ("as per guidelines") **[unknown]** |
| Metro viaduct type | precast segmental **box girder** on single RC pier with pier cap; double U-girder = option | PM-DPR2 §5.7.1.1 (recommendation), PM-NL | official |
| Metro deck width | **~8.5 m** edge to edge (Phase-1 viaduct) | PM-DPR2 (station planning chapter: "The existing viaduct structure of elevated Metro for Phase-1 is about 8.5 m (edge to edge) wide") | official |
| Metro setback | **5 m** clear from each viaduct edge (10 m from centreline each side) | same paragraph | official — also a screening rule (§B4 #6) |
| Track centres | **4.1 m** | PM-DPR2 §5.7.1.1 | official |
| Metro spans | 13–34 m, average 25–28 m (render default 28 m; obligatory spans as drawn) | PM-DPR2 §5.7.1.1; PM-NL | official |
| Metro pier | circular, **2.0–3.0 m dia** "for most of its height", widening at the top under the box webs; 1.0 m Jersey crash barrier around it, 25 mm gap | PM-DPR2 §5.7.1.2 | official |
| Box-girder depth, soffit width | 3.5 m bottom width seen only in a non-official article | — | **unknown** (render 2.0 m depth, 4.0 m soffit, **assumed**) |
| Metro parapet height | — | — | **assumed** 1.0 m |
| Elevated station | 140 m long, two levels; concourse max width 17 m (island) / 21 m (side platforms); rail level ≥ 13.5 m; concourse clear height 3.55 m, concourse floor structure 1.85 m, track structure 1.8 m, platform 1.09 m above track | PM-DPR2 §6.1.3 and station-planning norms | official |
| Underground station box | 153.4 m × 23.73 m, 4 levels | SK-DPR | official (that line only) |
| Bored tunnel | internal diameter **5.8 m** | SK-DPR | official (that line only); lining thickness **[unknown]** |
| Tunnel portal / ramp | grade ≤ 3 % desirable, 4 % where unavoidable (metro); road ramps D5 4 % | SK-DPR §5 (GEOMETRY_EDITOR_DESIGN §2.2); D5 | official / IRC copy; portal headwall dims **assumed** |
| Pune BRT platform height | 880 mm (Pimpri-Chinchwad "Rainbow"), stations ~500 m apart | IRC:124-2017 comparison table | IRC copy (a reported figure, not a design rule) |

Rule for the renderer: an **assumed** dimension is drawn (a structure without a girder would look wrong) but the inspector
lists it under "Drawn with assumed dimensions"; an **unknown** structural type (e.g. U-girder) is drawn as the generic
form with a dashed outline in Schematic and a note "type not confirmed".

## A3. Rendering approach within CesiumJS 1.143 [proposed]

Checked in `frontend/node_modules/cesium` (1.143.0, 2026-07-01): `Material` loads `.ktx2` images (`Material.js` imports
`loadKTX2`), `ClippingPolygonCollection` (terrain/tileset clipping), `ImageBasedLighting`, glTF `Model` with GPU instancing
(`Model/InstancingPipelineStage.js`, glTF `EXT_mesh_gpu_instancing`), custom `Appearance` with own shaders on `Primitive`.

**A3.1 Visual style.** New store value `visualStyle: 'realistic' | 'schematic'` (Layers panel, next to Satellite / Terrain;
persisted per user in localStorage; command palette entry "Visual style"). Schematic = today's look (flat, legend colours),
kept for legibility, printing and traffic tint. Realistic = lit, material colours / textures, props, markings. Simulate's
traffic tint, the selection colour and proposal-vs-baseline highlighting must work in both (A3.3).

**A3.2 Lighting and normals (biggest win, no textures).**
- `flat: false` in Realistic; the sun already drives `globe.enableLighting`. Add a fixed hemisphere ambient term in the
  custom shader so shaded sides never go black.
- Hard edges: `generateRibbon(…, thickness)` emits top, bottom and side faces from **shared** vertices, so `computeNormal`
  smooths a box into a blob. Emit **separate vertices per face** (top/bottom/left/right), write normals explicitly, and skip
  `computeNormal`. Same in `generateLocalBox`, `generateTaperedRectangularPier`, `generateCylinder` (cylinders keep smooth
  side normals, flat caps).
- Optional sun shadows only on the **High** tier and only for the selected object's tile (shadow maps cost a full depth
  pass); off by default.

**A3.3 Materials and textures.**
- `MaterialConfig` gains `materialId: 'asphalt' | 'asphalt_worn' | 'concrete_deck' | 'concrete_pier' | 'kerb_stone' |
  'paver_footpath' | 'cycle_track' | 'grass_verge' | 'soil' | 'marking_white' | 'marking_yellow' | 'steel_rail' |
  'ballastless_track' | 'retaining_wall' | 'tunnel_lining' | 'glass'` and keeps `color` (Schematic and tint).
- UVs: `generateRibbon` writes `u` = metres across (offset from the centreline) and `v` = cumulative metres along; side
  faces use metres along × metres up. Texture repeat is then real-world (e.g. 4 m tiles).
- One **texture atlas** per map type (albedo; optional roughness/normal on High), 2048² with 4 × 4 slots of 512², KTX2
  (UASTC/ETC1S) with a JPEG/PNG fallback. Atlas slots avoid one draw call per material and keep the current
  one-Primitive-per-(tile, layer) batching. Wrap inside a slot in the fragment shader (`fract(uv / tileSizeM)` mapped
  into the slot rect, with a half-texel inset and `textureGrad` to avoid seams in mip selection).
- **`TexturedTintAppearance`** (new `engine/rendering/appearance/TexturedTintAppearance.ts`): a Cesium `Appearance` with a
  custom vertex/fragment shader; vertex format position + normal + st (+ `batchId`); reads the per-instance `color` attribute
  the same way `PerInstanceColorAppearance` does (the Primitive batch table), so `setColor` (traffic tint) and selection keep
  working: final = albedo(atlas, materialSlot) × mix(white, tint, tintStrength) × lambert(sun) + ambient. The material slot
  rides as a second per-instance attribute (`ShowGeometryInstanceAttribute`-style custom attribute; spike needed to confirm
  custom instance attributes on a custom appearance — fall back to one Primitive per (tile, layer, material) if not).
- Not full PBR on procedural meshes: a roughness-lite term is enough at city scale and much cheaper. Full PBR is used only
  where glTF models are used (props, A3.6), which Cesium shades physically already.
- **Texture sources (CC0, no attribution required):** ambientCG — "All ambientCG assets are provided under the Creative
  Commons CC0 1.0 Universal License" (https://docs.ambientcg.com/license/) [read]; Poly Haven — "Our assets are all licensed
  as CC0" (https://polyhaven.com/license) [read]. Pick from their Asphalt, Concrete, PavingStones, Ground/Grass, Metal
  categories; record each chosen asset id, URL, licence and download date in `frontend/public/textures/ASSET_LICENCES.md`
  and in DATA_CATALOGUE as an asset (not data). Specific asset ids were **not chosen in this session**. Bake to 512² slots,
  tone toward Pune materials (grey bituminous carriageway, light concrete decks, grey/red interlocking pavers on footpaths per
  USDG photos — colour choice **assumed**). Poly Haven HDRIs are **not** used: Cesium's own atmosphere/IBL is enough and HDRI
  skyboxes would compete with the satellite basemap.

**A3.4 Markings as decals.** Markings stay their own `marking` layer but become real IRC:35 patterns: a dash generator
(`dashPieces(path, markM, gapM, phaseM)`) cut along the stationed centreline; lane lines 0.15 m 3/6 m, centre line white
broken on undivided roads, edge lines 0.15 m, median-side yellow (COP3), stop lines 0.2 m and zebras at junction approaches
(from `junctionLayout` / `junctionGaps.ts`), arrows (3.5 m) on approach lanes as textured quads from the atlas. Render 2 cm
above the surface with a polygon-offset render state instead of the class lift. Dashes are geometry only below 400 m camera
height; above it the line is drawn continuous at 50 % alpha (reads as a dash at distance and saves vertices).

**A3.5 Structural profiles (one extrusion routine).** Add `extrudeProfile(path, profile2D, opts)` to the generator: sweeps a
closed 2D section (metres, local x across / y up) along the stationed path with mitred joints, per-face normals and UVs.
Profiles in `engine/rendering/standards/profiles.ts`:
- Jersey (New-Jersey) crash barrier / parapet [shape **assumed**, height per A2];
- road flyover deck: slab + **trapezoidal box girder** (depth 2.0 m, soffit 0.5 × deck width, **assumed**), cantilever
  wings; replaces the two "girder" strips;
- metro deck: box girder 8.5 m top width [official], soffit / depth **assumed**, two parapets, plinths, rails at 4.1 m centres
  and standard gauge (1,435 mm, already `trackGauge`);
- U-girder (option): two U sections, one per track — dimensions **[unknown]**, drawn only when the user picks it;
- kerb with 0.15 m face and 0.05 m chamfer [chamfer assumed]; median kerb + planted top;
- RE / retaining wall: vertical face with panel texture along ramp sides where the ramp is solid (below the RE-wall
  threshold, **[unknown]** → user setting with "assumed 3 m" default), viaduct spans above it (SP90 §7.2).
Piers: metro = circular 2.0 m (default, editable 2–3 m) with a flared head (cone frustum) and a rectangular pier cap,
1.0 m Jersey barrier ring with 25 mm gap [official]; road flyover = current tapered rectangular piers + caps; spans from
`pierSpacing` (metro default 28 m [official range], road 30 m [assumed]); piers skip positions that fall inside a drawn
road carriageway below (obligatory span) and warn instead of drawing a pier in a carriageway.

**A3.6 Instanced props (glTF).** Streetlight (single / double arm), street tree (2–3 low-poly species shapes; no species
claims), bollard, signal head on pole, bus shelter, Jersey barrier end, metro station entry canopy. Each ≤ 300–800
triangles, PBR, KTX2 textures, authored in Blender from scratch or from CC0 Poly Haven models (licence logged as above).
Placement by rule: lights from IRC86 Table 5.6 spacing by RoW and side; trees in the verge / MUZ strip at 8 m [assumed
spacing] with pit 1 × 1 m; bollards at cycle-track starts (USDG: ≤ 0.4 m high). One `Model` per prop type per tile
using `EXT_mesh_gpu_instancing` (instance transforms generated in JS and written into an in-memory glTF), or
`Cesium3DTileset`-free `ModelInstanceCollection`-style batching if the spike shows in-memory glTF is too slow to rebuild.
Props are **visual only and labelled "indicative placement"** unless the user places them explicitly (§B4 #4).

**A3.7 Tunnels and portals.** Above ground, a portal is what the public sees: a cut-and-cover **boat section** (U-shaped
retaining walls + base, open to the sky) from the 0 m point down the ramp grade until the crown is ~1 m below ground
[assumed], then a **portal headwall** (box face with the tunnel opening, coping, 0.5 m thick [assumed]) and the tube.
Terrain over the boat section is cut with a `ClippingPolygon` (A4). Below ground, keep the Underground workspace's
`polylineVolume` view (it is a screening view with certainty colouring) and in Design-Realistic add a segment-lined inner
surface texture only when the camera is under ground (Underground cutaway). Defaults: bored 5.8 m internal diameter
[official, S–K DPR], cut-and-cover box as today [assumed].

**A3.8 Buildings drawn in Design.** Neutral facade material (plaster / glass band texture, **assumed**), roof slab colour;
usage colour only in Schematic or as a thin roof outline. Existing 3D city model buildings are untouched.

## A4. How the design should sit on terrain [proposed]

Today: ground = bilinear Cesium World Terrain samples; ribbons use only polyline vertices → chording; no terrain depth test;
the earlier DEM work notes the screening DEM is a ~30 m DSM (trees and roofs inside it), so "following the ground" exactly
would make roads ride over canopy bumps.
1. **Densify** every ribbon to ≤ 5 m along (≤ 2 m on curves already densified by the alignment module) when terrain is on;
   sample ground at each station.
2. **Smoothed vertical profile for at-grade roads:** ground at the centreline filtered with a 30 m moving median
   [assumed window], then a cross-fall of 2.5 % from the crown [**assumed**; IRC:86 camber clause not transcribed] instead of
   draping each edge to its own sample. Roads never go below the median ground by more than 0.3 m (avoid burying).
3. **Embankment / cut skirts:** where the road surface departs from ground by > 0.3 m, draw side slopes 1V:2H [assumed]
   down/up to the sampled ground (soil/grass material), or a retaining wall when a slope would leave the RoW (if RoW known).
   This is also how CS2 shows cut-and-fill (DD1/Quays patch: retaining walls appear on the lower side automatically).
4. **Terrain clipping** with `globe.clippingPolygons` (`ClippingPolygonCollection`) for boat sections, depressed roads and
   underpass cuts, so terrain does not cover them; one collection, rebuilt on object change; capped at ~32 polygons in view
   [assumed budget; clipping cost grows with polygon count].
5. `scene.globe.depthTestAgainstTerrain = true` in Design when terrain is on (off in Schematic so buried items stay
   visible, as today); OSM-imported roads keep the class lift.
6. Structures (piers, abutments) start at the sampled ground under each pier; a pier on a slope gets a footing block
   down to the lowest corner (same idea as `withFlatGround` for buildings).
7. Terrain off: everything as today on the ellipsoid (0 m), so behaviour without a Cesium ion token is unchanged.

## A5. LOD and performance budget for weak GPUs [proposed; numbers are targets, assumed]

Target machine: integrated graphics (Intel UHD 620 class), 1080p, Chrome/Edge, WebGL 2.
| Tier | Auto rule | Realistic content |
|---|---|---|
| Low | `maxTextureSize < 8192` or measured frame time > 33 ms for 3 s, or user pick | lit + material colours, no textures, no props, markings continuous, no shadows; MSAA off, FXAA on |
| Medium (default) | otherwise | albedo atlas, markings dashed < 400 m, props < 600 m, no shadows |
| High | user pick | + roughness/normal atlas, props < 1,200 m, optional sun shadows for the selected tile, MSAA 4× |

Camera-height layer rules (extend `isLayerVisible`): kerb faces, barriers, props, dashes < 400–600 m; markings < 1,200 m;
decks, piers, surfaces always. Budgets per frame for Design objects: ≤ 300 draw calls; ≤ 1.5 M triangles in view; texture
memory ≤ 48 MB (one 2048² KTX2 atlas ≈ 4–6 MB compressed per map; JPEG fallback ≈ 22 MB with mips); tile rebuild ≤ 50 ms
(measure with the existing `window.last_road_rebuild_time`). Turn on `scene.requestRenderMode` in Design while nothing
animates (Environment already does this, `components/environment/envPerf.ts`). Keep geometry generation in the
`MeshCache`; move `generateMeshData` for whole tiles to a worker later (Primitive with custom `Geometry` cannot use Cesium's
own async workers, so `asynchronous: false` stays and generation must be cheap).
An on-screen FPS / draw-call readout behind `?perf=1` for testing.

## A6. File-level implementation steps, ranked (effort S ≤ 1 agent-day, M 2–4, L ≥ 1 week)

| # | Step | Files | Effort |
|---|---|---|---|
| R1 | **Visual style switch + lit shading + hard-edge normals.** Store + Layers-panel toggle + palette command; `TileBatchRenderer.rebuild` picks `flat` by style; per-face vertices and explicit normals in `generateRibbon`, `generateLocalBox`, `generateTaperedRectangularPier`, `generateCylinder`; `CesiumAdapter.buildGeometry` skips `computeNormal` when normals are given; replace UI colours by material colours in Realistic (one `materialColor(materialId)` table) | `engine/rendering/visualStyle.ts` (new), `renderers/TileBatchRenderer.ts`, `adapters/CesiumAdapter.ts`, `geometry/ProceduralGeometryGenerator.ts`, `types.ts`, Layers panel component, `CommandPalette.tsx` | S–M |
| R2 | **Standards-correct dimensions and markings.** `standards/visualDims.ts` (A2 table with status); kerbs/footpaths 0.15 m; IRC:35 dashed lane / centre / edge lines, median-side yellow; stop lines + zebras + arrows at junction approaches; metro double-deck deck 8.5 m, track centres 4.1 m, metro default elevation from the 8.4 m rule (rail ≥ 8.4 m over road) and stations ≥ 13.5 m; station width defaults 17/21 m by platform type; inspector "Drawn with assumed dimensions" list | `standards/visualDims.ts` (new), `ProceduralGeometryGenerator.ts` (`generateRoadMeshes`, `generateJunctionMeshes`, `generateMetroFlyoverMeshes`, `generateMetroLineMeshes`, `generateMetroStationMeshes`), `geometry/junctionGaps.ts`, `objects/types.ts` (defaults only; existing objects keep stored values), `PropertiesPanel.tsx` | M |
| R3 | **Terrain fit.** Densify, smoothed profile, skirts, `depthTestAgainstTerrain`, clipping polygons, pier footings | `ProceduralGeometryGenerator.ts` (`generateRibbon` gets a densify step and a profile function), `engine/terrain/groundProfile.ts` (new, pure: median filter + cross-fall), `engine/terrain/terrainClipping.ts` (new), `TwinCityEngine.applyBaseLayers` | M |
| R4 | **Structural profiles.** `extrudeProfile`; box girder decks (road + metro), Jersey barriers, pier heads and caps, circular metro piers with barrier rings, RE / retaining walls on ramps, obligatory-span pier skipping | `ProceduralGeometryGenerator.ts` (`generateFlyoverMeshes`, `generateFlyoverRampAbutments`, `generateMetroFlyoverMeshes`, `generateMetroLineMeshes`), `geometry/extrudeProfile.ts` (new), `standards/profiles.ts` (new) | M |
| R5 | **Textures.** UVs in metres; `materialId`; `TexturedTintAppearance` with atlas; KTX2 + fallback; asset licence file; spike first on the custom instance attribute question | `types.ts`, `appearance/TexturedTintAppearance.ts` (new) + GLSL, `TileBatchRenderer.ts`, `frontend/public/textures/*`, `ASSET_LICENCES.md`, `DATA_CATALOGUE.md` | M |
| R6 | **Instanced props.** Streetlights, trees, bollards, signal heads, bus shelters; placement rules; LOD distance | `renderers/PropRenderer.ts` (new), `engine/rendering/props/placement.ts` (new, pure), `frontend/public/models/*.glb` | M |
| R7 | **Tunnel portals and lining.** Boat section, headwall, clipping, Design-side portal meshes from underground alignments | `ProceduralGeometryGenerator.ts` (new `generatePortalMeshes`), `engine/underground/alignmentGeometry.ts` (portal station), `UndergroundRenderer.ts` (lining texture in cutaway) | M |
| R8 | **Tiers and budget.** Auto tier, FPS probe, `requestRenderMode` in Design, layer-distance table per tier, FXAA/MSAA | `engine/rendering/qualityTier.ts` (new), `lod/LODController.ts`, `Viewport3D.tsx` | S–M |

Order: R1 → R2 → R3 can ship independently and already remove most of the "fake" look; R4 and R5 next; R6–R8 after.
Tests to add with each step (Vitest, in `engine/testing/`): per-face normals are unit and outward; UV v grows by metres;
dash pattern lengths (3/6, 1.5/3) and widths; kerb height 0.15; metro deck 8.5 and track centres 4.1 from `visualDims`;
every `assumed` value appears in the inspector list; densified ribbon max segment ≤ 5 m; profile never below ground
−0.3 m; Schematic output identical to today's meshes (snapshot) so the toggle is safe.

---

# Part B — Buildable tools

## B1. CS2 buildables, verdicts and Indian standards

CS2 sources: Paradox feature page *Road Tools* https://www.paradoxinteractive.com/games/cities-skylines-ii/features/road-tools
and the same Colossal Order Dev Diary #1 [read 2026-11-21]; Dev Diary #3 transport [read 2026-11-21]; Detailer's Patch #2
[read 2026-11-21]; Quays & Piers patch https://www.paradoxinteractive.com/games/cities-skylines-ii/news/quays-and-piers-patch
[excerpt this session: quays "create a retaining wall on the lower side"; roads and paths create retaining walls "only when
there is a significant elevation change"]; Building for Bicycles diary [read 2026-11-21]; CS2 wiki *Roads*, *Landscaping*,
*Beginner's guide* (cs2.paradoxwikis.com) [excerpt only — the wiki refuses direct fetches]. A separate "retaining wall"
road upgrade exists only in a community mod (ST-Apps/CS2-ExtendedRoadUpgrades), so it is **not** a CS2 feature.

Availability codes: **OFF** official copy read · **IRC** IRC text on law.resource.org, unconfirmed · **CAT** listed in the IRC
sales catalogue (irc.nic.in, 2025) only, no copy · **DRAFT** draft on irc.nic.in · **3P** third-party copy only.
"Built" = exists in the app today [app].

| CS2 buildable | Verdict | Governing standard(s) | Text obtainable? | Screening checks it enables | Downstream effects | Built? |
|---|---|---|---|---|---|---|
| Road types (small/medium/large/highway, one-way, asymmetric) | Keep (as cross-section templates) | IRC86 Table 5.5; USDG ch. 8; MoUD CoP-1 | OFF (USDG, CoP-1); IRC86 = IRC | lane, footpath, median, RoW fit (built) | Simulate lanes/capacity (IRC:106 already) | **Yes** (5 USDG templates) |
| Replace / upgrade brush | Keep | same | same | before/after check counts | same | Whole-road upgrade **yes**; partial-length brush no |
| Grass / trees upgrade | Keep as *street trees / planted median* | IRC86 §5.1.10; USDG (MUZ); Pune Cycle Plan *Street Vegetation Guidelines* | IRC; OFF; Cycle Plan = 3P (punecycleplan.wordpress.com; no pmc.gov.in copy located) | pit ≥ 1 × 1 m; canopy clearance ≥ 3 m; trees clear of sight triangles at junctions | Environment: count of trees added/removed vs tree census layer (screening); Underground: tree pits over utilities → "requires investigation" | No |
| Wide sidewalk | Keep (footpath width in templates) | USDG §3.1; IRC86 Table 5.1 | OFF / IRC | footpath ≥ 2.0 / 1.8 m (built) | Simulate: pedestrian not modelled → no effect stated | **Yes** |
| Sound barriers | Keep as a flag + visual on flyovers/metro | SP90 §6.4.6 (aesthetics of noise barriers only); no Indian barrier-design standard read | IRC | none (no noise model; Environment noise not wired) | Environment: "noise barrier proposed" note only | No |
| Street lighting | Keep (roadside element) | IRC86 Table 5.6 | IRC | pole height/spacing vs RoW class | none (energy not modelled) | No |
| Bus lane / bus-only road | Keep | IRC:124-2017 §6.1 (BRT lane 3.5 m one-way, passing lane 4 m, divider ≥ 0.5 m, ≥ 1 m at crossings); CoP-1 bus lane 3.5 m; USDG BRT; CoP-3 bus-lane markings | IRC (IRC:124 on mirror, not in its index); OFF | lane width; divider; BRT on RoW < 30 m (USDG) | Simulate: removes a mixed lane, bus speed/priority (needs transit model); Projects: overlap with PMPML/BRT corridors | No |
| Tram tracks | Keep as *light-rail corridor* (Metrolite / Metro Neo) | MoHUA Metrolite spec (2019); Metro Neo (2020) | Metrolite = 3P copy read 2026-11-21; Metro Neo = excerpt | RoW 7.6 / 8.0 m, radius ≥ 25 m | Simulate: lane removal | No |
| Bicycle lane / path, divided ped–cycle path | Keep | IRC:11-2015 (Table: segregated track desirable 2.5–5.0 m; 2.2 m min two-lane; painted lane 1.2 m min); IRC86 §5.3; USDG §3.2; Pune Cycle Design Guidelines 2017 | IRC (IRC:11-2015 on mirror, not in index); OFF (USDG); 3P (Pune) | width, buffer 0.5 m, height 100–150 mm (IRC86), continuity at junctions | Simulate: none (bikes not modelled — say so); Environment: none | Width in templates **yes**; standalone path no |
| Pedestrian path / pedestrian street / elevated & tunnel paths | Keep (path + FOB/subway) | IRC86 §5 and Annexure I (FOB/subway "discouraged"); IRC:103 (2022 edition: CAT only; drafts on irc.nic.in); SP90 §4.18.3 clearance 2.25 m | IRC; DRAFT; CAT | width; FOB → walking-detour flag; clearance 2.25 m; ramp grades **[unknown — IRC:103 not read]** | Underground: subway vs utilities; Projects | No |
| Crosswalks | Keep (zebra, raised, mid-block) | IRC35 §11.3 (≥ 2 m, refuge ≥ 1.2 m when > 10.5 m, stop-line set-backs); IRC86 (raised crossings ≥ 3 m, ramps 1:8; mid-block every 50–200 m); USDG (every 150 m on BRT) | IRC; OFF | spacing along a corridor; refuge; set-backs | Simulate: pedestrian phase at signals (exists in signal plans) | Pedestrian crossing flag on placed junctions only |
| Traffic lights | Keep | IRC:93-1985 *Design and Installation of Road Traffic Signals* (warrants: min vehicular volume, interruption, min pedestrian volume …); CoP-2 Table 2-1 | IRC (title verified); OFF | signal warrant screen from Simulate volumes (values to transcribe) | Simulate: signal plan (exists) | **Data yes** (JunctionPanel); map brush no |
| Stop signs / priority | Keep | IRC:67-2022 (CAT; a mirror copy sits under a mismatched file name, not read); MoUD CoP-4 *Signages* (OFF link found, not read) | CAT / OFF | — | Simulate: priority control (exists) | **Data yes** |
| Turn bans / lane connections | Keep | — (traffic management) | — | banned movement must leave a legal route (network check) | Simulate (exists) | **Data yes** |
| Roundabouts | Keep | **IRC:65-2017** Table 6.1 (urban single-lane ICD **28–40 m**, CCW 12–8 m; double-lane 40–70 m; rotary > 70 m), Table 6.2 (ICD 28/30/32/36/40 → central island 4/8/12/18/24 m); CoP-2 Table 2-6 (mini 13–25 m …) | IRC (IRC:65 on mirror, not in index); OFF | ICD vs category; island vs ICD; arm count ≤ 4 for Table 6.1; entry deflection **(rule text not transcribed)** | Simulate: new control kind (priority to circulating) | No (OSM tag only) |
| Premade intersections / interchanges | Keep as *junction templates* | IRC:SP:41-1994 (at-grade; kerb radii and design-vehicle turning tables 4.3–4.5); IRC:92 interchanges (not checked); IRC86 §5.1.3 corner radii | IRC (SP:41 title verified); unknown | corner radius ≤ 9 / ≤ 4 m (IRC86); design-vehicle swept path (SP:41 tables, not transcribed) | Simulate: geometry → lanes | No |
| Elevated road / bridge / flyover | Keep | SP90-2023 (grades D5, clearances §4.18, barriers §4.4, ramps §7.2); IRC:54-1974 (≥ 5 m vertical clearance) | IRC | grade 4 % / 3.3 % (built), **clearance over crossed roads ≥ 5 m**, metro clearance 5.5 m | Simulate: grade-separated movement (flyover exists); Underground: pier foundations vs utilities (whether drawn flyover piers are screened today was not checked) | Flyover tool **yes**; levels while drawing no |
| Cut-and-fill road / underpass | Keep | IRC:54 (clearance), SP90 §4.18 (underpass openness) | IRC | clearance, ramp grade, drainage flag ("sump needed" — no standard read) | Underground: conflict with utilities and groundwater (exists for alignments); Environment: flood-prone flag (not wired) | Depressed level exists for OSM roads only |
| Tunnel | Keep | SK-DPR (metro); no Indian road-tunnel code read (IRC:SP:91 road tunnels — **not checked**) | OFF / unknown | depth, cover, radius (built in Underground) | Underground screening (exists) | **Yes** (Underground tool); portals no |
| Quays / retaining walls | Keep only as *retaining walls generated by level changes* (§A4) and as a riverfront-road edge type | SP90 §7.2 (RE walls on ramps); no design standard for heights read | IRC | wall height shown; RoW take | Environment: riverfront / blue-line flags (overlay exists in Environment) | No |
| Piers / harbours, ferries | Drop | — | — | — | — | — |
| Parking (kerbside, lots, buildings, parking roads) | Keep kerbside + no-parking zones; lots as land use only | USDG parking (2 × 5 m car bay, ≤ 22 m runs, none 50 m before / 20 m after a bus stop); IRC86 (restrict on arterials); IRC:11-2015 parking widths 1.8–2.5 m; Pune Parking Policy 2017 (not read) | OFF; IRC | bay size, run length, bus-stop exclusion, arterial restriction | Simulate: kerb lane friction (not modelled — state it); capacity count | Parking width in templates **yes** |
| Bus stop sign / shelter | Keep | CoP-1 §5.9 (500 m–1 km spacing, near side); USDG (shelter 10 × 1.5 × 2.2 m, ~50 m from junction, in parking strip); IRC:124 (median stations ≥ 3.5 m inner clear, 4 m outer); Pune BRT 880 mm platform (IRC:124 table) | OFF; IRC | spacing, junction distance, shelter fits footpath without cutting clear width < 2 m | Simulate: dwell / bus lines (needs transit model); Projects | No |
| Train / subway tracks, stations | Keep | PM-DPR2, SK-DPR | OFF | radii, grades (built); **5 m setback each side** (new) | Underground, Projects (exist) | **Yes** |
| Line tool / waypoints | Keep (later) | — | — | stop spacing on a line | Simulate transit (not built) | No |
| Grid mode, parallel mode | Keep (drawing aids) | CoP-1 §5.6 service lanes | OFF | — | — | No |
| Noise-reducing trees, land value, happiness, zoning, milestones/unlocks, budgets/upkeep, road condition & maintenance depots, snowploughs, taxis, cargo, airports | **Drop** (game mechanics; no decision value; costs later only via Maharashtra PWD SSR 2022-23 quantities, D10) | — | — | — | — | — |
| Roadside tree species selector, decorative bridge skins, cul-de-sac skins | Drop (decoration) | — | — | — | — | — |
| Bicycle restriction policy, urban cycling policy | Drop as tools (policy, not geometry) | — | — | — | — | — |

## B2. Standards availability (checked this session)

| Standard | Where it was checked | Result |
|---|---|---|
| IRC:35-2015 markings | law.resource.org `irc.gov.in.035.2015.pdf` (not in the directory index; found by search); irc.nic.in catalogue lists it (₹1,000) | **IRC** — read |
| MoUD CoP Part 3 Road Marking, Part 4 Signages | mohua.gov.in static uploads (2025/10) | **OFF** — Part 3 read; Part 4 link found, not read |
| IRC:93-1985 signals | law.resource.org `irc.gov.in.093.1985.pdf` | **IRC** — title verified; warrant values not transcribed |
| IRC:SP:41-1994 at-grade intersections | law.resource.org | **IRC** — title verified; tables not transcribed |
| IRC:65-2017 roundabouts | law.resource.org `irc.gov.in.065.2017.pdf` (not in index); irc.nic.in catalogue | **IRC** — Tables 6.1, 6.2 read |
| IRC:124-2017 BRT | law.resource.org `irc.gov.in.124.2017.pdf` (not in index); irc.nic.in catalogue | **IRC** — §6.1 read |
| IRC:11-2015 cycle tracks | law.resource.org `irc.gov.in.011.2015.pdf` (not in index; index has only 1962); catalogue | **IRC** — width table glanced, not transcribed |
| IRC:103 pedestrian facilities | mirror file labelled `103.2022` is actually IRC:5-2024; irc.nic.in hosts **drafts** (Aug 2020, Jan 2021); catalogue lists IRC:103-2022 (₹700) | **CAT + DRAFT** — not read; final text not obtainable |
| IRC:67-2022 signs | mirror file labelled `067.2022` is IRC:136-2023; a search result shows IRC:67-2022 under `irc.gov.in.130.2020.pdf` | **IRC (mislabelled), not read** |
| IRC:54-1974 clearances | law.resource.org | **IRC** — §8 read; current edition [unknown] |
| IRC:SP:90-2023 | law.resource.org (`sp.142.2024`) | **IRC** — read (also earlier) |
| IRC:119-2015 traffic safety barriers | catalogue (2022) only | **CAT** — not obtainable |
| Pune USDG 2016 | PMC (byte-identical copy, see CROSS_SECTIONS.md) | **OFF** |
| Pune Comprehensive Bicycle Plan 2017 + Urban Cycle Design Guidelines | approved by PMC GB Res. 693 (14-12-2017) per the document; copies on punecycleplan.wordpress.com and aicma.org; **no pmc.gov.in copy located** | **3P** — not read |
| Pune Metro (Maha-Metro) | punemetrorail.org DPR01 (Phase-2), Swargate–Katraj DPR, newsletters | **OFF** — read |
| MoHUA / CPHEEO (utilities) | see PLANNING_DEFAULTS_DECISIONS D7 | OFF |
| bis.gov.in | BIS does not publish IRC codes (IRC is its own publisher); only the IS colour No. 356 reference in IRC:35 | n/a |
| morth.nic.in | not searched separately; IRC sales contact lists a `@gov.in` MoRTH address but no free copies were found | not found |

Note: the law.resource.org file names do not always match their content (two mismatches found this session plus the
SP:90 one found earlier). Every IRC copy used must have its **title page** checked and recorded, as done above.

## B3. Corrections to earlier plans

- **Roundabout sizes:** TRANSPORT_TOOLS_CS2_RESEARCH.md #9 used MoUD CoP-2 Table 2-6 (mini 13–25 m, compact 25–30 m,
  single-lane 30–40 m, double-lane 45–55 m). IRC:65-2017 Table 6.1 gives urban single-lane **28–40 m** and double-lane
  **40–70 m**, with island sizes in Table 6.2. Use IRC:65-2017 as the primary rule (IRC copy) and show CoP-2 as a second
  source; mini-roundabouts (< 28 m) only from CoP-2, labelled so.
- **Stop line width:** CoP-3 says 600 mm; IRC:35-2015 says 200 mm urban. Use IRC:35 and note the conflict.
- **Metro superstructure:** box girder, not U-girder, for Pune Metro (A0).
- **Double-deck metro deck width 5.0 m** in code vs ~8.5 m official.
- **BRT lanes:** IRC:124 gives 3.5 m per direction plus ≥ 0.5 m divider; USDG "≥ 7 m undivided two-way" remains the Pune
  rule for the two-way busway; both shown.

## B4. Top 8 to build next (ranked; value for a planning authority vs effort)

| # | Tool | What the planner does | Checks (screening wording) | Downstream | Standards | Effort |
|---|---|---|---|---|---|---|
| 1 | **Junction control brush + junction markings** | click a junction: Signal / Priority / All-way stop / Ban turn / Lane links; stop lines, zebras and arrows are generated and drawn (A3.4) | signal-warrant screen against Simulate volumes (IRC:93 Warrant 1–3 values to transcribe first); stop-line set-backs; crossing ≥ 2 m | Simulate (existing `JunctionEditSpec`) | IRC:93-1985, IRC35 §6, §11 | S–M |
| 2 | **Pedestrian crossing tool** (zebra / raised / mid-block, refuge island) | place along a road or at a junction arm; spacing readout to the next crossing | spacing 50–200 m by street type (IRC86) / 150 m on BRT (USDG); refuge ≥ 1.2 m when length > 10.5 m (IRC35 §11.3.3); width ≥ max(2 m, footpath) (§11.3.5); raised crossing ≥ 3 m, ramps 1:8 (IRC86) | Simulate: pedestrian phase / mid-block signal; report | IRC35, IRC86, USDG | S–M |
| 3 | **Bus stop + bus lane / BRT upgrade** | stop on kerb / in parking strip / median (BRT); bus lane as upgrade on the template | stop spacing 500 m–1 km (CoP-1); ~50 m from junction (USDG); no parking 50 m before / 20 m after (USDG); shelter leaves ≥ 2 m clear footpath; BRT lane 3.5 m, divider ≥ 0.5 m (IRC:124 §6.1); median station ≥ 3.5 m inner / 4 m outer | Simulate: lane removal for general traffic (now); bus priority later; Projects: PMPML / BRT overlap | CoP-1, USDG, IRC:124 | M |
| 4 | **Streetlights and street trees as roadside elements** | toggles on the cross-section (side, spacing) + optional explicit placement; drawn by R6 | IRC86 Table 5.6 height/spacing vs RoW class; tree pit ≥ 1 × 1 m, canopy clearance ≥ 3 m; trees and poles never inside the clear walking zone (USDG 2 m) | Environment: trees added/removed vs tree census (screening); Underground: pits/foundations over utility records → "requires investigation" | IRC86, USDG | S–M |
| 5 | **Elevation while drawing + clearance checks + auto retaining walls** (TRANSPORT #8, decision T3) | PgUp/PgDn levels on one road tool; at-grade / cut / elevated / tunnel stretches; ramps from D5 grades; RE wall vs viaduct by height | clearance over crossed roads **≥ 5 m** (IRC:54 §8); under metro **5.5 m** / rail ≥ 8.4 m over road (PM-DPR2); footway/cycle clearance 2.25 m (SP90 §4.18.3); ramp grade (D5); obligatory span — no pier in a carriageway | Simulate (grade separation); Underground (piers, portals); Environment (cut into flood-prone areas, when wired) | IRC:54, SP90, PM-DPR2 | L |
| 6 | **Metro corridor setback and clearance screen** (check on the existing Metro/Double-deck tools, no new object) | automatic on metro objects | **5 m** clear each side of the viaduct edge (PM-DPR2) vs buildings and proposals; road clearance 5.5 m; pier barrier ring inside the median width | Projects coordination (new rule row like the metro NOC rule in `coordination/seed.py`) | PM-DPR2 | S |
| 7 | **Roundabout tool** | click a junction; pick urban single-lane (ICD 28–40) / double-lane (40–70) / mini (CoP-2); island and circulatory width from Table 6.2 | ICD within category; island vs ICD (Table 6.2); ≤ 4 arms for Table 6.1; fits available RoW; pedestrian crossings on arms | Simulate: new control kind (priority to circulating) | IRC:65-2017, CoP-2 | M–L |
| 8 | **Standalone footpaths / cycle tracks / FOB & subway** | Path tool: pedestrian, cycle one-way / two-way, shared; level ground / bridge / subway | IRC:11-2015 widths (segregated desirable 2.5–5.0 m; 2.2 m min two-lane); IRC86 cycle track ≥ 2 m / 3 m, buffer 0.5 m; FOB/subway → "discouraged, adds walking distance" (IRC86 Annexure I); clearance 2.25 m; ramp grades **[unknown]** until IRC:103-2022 is obtained | Underground (subway vs utilities); Simulate: none (say so) | IRC:11-2015, IRC86, SP90 | M |

Next after these: kerbside parking + no-parking zones (USDG, M), traffic calming elements (MoUD CoP-5, IRC:99 — not
checked, M), junction templates per IRC:SP:41 (needs the turning tables transcribed, M–L), noise barriers as a flag (S),
light-rail corridor (M), transit line tool (L).

Prerequisites before coding each tool: transcribe the specific table values listed as "not transcribed" (IRC:93 warrants,
SP:41 tables 4.3–4.5, IRC:65 entry design, IRC:11 Table, IRC35 Table A.4) into the tool's `criteria`-style source file
with page numbers; label each IRC value "IRC text, third-party copy — unconfirmed".

---

## C. Decisions for the user

1. **Default visual style**: Realistic by default with Schematic one click away (recommended), or Schematic by default?
2. **Metro superstructure default**: box girder (Pune Phase-1/2 official) with U-girder as a "type not confirmed" option —
   agree? For PMRDA Line 3 no official superstructure source was read.
3. **Assumed structural dimensions** (road flyover span 30 m, box depth 2.0 m, barrier height 1.0 m, RE-wall threshold 3 m,
   cross-fall 2.5 %, side slopes 1:2): draw them labelled "assumed" (recommended), or draw schematic-only until sourced?
4. **Texture sources**: CC0 only (ambientCG, Poly Haven) — agree? (No attribution needed; we will still log asset ids.)
5. **Weak-GPU default tier**: Medium with auto-drop to Low (recommended)?
6. **IRC copies**: keep using law.resource.org copies labelled "unconfirmed", or buy IRC:35-2015, IRC:65-2017, IRC:124-2017,
   IRC:11-2015, IRC:103-2022 (catalogue prices ₹400–1,000 each) to confirm before external use?
7. **Top-8 order**: as in B4, or move roundabouts (#7) above elevation-while-drawing (#5) because #5 is L effort?

## D. Not verified / gaps
- Not read: IRC:103-2022 (only drafts available), IRC:119 barriers, IRC:SP:54 spans, IRC:5 barrier clauses, IRC:SP:91 road
  tunnels, IRC:92 interchanges, IRC:99 traffic calming, MoUD CoP-4, Pune Cycle Plan guidelines, Pune Parking Policy.
- Not transcribed: IRC:93 warrant values, IRC:SP:41 Tables 4.3–4.5, IRC:65 entry-design rules, IRC:11 width table rows,
  IRC:35 Table A.4 zebra stripes, SP90 Table 4.17 (did not extract).
- Pune Metro box-girder depth and soffit width, parapet height, station roof form, Line 3 superstructure: unknown.
- PM-NL newsletter seen only as a search excerpt.
- Cesium spikes needed: custom per-instance attribute on a custom appearance; in-memory glTF instancing rebuild cost;
  clipping-polygon cost with many polygons.
- Effort sizes are estimates against the code at `640da42`; nothing was built or measured.
