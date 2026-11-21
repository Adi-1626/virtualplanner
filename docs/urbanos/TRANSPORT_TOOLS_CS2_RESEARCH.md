# Transport build tools: what to take from Cities: Skylines II (research, 2026-11-21)

Status: **research and proposal only, nothing implemented.** Branch `design-geometry`. Companion to [GEOMETRY_EDITOR_DESIGN.md](GEOMETRY_EDITOR_DESIGN.md) (the geometry plan), which already covers PI + radius curves, auto-fillet, angle snap, typed length/bearing/radius, reshape grips, radius/grade screening and vertical profiles. Nothing here repeats that plan; it adds on top.

User request (2026-11-21): make the Design workspace's transport build tools feel like Cities: Skylines II (CS2), with many options used in the real world and great design. **Transportation only**: no zoning, buildings, city services or game mechanics.

Labels: **[read]** = taken from a page or PDF opened in this session (PDFs read with `pdftotext` only). **[excerpt]** = seen only in a search-result excerpt of that page; the CS2 wiki (cs2.paradoxwikis.com) refused direct fetches (HTTP 427), so wiki items are excerpt-level and should be re-checked before quoting to users. **[app]** = read in this repo's code. **[proposed]** = this document's choice.

---

## 0. Summary

- CS2's road tools are good for three reasons that carry over to a planning tool: (1) **one road tool, many road types**: the type (lanes, median, sidewalks, parking) is picked from a palette, and the drawing modes are the same for all of them; (2) a **Replace/upgrade brush** that changes a built road in place (add trees, wider sidewalk, bus lane, tram track, bicycle lane, sound barrier) without redrawing; (3) **feedback on the cursor**: length, slope and cost on the segment being drawn, guide lines, and snap toggles you can see.
- VirtualPlanner already has most of the *data* for this: per-section carriageway, footpath, cycle track, parking, verge, drainage and median widths (`RoadSectionProfile`), junction control, signal plans, banned movements and lane connections (`JunctionEditSpec`) [app]. What it lacks is the CS2-style *way in*: street-type presets, an upgrade brush, map brushes for junction control, parallel/service roads, elevation while drawing, roundabouts, bus stops and bus/BRT lanes, and standards screening of the cross-section.
- **One finding that changes the geometry plan:** IRC:86 was revised in **2018**. Its Table 3.1 design speeds (plain terrain) are **urban expressway 80, arterial 60, sub-arterial 60, collector 40, local 30 km/h** [read], lower than the 1983 values (arterial 80, collector 50) used in GEOMETRY_EDITOR_DESIGN.md §2.2 / D1. The minimum-radius table (2018 Table 8.2) matches the 1983 table and adds 20, 40 and 70 km/h rows [read]. See decision T1.
- Top additions for a planner, in order: street-type presets with Indian cross-sections (M), the Upgrade brush (M), cross-section standards screening (S), junction-control map brushes (S–M), corner-radius check (S), bus stop + bus/BRT lane tools (M), parallel / service-road mode (M), elevation while drawing (L, joins geometry phase 3), roundabout tool (M–L). Full ranked list in §3.

---

## 1. Inventory of CS2 transport tools (primary sources)

Main sources: Colossal Order Development Diary #1 Road Tools (19 Jun 2023) https://colossalorder.fi/news/development-diary-1-road-tools/ [read] (same text as the Paradox feature page https://www.paradoxinteractive.com/games/cities-skylines-ii/features/road-tools); Dev Diary #3 Public & Cargo Transportation (3 Jul 2023) https://colossalorder.fi/news/development-diary-3-public-cargo-transportation [read]; Detailer's Patch #2 diary (10 Dec 2024) https://colossalorder.fi/news/development-diary-detailers-patch-2 [read]; Quays & Piers Patch 1.3.3f1 (11 Jun 2025) https://www.paradoxinteractive.com/games/cities-skylines-ii/news/quays-and-piers-patch [read]; Dev Diary: Building for Bicycles (18 Nov 2025) https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-building-for-bicycles [read]; CS2 wiki Roads https://cs2.paradoxwikis.com/Roads [excerpt]; Bike Patch 1.4.2f1 notes via SteamDB https://steamdb.info/patchnotes/20670861/ [excerpt].

Short source keys used in the tables: **DD1** road diary, **DD3** transport diary, **DP2** Detailer's Patch #2, **QP** quays patch, **BK** bicycles diary, **WIKI** CS2 wiki Roads.

### 1.1 Drawing modes and options
| CS2 item | What it does | Source |
|---|---|---|
| Straight | 2 clicks: start, end | WIKI [excerpt] |
| Simple curve | 3 clicks: start, bend control, end | WIKI [excerpt] |
| Complex curve | 4 clicks: start, two bend controls, end (S-curves, joining parallel roads) | WIKI [excerpt] |
| Continuous | keeps adding curved segments from the last end | WIKI [excerpt] |
| Grid | 3 clicks: corner, width, length → a block of roads | DD1 [read] |
| Replace | hover a road to swap its type in place; left/right/centre hover sets which edge stays when the width changes; also adds tram tracks and bus lanes | DD1 [read], WIKI [excerpt] |
| Parallel mode | builds two roads side by side at a fixed, adjustable offset (0.25–12 zone cells); works with every other mode | DD1 [read], WIKI [excerpt] |
| Elevation + elevation step | road height relative to the start point; steps 1.25 / 2.5 / 5 / 10 m; Page Up / Page Down; first negative steps make a **cut-and-fill** road, deeper ones a **tunnel**; positive ones a bridge / **elevated road over another road** | DD1 [read], WIKI [excerpt] |
| Build across roads | crossing an existing road creates the intersection automatically | DD1 [read] |
| Ramps by lane count | a highway piece with one extra lane joined to a 1-lane highway forms an on/off ramp with acceleration/deceleration lane | DD1 [read] |
| Cancel step / bulldoze | right mouse cancels the last step; bulldoze removes built roads | DD1 [read] |

### 1.2 Snapping and guides
| CS2 item | Source |
|---|---|
| Toggle all snapping (hotkey-able) | WIKI [excerpt] |
| Snap to existing geometry (roads, paths, networks) | WIKI [excerpt] |
| Snap to zoning-cell length (8 m) | WIKI [excerpt] |
| Snap to 90° relative to existing roads | WIKI [excerpt] |
| Snap to building sides; to zone grid; to guidelines (extension lines from road ends) | WIKI [excerpt] |
| Snap to shoreline (quays only; keeps a set height above water) | QP [read] |
| Road guides showing the **numeric slope** from start to cursor | DD1 [read] |
| Contour lines toggle while building (1 m thin, 10 m thick) | fan sources only (cities-novacivitas.com, toadiezzz.com) — not primary; a CO community manager said before release that there would be none at launch (pcgamesn.com, 2023-09-14). **Unverified for the current version.** |
| On-cursor length, slope % and cost of the segment being drawn | seen in a trailer still described by playcraft.space (not primary) — treat as unverified detail; DD1 confirms the slope readout only |

### 1.3 Road types and lane configurations
- Categories small / medium / large / highway; each has two-way, one-way and **asymmetric** variants (e.g. 3+1, 4+2, 5+2 lanes; asymmetric highways 3+1, 3+2), elevated versions and bridge styles. No grass/tree road types: those are upgrades. DD1, DP2 [read].
- **Parking roads** with perpendicular or angled parking, parking alleys; cul-de-sac heads. DP2 [read].
- **Pedestrian street** (service and delivery vehicles only), pedestrian paths and bridges. DD1 [read].
- **Bus-only roads** and bus lanes on existing roads; tram tracks on roads or separately. DD1, DD3 [read].
- **Quays** (narrow pedestrian; medium/wide with vehicle lanes, take all road upgrades) and **piers**. QP [read].
- Bicycle: on-road **bicycle lane** upgrade (one or both sides; replaces kerbside parking; can coexist with bus lane/tram), standalone one-way / two-way **bicycle paths**, **divided pedestrian–bicycle path**, bicycle bridges, **bicycle restriction** per segment. BK [read].

### 1.4 Upgrades (Road Services / Replace brush)
Grass, trees (sides and median), wide sidewalk (removes kerbside parking), sound barriers, street lighting, bus lanes, tram tracks, bicycle lanes; roadside tree species selector. DD1, DP2, BK [read]. Left-click adds, right-click removes. DD1 [read].

### 1.5 Intersections and traffic control
- **Premade intersections** (incl. complex highway interchanges and highway↔road transition pieces), placed on empty ground or over existing roads and auto-connected. DD1 [read].
- **Roundabouts** placed on an existing intersection, 4 sizes; adopts the lane configuration of the arms. DD1 [read].
- Place/remove **traffic lights**, **crosswalks**, **stop signs**; **control turn lanes**; replace crossings by a pedestrian overpass. DD1 [read]. Banned left/right/straight signs (fan wiki excerpt, not primary).

### 1.6 Parking
Kerbside parking, parking lots, parking buildings (multi-level), parking roads; bicycle stands/shelters placed on the network and bicycle parking buildings. DD1, DP2, BK [read].

### 1.7 Public transport
- Flow: **depot → stops and stations → tracks and roads → lines**. DD3 [read].
- Bus: stop sign or shelter placed on a road; intercity lines. Train: two-way, double, one-way tracks; elevated, bridge, tunnel, cut-and-fill; switches made by joining track types; stations with pre-built tracks and extra platforms. Tram: on road (via Replace) or separate track. Subway: underground or elevated, compact entrances. DD3 [read].
- **Line tool**: click stops in order; for road vehicles add **waypoints** to control the route between stops (avoid a busy junction); stops shared by many lines. DD3 [read].
- **Line panel**: length, number of stops, passengers, usage %, colour, name, vehicles on the line, operating hours (day/night), ticket price. DD3 [read].
- **Transportation info view / overview panel**: all lines, colours, vehicles. DD3 [read]. **Traffic Routes** (select a road/vehicle/building → see the routes through it, width = volume). DP2 [read].

### 1.8 UI/UX patterns worth copying
1. A tool panel with three stacked controls: **Tool mode** (straight / curve / continuous / grid / replace), **Elevation** with step, **Parallel mode**, then a row of **snap toggles** (DD1, WIKI; trailer still per playcraft.space).
2. Road **type picker** separate from the **tool mode**: "roads and road tools" were kept apart on purpose so players don't need to decide all road types up front (Colossal Order interview, gamedeveloper.com, 2023-10-24 [excerpt]).
3. **Readouts on the segment** (length, slope; cost unverified) and **guide lines**.
4. **Right-click = undo the last step / remove an upgrade.**
5. **One brush for every upgrade**: same click-to-add / right-click-to-remove for trees, lanes, lights, signs.

---

## 2. Map to real-world planning and Indian / Pune standards

Indian sources opened this session (official documents; text extracted with `pdftotext`, copies kept internally in `work/cs2-refs/` of the project, not in the repo):
- **IRC:86-2018** Geometric Design Standards for Urban Roads and Streets — https://law.resource.org/pub/in/bis/irc/irc.gov.in.086.2018.pdf [read]
- **MoUD/IUT Code of Practice for Urban Roads (2012/13)**: Part 1 Cross Section https://www.mohua.gov.in/static/uploads/2025/10/7cea1c184a06024e4f5e81914bee0610.pdf, Part 2 Intersections https://www.mohua.gov.in/static/uploads/2025/10/0d661deff98cc5b52b6313f572d80fd9.pdf, Part 5 Traffic Calming https://www.mohua.gov.in/static/uploads/2025/10/4e8af5cfea6b53b11be8806f5b725601.pdf [read]. These are recommended practice, not mandatory.
- **PMC Urban Street Design Guidelines, Pune, Version I: 2016 (USDG)** — official PMC link https://pmc.gov.in/sites/default/files/road_img/USDG_Final_July2016.pdf returned an HTML page from this sandbox; the same PMC document was read from the ITDP-hosted copy https://itdp.in/wp-content/uploads/2016/07/Urban-street-design-guidelines.pdf [read].
- **MoHUA Standard Specifications, Light Urban Rail Transit "Metrolite" (July 2019)** — mohua.gov.in link returned HTML; read from the copy at https://metrorailnews.in/wp-content/uploads/2020/01/STANDARD-SPECIFICATIONS-for-Metrolite.pdf [read].
- **MoHUA Standard Specifications of Metro Neo (Nov 2020)** — https://mohua.gov.in/upload/whatsnew/5fa52ec5702e2Standard+specifications+of+Metro+Neo-2%20(1).pdf [excerpt only: 8.0 m RoW for both lanes, continuous kerb/fence segregation].
- Pune Metro S–K DPR values: as already recorded in GEOMETRY_EDITOR_DESIGN.md §2.2.

### 2.1 Mapping table
"Keep" = real planning feature; "Drop" = game mechanic.

| CS2 tool | Real-world equivalent | India / Pune standard (where found) | Verdict |
|---|---|---|---|
| Straight / curve / continuous | Horizontal alignment by PI + radius | IRC:86-2018 Table 8.2 min radii (20→15/20 m … 80→230/265 m at e 7 %/4 %) [read]; covered by the geometry plan | Keep (geometry plan) |
| Complex curve (S-curve) | Reverse curves with a tangent between | Geometry plan's "curves overlap / no tangent" flag | Keep (already covered) |
| Grid | Street layout of a new layout / town-planning scheme | No layout standard read; USDG gives cross-sections for 6–60 m RoW (vkarch.com summary, not read) | Keep, low priority |
| Replace / upgrade | Retrofit of an existing street to a new cross-section (Pune Streets Programme, "complete streets") | USDG ch. 4–6; IRC:86-2018 §5 | **Keep — high value** |
| Road types & asymmetric lanes | Cross-section templates by street hierarchy and RoW | IRC:86-2018: lane 3.5 m (3.0 m on residential access), carriageways 7/14/21 m (Table 5.5); MoUD CoP-1 car lane 3.0–3.5 m (access 2.75–3.0 m), bus lane 3.5 m [read]. USDG Pune typology: Mobility corridor, Mobility corridor with NMT preference, Feeder, Neighbourhood, Through-traffic streets [read] | **Keep — high value** |
| Median upgrade | Median / pedestrian refuge | IRC:86-2018 §5.6: absolute min 1.2 m, desirable 5 m; right-turn protection 4.0 (7.5 recommended) m; transition 1:15–1:20; ≥4-lane roads normally have a median [read] | Keep |
| Wide sidewalk | Footpath with frontage / pedestrian / multi-functional zones | IRC:86-2018 Table 5.1 pedestrian zone min 1.8 m residential, 2.5 m commercial, 4.0 m high-intensity commercial; clear height 2.2 m; MFZ 1–2 m; kerb ≤150 mm [read]. USDG: clear walking zone ≥2 m, 2.4 m vertical, frontage 1 m shops / 0.5 m others, edge 0.2 m [read] | **Keep — high value** |
| Bicycle lane / path | Segregated cycle track / painted cycle lane | IRC:86-2018: ≥2 m one-way, ≥3 m two-way, 0.5 m buffer, raised 100–150 mm, painted lanes discouraged; warranted at >100 motor vehicles and >400 cyclists in the peak hour (IRC:11-2015) [read]. MoUD CoP-1: segregated track 2.2–5.0 m (arterial/sub-arterial), cycle lane 1.5–2.5 m (distributor) [read] | Keep |
| Trees / grass | Tree line in the multi-functional zone, landscaped median | IRC:86-2018 §5.1.10: continuous tree line, pits ≥1 × 1 m, canopy clearance ≥3 m [read] | Keep (cross-section element) |
| Street lighting | Lighting design | IRC:86-2018 Table 5.6: footpath/cycle track pole 4.5–6 m at 12–16 m; RoW ≤9 m 8–10 m at 25–27 m; RoW >9 m 10–12 m at 30–33 m [read] | Keep, low priority |
| Sound barriers | Noise barriers on expressways/flyovers | Not researched | Keep as a flag only; drop the game noise effect |
| Parking (kerbside, lots, parking roads) | On-street parking management, parking lots | USDG: parallel parking 2 × 5 m (2.5 m bay), 2W 1 × 2 m, cycle 1 × 2 m; bays ≤22 m long then a bulb-out; no parking 50 m before / 20 m after a bus stop [read]. IRC:86-2018: on-street parking prohibited/restricted on arterials unless a service lane exists [read] | Keep |
| Elevation / bridge / elevated over road | Flyover, grade separator, ROB | IRC:SP:90 3.5 % max grade (geometry plan) | Keep (geometry phase 3) |
| Cut-and-fill road | Depressed road / underpass in retained cut | No Indian standard read | Keep (as a vertical type) |
| Tunnel | Road / metro tunnel | Pune S–K DPR (geometry plan) | Keep (exists as Underground tool) |
| Parallel mode | Divided carriageway, service (slip) road alongside an arterial | MoUD CoP-1 §5.6 service lanes on the left of cycle tracks for property access and parking [read] | Keep |
| Highway ramp by lane count | Merge / diverge with acceleration/deceleration lanes | Not read (IRC:SP:90 / IRC:SP:87 would hold it) | Keep, needs source |
| Premade intersections | Standard junction layouts (T, 4-arm, channelised, interchange) | MoUD CoP-2 figures (signalised arterial–distributor with / without slip lanes; recommends against free-left slip lanes in most cases) [read] | Keep as templates |
| Roundabouts (4 sizes) | Roundabout design | MoUD CoP-2 Table 2-6: mini ICD 13–25 m (entry 25 km/h, 1 lane), urban compact 25–30 m (25 km/h, 1), urban single-lane 30–40 m (35 km/h, 1), urban double-lane 45–55 m (40 km/h, 2); mini central island <4 m [read] | Keep |
| Traffic lights / stop signs | Junction control (signal / priority / all-way stop) | Already in app (`JunctionControlKind = none / priority / signal`) [app]; MoUD CoP-2 Table 2-1 volume warrants for signals (table not transcribed) | Keep |
| Crosswalks | Zebra / raised crossing / mid-block crossing | IRC:86-2018: raised crosswalks ≥3 m wide at unsignalised crossings, ramps 1:8; mid-block crossings every 50–200 m by street type; refuge ≥3 m on ≥4-lane roads [read]. USDG BRT: mid-block crossing every 150 m [read] | Keep |
| Turn lane control | Banned movements, lane-to-lane connections | Already in app (`bannedMovements`, `laneConnections`) [app] | Keep (UI only) |
| Pedestrian overpass | FOB / subway | IRC:86-2018: FOBs and subways increase walking distance and are discouraged (design in its Annexure I) [read] | Keep, with a screening note |
| Corner radius (implicit in CS2) | Kerb return radius | IRC:86-2018 §5.1.3: ≤9 m at arterial and major-collector junctions, ≤4 m for minor collectors and local streets [read] | Keep (new check) |
| Speed humps / tables (not in CS2) | Traffic calming | MoUD CoP-5 (humps 50–100 mm, raised crossings/junctions) [read, values not transcribed]; IRC:86-2018 posted 20 km/h near schools, hospitals, within 500 m of mass-transit stations; change posted speed in 10 km/h steps [read] | Keep, add |
| Bus stop sign / shelter | Bus stop placement | MoUD CoP-1 §5.9: ≥500 m apart, ≤1 km; near side of a junction preferred [read]. USDG: shelter 10 × 1.5 × 2.2 m min; ~50 m from the junction; in the parking bay / bulb-out, not on the footpath [read] | **Keep** |
| Bus lanes / bus-only road | Bus priority lane / BRT corridor | USDG: dedicated bus lanes on RoW ≥30 m; ≥7 m undivided for two-way bus flow; segregated by median/railing; median stations; mid-block crossings every 150 m [read]. MoUD CoP-1: bus lane 3.5 m [read] | **Keep** |
| Tram track on road / separate | Light rail on street | MoHUA Metrolite: at-grade dedicated path, 7.6 m both lines (8.5 m at staggered shelters), 3.5 m single line; standard gauge; curves to 25 m radius; 1.12 m platforms [read]. Metro Neo: 8.0 m RoW both lanes [excerpt] | Keep (as "Light rail / Metrolite / Metro Neo corridor") |
| Train / subway tracks, stations | Metro / suburban rail alignments and stations | Exists (metro line, station, underground) [app]; Pune DPR values | Keep (exists) |
| Line tool with waypoints | Bus route / transit line definition | No Indian standard; it is a network-model input | Keep (later; depends on transit assignment in Simulate) |
| Line panel: vehicles, hours | Fleet size, frequency/headway, service span | — | Keep frequency/headway only |
| Traffic Routes | Select-link analysis | — | Keep, but it is a Simulate feature, not a build tool |
| Zone-cell (8 m) snap, zone-grid snap, building-side snap | — | — | **Drop** (zoning grid; a "snap to property line / building edge" may come later) |
| Depots / yards, vehicle maintenance, road condition, snowplows, accidents | — | — | **Drop** |
| Development tree / milestone unlocks, money, upkeep, ticket price economy | — | — | **Drop** (a construction cost estimate needs real Schedule of Rates data — decision T4) |
| Roundabout decorations, cul-de-sac skins, roadside tree species | — | — | **Drop** (cul-de-sac *turning head* geometry is real but low value) |
| Quays, piers, harbours, airports, cargo lines, taxis, seaways | — | — | **Drop** (outside the user's transport scope for Pune; riverfront roads can use the ordinary road tool) |
| Urban Cycling policy, bicycle restriction policy per district | — | — | **Drop** as tools (policies, not build tools). Segment-level bicycle restriction = an access restriction attribute, low priority |

---

## 3. Gap analysis and ranked additions

### 3.1 What VirtualPlanner has today [app]
- 13 tools in 8 palette groups (`components/tools.ts`): Select (1), Road (2), Building (3), Junction (4), Flyover (5), Metro line (6), Double-deck (7), Station (8), Utility (9), Tunnel, Demand zone, Gateway, Study area. Road settings: class only (highway / arterial / collector / local) (`ToolSettings.tsx`).
- Road object: legacy flat fields (lanes, lane width, divider, footpath, speed, one-way) plus optional `sections: RoadSectionProfile[]` with median, carriageway A/B (direction, lanes, lane width, left/right roadside: footpath, cycle track, verge, parking, drainage), reserved spaces (future widening, utility corridor, drainage, green buffer, setback) and provenance (`engine/objects/types.ts`).
- Junctions: placed junction (signals, cycle, pedestrian crossing) and edits of imported OSM junctions: control none/priority/signal, signal plan with phases, major arms, banned movements, lane connections (`simulation/junctionControl.ts`, `JunctionPanel.tsx`).
- Class defaults (`EditingEngine.ts:66`): arterial 4 lanes, 2 m divider, **1.5 m footpath**, 70 km/h; collector 2 lanes, 2 m footpath, 50 km/h; local 2 lanes, **1.5 m footpath**, 40 km/h. The 1.5 m footpaths are below the IRC:86-2018 1.8 m minimum pedestrian zone (Table 5.1) and the USDG 2 m clear walking zone; see decision T2.
- Shortcuts: 1–9 tools, Esc, Enter, double-click, right-click point, Ctrl+Z/Y, Delete, R / Shift+R (rotate station), ? (`ShortcutsOverlay.tsx`, `useKeyboardShortcuts.ts`).
- Not present: roundabout as a built object (only an OSM tag), bus stops, bus/BRT lanes, cycle/pedestrian paths as their own objects, parking objects, parallel drawing, elevation while drawing a road, cross-section presets, upgrade brush, cross-section checks.

### 3.2 Already planned in GEOMETRY_EDITOR_DESIGN.md (not repeated)
PI + radius curves with auto-fillet; Shift 15° / Alt+Shift relative snap; tangent and perpendicular guides; pixel snap tolerance; typed length / bearing / radius; live length, bearing, deflection, radius readout; local undo while drawing; PI / midpoint / radius / end grips; Alignment panel; radius, transition, fit and vertical-grade screening; spirals and PVI vertical profile (phase 3); grade-driven flyover ramps.

### 3.3 Ranked additions on top (value for a planner; effort S ≤ 1 agent-day, M 2–4 days, L ≥ 1 week)

| # | Addition | CS2 origin | Why a planner wants it | Standard behind it | Effort |
|---|---|---|---|---|---|
| 1 | **Street-type presets** in Road settings: pick a Pune / IRC cross-section (e.g. "Mobility corridor 30 m RoW: 2×3 lanes, median, cycle tracks, footpaths, MUZ", "Feeder 18 m", "Neighbourhood 9–12 m", "BRT corridor ≥30 m") instead of only a class; the preset fills `sections` (carriageways, roadsides, median) and shows a mini cross-section diagram with widths and total RoW | road type palette | Planners design by RoW and cross-section, not by "class"; this turns the existing section model into a one-click choice | USDG typology [read]; IRC:86-2018 Tables 5.1, 5.5, §5.6 [read]; CoP-1 [read]. **The USDG's own per-RoW templates (6–60 m) were not transcribed here** — the builder should take the widths from USDG ch. 4–6 and label each preset "per USDG 2016 / IRC:86-2018, screening template" | M |
| 2 | **Upgrade brush** (CS2 Replace): select an element (median, cycle track, footpath width, parking, bus lane, trees/MUZ, lighting, lane count) and click road pieces to apply it, right-click to remove; or apply a whole street-type preset to a piece; edge anchor left/right/centre when the RoW changes; works on OSM roads as a profile edit (geometry untouched) and copy-on-write in proposals | Replace / Road Services | The core retrofit workflow ("make JM Road a complete street") without redrawing; uses existing `sections`, `remapRoadSections`, history batch | Same as #1 | M |
| 3 | **Cross-section screening**: flag footpath pedestrian zone < 1.8 / 2.5 / 4.0 m (residential / commercial / high-intensity), cycle track < 2 m one-way / 3 m two-way or without 0.5 m buffer, lane < 3.5 m (3.0 m residential access), median < 1.2 m, bus lane < 3.5 m, two-way BRT < 7 m or on RoW < 30 m, ≥4 lanes without median refuge; sum of widths ≠ RoW; same "screening, not approval" wording as the geometry checks | (none; CS2 has no checks) | Tells the planner at once whether a section is buildable to code | IRC:86-2018 §5.1–5.6 [read]; CoP-1 [read]; USDG BRT [read] | S (extends `engine/geometry/alignment/checks.ts` pattern into a `crossSectionChecks.ts`) |
| 4 | **Junction-control map brushes**: Signal, Priority (give way / stop), Zebra crossing, Raised crossing, Ban turn (click arm-to-arm arrows on the map), Lane connection — each a click on a junction, right-click removes; opens the existing JunctionPanel for detail | traffic lights, stop signs, crosswalks, turn lanes | Data model already exists; today it is only reachable through the side panel | IRC:86-2018 §5.1.3 raised crossings [read]; CoP-2 [read] | S–M |
| 5 | **Corner (kerb-return) radius** per junction corner, drawn on the junction footprint, with check ≤9 m (arterial / major collector) and ≤4 m (minor collector / local) | implicit | Pedestrian safety is a headline goal of Pune USDG; tight corners are a common redesign | IRC:86-2018 §5.1.3 [read] | S |
| 6 | **Bus stop tool + bus lane / BRT upgrade**: place a stop on a road side (snaps to the kerb or to the median for BRT); readout of distance to the previous stop and to the nearest junction; flags < 500 m or > 1 km spacing, < 50 m from the junction, parking inside 50 m before / 20 m after; bus lane as an upgrade (kerbside or median, 3.5 m), BRT preset (≥7 m two-way) | bus stop sign/shelter, bus lanes, bus-only road | PMPML / BRT corridor planning is a core Pune task; no transit-on-road tools exist today | CoP-1 §5.9 [read]; USDG bus stops and BRT [read] | M |
| 7 | **Parallel / service-road mode**: while drawing a road, also draw a parallel road (service lane or second carriageway) at a set offset each side; offset typed in metres; the pair shares one alignment so curves stay concentric | Parallel mode | Divided carriageways and service lanes are standard on Pune arterials; drawing them twice by hand gives non-concentric curves | CoP-1 §5.6 service lanes [read] | M (offset curve = same alignment with offset; needs care at the fit rule) |
| 8 | **Elevation while drawing** (PgUp / PgDn, step 0.5 / 1 / 2.5 / 5 m [proposed metric steps], per-PI level): one road tool makes at-grade, cut (depressed), elevated (flyover) and tunnel stretches with automatic ramps, a clearance check over crossed roads, and a numeric slope readout on the segment; replaces choosing Flyover vs Road up front | elevation + step, cut-and-fill, elevated over road, slope guide | Planners sketch "go over this junction" in one stroke | IRC:SP:90 §6.14 3.5 % grade (geometry plan); **vertical clearance standard not read** (decision T3) | L (joins geometry phase 3 PVI work; new vertical-type per stretch) |
| 9 | **Roundabout tool**: click a junction, pick a CoP-2 type (mini / urban compact / urban single-lane / urban double-lane), get the inscribed circle, central island and arms re-joined radially; size readout and a flag if arm speeds exceed the type's entry speed; simulated as priority-to-circulating | roundabouts | Common Pune proposal at T and 4-arm junctions | CoP-2 Table 2-6 [read] | M–L (geometry + a new junction control kind in the traffic model) |
| 10 | **Snap panel** (visible toggles like CS2): All, Network points, Angle (15°), Guidelines (extension of road ends), Length step (off / 1 / 5 / 10 m), Terrain contours | snapping options, guidelines, contour lines | Makes the geometry plan's snaps discoverable and switchable | — | S (UI over the geometry plan's `drawConstraints.ts`) |
| 11 | **Cycle track and footpath as standalone paths** (one-way / two-way cycle path, pedestrian path, divided ped–cycle path, FOB / subway with the IRC "discouraged" note) | bicycle/pedestrian paths, bridges | Greenway links, river-edge paths, station access | IRC:86-2018 §5.2, FOB note [read]; Pune Cycle Plan 2017 (not read) | M |
| 12 | **Traffic calming elements**: speed table, raised crossing, raised junction, hump; posted-speed zones (20 km/h near schools, hospitals, 500 m around mass-transit stations) | (not in CS2) | Real Pune street projects; feeds speed in Simulate | CoP-5 [read, values not transcribed]; IRC:86-2018 §3.3 [read] | M |
| 13 | **Parking upgrade**: kerbside parallel bays (2 × 5 m, ≤22 m runs with bulb-outs), angled/perpendicular parking roads, 2W and cycle parking, auto-removal near bus stops; capacity readout | parking roads, kerbside parking, bicycle stands | Parking policy is a live Pune issue; capacity numbers are useful | USDG parking [read]; IRC:86-2018 arterial restriction [read] | M |
| 14 | **Light rail corridor** (Metrolite / Metro Neo) as a transit type: at-grade dedicated corridor on a road (upgrade) or separate, RoW from the spec, radius check ≥25 m (Metrolite) | tram tracks | MoHUA's tier-2 options; Pune has studied feeder systems | Metrolite [read]; Metro Neo [excerpt] | M |
| 15 | **Transit line tool**: click stops/stations in order, optional waypoints on the road network, line colour, headway, service span; readout of length, stop count, average stop spacing | Line tool, line panel | Needed before any ridership work; data only until Simulate gets transit assignment | — | L (data model + UI; ridership is out of scope) |
| 16 | **Grid mode** for new layouts: corner → width → length with block size and street-type per direction | Grid | Greenfield layouts (TP schemes on the fringe); less used for Pune retrofit | — | M |
| 17 | **Junction templates**: T, 4-arm signalised with/without slip lanes, channelised T; place over a crossing and re-join | premade intersections | Speeds up standard layouts | CoP-2 figures [read] | M–L |
| 18 | **Select-link "Traffic routes"** from a selected road | Traffic Routes | Real analysis, but belongs to Simulate | — | M (Simulate, not Design) |

Notes on ranking: 1–3 make the existing section model usable and checkable (largest effect per effort). 4–5 expose existing junction data with little code. 6 is the biggest missing real-world category (bus). 7–9 are drawing power. 10 is cheap polish on the geometry plan. 11–18 widen coverage.

---

## 4. Proposed tool palette for transport in Design [proposed]

Consistent with the current palette: groups from `TOOL_CATEGORIES`, verb + noun tooltips, two-line buttons, lucide icons not shared with app chrome, 1–9 tool hotkeys kept as they are. Land & demand and Underground groups unchanged.

### 4.1 Groups and tools
| Group | Tool (short label) | Icon (lucide, in words) | Modes / options in the tool panel | Hotkey |
|---|---|---|---|---|
| Select | Select | mouse pointer (as now) | — | 1 |
| Study area | Study area | dashed square (as now) | Polygon / Rectangle | — |
| **Roads & lanes** | Road | route (as now) | Street type (preset picker with cross-section diagram) · Mode: Curved (auto-fillet) / Straight / Grid · Parallel: off / service road / dual carriageway, offset m · Level: ground / cut / elevated / tunnel with PgUp/PgDn | 2 |
| | Upgrade street | paint roller | Element: Street type · Lanes · Median · Footpath · Cycle track · Parking · Trees/MUZ · Lighting · Bus lane; Side: left / right / both / median; click apply, right-click remove | U [proposed] |
| | Path | footprints | Pedestrian / Cycle one-way / Cycle two-way / Shared ped–cycle; Level: ground / bridge (FOB) / subway | — |
| | Parking | square-parking ("P" sign) | Kerbside parallel / angled / perpendicular; 2W; cycle stands | — |
| **Junctions & signals** | Junction | squares-intersect (as now) | — | 4 |
| | Roundabout | rotate-cw circle | Mini / Compact / Single-lane / Double-lane (CoP-2 sizes) | — |
| | Junction control | traffic-cone or traffic-light | Signal · Priority/stop · Zebra crossing · Raised crossing · Ban turn · Lane links · Corner radius | J [proposed] |
| | Calming | gauge (speedometer) | Speed table · Raised junction · Hump · 20 km/h zone | — |
| **Grade separation** | Flyover | spline (as now) | Grade 3.5 % default (geometry phase 3) | 5 |
| | Double-deck | rows (as now) | — | 7 |
| **Transit** | Metro line | train-front (as now) | Elevated / underground (link to Tunnel) | 6 |
| | Station | circle-dot (as now) | — | 8 |
| | Bus stop | bus | Kerbside / bus bay / median (BRT); readout of spacing | B [proposed] |
| | Bus lane / BRT | bus-front over a lane, or "BRT" text badge | Kerbside lane / median BRT (both directions) | — |
| | Light rail | tram-front | Metrolite / Metro Neo / generic; on-road or separate | — |
| | Transit line | waypoints (dotted path) | Bus / BRT / metro / light rail; colour; headway | L [proposed] |
| Underground | Utility, Tunnel | as now | — | 9, — |
| Land & demand | Building, Demand zone, Gateway | as now | — | 3, — |

All proposed icons exist in the installed lucide-react (PaintRoller, Footprints, SquareParking, RotateCw, TrafficCone, Gauge, Bus, BusFront, TramFront, Waypoints; checked in `frontend/node_modules`). Groups stay at 8; the transport groups grow from 7 tools to 17. To keep the palette short, groups can show their first 3 tools and a "more" chevron (the palette already supports expand-all via `OPEN_TOOLBAR_EVENT`) [proposed].

### 4.2 Tool panel layout (CS2 pattern, Design styling)
One panel under the palette when a drawing tool is active, top to bottom:
1. **Type** row: street-type preset (Road) or element (Upgrade) or kind (Path, Transit), with a live cross-section strip showing widths and the RoW total.
2. **Mode** segmented control: Curved · Straight · Grid (Road); Apply · Remove (Upgrade).
3. **Level** stepper: Ground / Cut / Elevated / Tunnel, height in m, step size; shows the current slope.
4. **Parallel** toggle with offset in m.
5. **Snap** icon row: All · Network · Angle · Guidelines · Length step · Contours.
6. **Readout** (also on the cursor): length, bearing, deflection, radius, slope %, RoW; then any screening flags in amber with their source ("Footpath 1.5 m < 1.8 m min, IRC:86-2018 Table 5.1 — screening only").

### 4.3 Keyboard [proposed]
Existing keys kept. New, only active while the relevant tool is active (no clash with R = rotate station, which needs a selected station):
| Key | Action |
|---|---|
| PgUp / PgDn | Raise / lower the next point by one level step |
| Shift + PgUp | Cycle level step size |
| P | Toggle parallel mode |
| S | Toggle all snapping (Shift and Alt+Shift stay the angle snaps from the geometry plan) |
| G | Cycle draw mode Curved → Straight → Grid |
| U / J / B / L | Upgrade street / Junction control / Bus stop / Transit line tools (letters, since 1–9 are taken) |
| Right-click | While drawing: remove last point (CS2 pattern; today right-click removes a clicked point); with a brush: remove the element |
| Digits / Tab / R / Enter / Backspace | As in the geometry plan (length, bearing, radius, finish, undo point) |

Check before adopting the letter keys: they must not fire when focus is in an input (the current handler already skips modal dialogs; text inputs need the same guard).

---

## 5. Decisions the user must make
- **T1 Design speeds: IRC:86-2018 or 1983?** IRC:86-2018 Table 3.1 (plain): expressway 80, arterial 60, sub-arterial 60, collector 40, local 30 km/h. The geometry plan (D1) used 1983 values (arterial 80, collector 50). Recommendation: switch the geometry defaults to 2018 and keep `highway` at 80 (urban expressway) unless the user wants rural IRC:73 for highways. Also: should the class speed limits in `ROAD_CLASS_DEFAULTS` (arterial 70, collector 50, local 40) follow?
- **T2 Footpath defaults**: raise arterial/local defaults from 1.5 m to the IRC:86-2018 1.8 m minimum (2.0 m clear per Pune USDG), for new roads only? Existing objects untouched.
- **T3 Elevation model**: one Road tool with levels (CS2 style; Flyover becomes a preset) or keep Flyover as its own tool and add levels only for cut/tunnel? And which vertical clearance to check over roads (no Indian clearance value read in this session; needs IRC:54 or IRC:SP:90 clearance clause).
- **T4 Cost readout**: CS2 shows cost while drawing. A planner-grade number needs a Schedule of Rates (PWD Maharashtra / PMC). Show quantities only (lane-km, deck area, footpath m²) for now, or source unit rates?
- **T5 Presets source**: build street-type presets from the PMC USDG 2016 per-RoW templates (Pune-specific; needs transcription of its template chapter) or from IRC:86-2018 Annexure 2 templates (national)? Recommendation: USDG first, IRC as fallback.
- **T6 Scope of transit**: stop for now at stops, bus/BRT lanes and line geometry (no ridership), or plan transit assignment in Simulate?
- **T7 Palette size**: accept 17 transport tools with "more" chevrons, or fold Path / Parking / Calming into the Upgrade brush?

## 6. Not verified / gaps
- CS2 wiki pages were excerpt-only (HTTP 427). Contour lines and the on-cursor cost readout come from non-primary sources.
- Not read: IRC:103-2012 (pedestrian facilities), IRC:11-2015 (cycle tracks), IRC:65 (roundabouts), IRC:SP:41 (at-grade intersections), IRC:54 (vertical clearance), PMC Parking Policy, Pune Comprehensive Mobility Plan, Pune Cycle Plan design guidelines, MoUD CoP-2 signal-warrant Table 2-1 values, CoP-5 hump dimensions, USDG per-RoW templates.
- Metro Neo values are excerpt-level; its mohua.gov.in PDF returned HTML from this sandbox.
- Effort sizes are estimates against this codebase as read today, not measured.
