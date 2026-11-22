"""
Rules used by the underground screening engine (coordination/screening.py), in ONE table, every row sourced.
Aligned with /workspace/work/underground-research/UNDERGROUND_RESEARCH.md §3 (checks C1–C22), §4 (statuses) and Top 12.

Row fields
  id          research check id (C1, C2b, ...) or a local id for rows without one
  a, b        asset-type pair (comma lists; '*' = any). Classes: water, sewer, storm, power, gas, telecom, utility,
              tunnel, metro_tunnel, building, metro (any Metro structure)
  dim         'H' horizontal clear distance | 'V' vertical clear distance | '3D' clear distance in any direction
  value_m     metres, edge to edge (diameter_factor: value = factor x the larger outer diameter)
  order       'a_above_b' / 'a_below_b' when the source also says which one must be on top (e.g. water above sewer)
  type        normative | draft_guideline | rule_of_thumb | international | no_norm
  source, clause   where the value comes from; [UNVERIFIED] = only an excerpt was seen
  compare_only     shown as a comparison, never used for the status
  on_breach   'potential_conflict' (default) or 'specialist' (no numeric norm: a breach means "specialist assessment",
              i.e. Requires investigation, never a made-up pass/fail)

Where two rows of one pair and dimension differ, the STRICTER (larger) value is used and BOTH are cited.
Every threshold is widened by both assets' positional uncertainty (TOLERANCE, by ASCE 38 quality level).
Owners' own standards (PMC water, MSEDCL, MNGL, ...) can be stricter and are not checked.
"""
from __future__ import annotations

import copy
from typing import Any

CONFIG_VERSION = "screening-rules 2026-11-22 (UNDERGROUND_RESEARCH §3; PLANNING_DEFAULTS_DECISIONS D7)"

N, G, R, I, NN = "normative", "draft_guideline", "rule_of_thumb", "international", "no_norm"
CPHEEO_W = "CPHEEO Manual on Water Supply & Treatment Systems, Part A (Mar 2024)"
# C1/C2 values confirmed in an official MoHUA copy: "Advisory on Water Quality in Distribution Systems" (MoHUA, Feb 2026)
# §1.3 Separation norms, which restates §12.9.1/§12.9.2 (mohua.gov.in/static/uploads/2026/03/1f50bd8f27197b40e6e472b5b86f4b8a.pdf).
MOHUA_ADV = "MoHUA Advisory on Water Quality in Distribution Systems (Feb 2026) §1.3"
IRC98 = "IRC:98-2024 DRAFT (Accommodation of Utility Services on Roads in Urban Areas; IRC:98-2011 is the published edition)"
IS1255 = "IS 1255:1983 Installation and maintenance of power cables up to 33 kV"
T4S = "PNGRB CGD T4S Regulations (consolidated 23-12-2024)"
UDCPR = "UDCPR 2020 cl. 14.2.1.7 (Metro NOC, 20 m from the edge of the Metro Rail) + Maha-Metro Public Notice 9549/2026 (15.04.2026), both read 2026-11-21"
DPR = "Maha-Metro Swargate–Katraj Revised Final DPR (21-12-2022)"

RULES: list[dict[str, Any]] = [
    # water ↔ sewer / storm drain
    {"id": "C1", "a": "water", "b": "sewer,storm", "dim": "H", "value_m": 3.0, "type": N, "source": CPHEEO_W, "clause": "§12.9.1",
     "confirmed_in": MOHUA_ADV,
     "note": "Parallel water main and sewer/drain at least 3 m apart, else lined and MS-encased."},
    {"id": "C2", "a": "water", "b": "sewer,storm", "dim": "V", "value_m": 0.5, "order": "a_above_b", "type": N, "source": CPHEEO_W, "clause": "§12.9.2",
     "confirmed_in": MOHUA_ADV,
     "note": "Where crossing: bottom of water main at least 0.5 m above top of sewer, for 3 m each side."},
    {"id": "C2c", "a": "water", "b": "sewer,storm", "dim": "V", "value_m": 1.0, "order": "a_above_b", "type": G, "compare_only": True,
     "source": CPHEEO_W + " [UNCONFIRMED: read only in a third-party chapter copy, civilapps.in]", "clause": "§12.2(c)",
     "note": "Listed among the requirements of an ideal distribution system: 'All distribution pipes should be laid at least one metre above the sewer lines.' Comparison only."},
    {"id": "C2b-H", "a": "water", "b": "sewer,storm", "dim": "H", "value_m": 2.0, "type": G, "source": IRC98, "clause": "§3.2.3",
     "note": "2–3 m apart."},
    {"id": "C2b-V", "a": "water", "b": "sewer,storm", "dim": "V", "value_m": 1.0, "order": "a_above_b", "type": G, "source": IRC98, "clause": "§3.3.3",
     "note": "Crossing clear at least 1.0 m; water never below sewer."},
    {"id": "C20", "a": "water", "b": "sewer,storm", "dim": "H", "value_m": 3.0, "type": I, "compare_only": True,
     "source": "Ten-States Standards / BC water-sewer separation guideline", "clause": "3 m H / 0.45 m V", "note": "International comparison only."},
    # power
    {"id": "C3", "a": "power", "b": "water,gas", "dim": "3D", "value_m": 0.3, "type": N, "source": IS1255, "clause": "§6.3.3"},
    {"id": "C3b-H", "a": "power", "b": "water", "dim": "H", "value_m": 1.0, "type": G, "source": IRC98, "clause": "§3.2.4"},
    {"id": "C3b-V", "a": "power", "b": "water", "dim": "V", "value_m": 1.0, "type": G, "source": IRC98, "clause": "§3.3.3(vi)"},
    {"id": "C4", "a": "power", "b": "telecom", "dim": "3D", "value_m": 0.3, "order": "a_below_b", "type": N, "source": IS1255,
     "clause": "§6.3.3 + amendment", "note": "Power cable never above telecom."},
    {"id": "C4b-H", "a": "power", "b": "telecom", "dim": "H", "value_m": 1.0, "type": G, "source": IRC98, "clause": "§3.2.4"},
    {"id": "C4b-V", "a": "power", "b": "telecom", "dim": "V", "value_m": 1.0, "type": G, "source": IRC98, "clause": "§3.3.3"},
    # gas (steel CGD pipeline; material is not recorded in our data, so steel values are applied)
    {"id": "C5", "a": "gas", "b": "water,sewer,storm,power,telecom,utility", "dim": "V", "value_m": 0.3, "order": "a_below_b", "type": N,
     "source": T4S, "clause": "clearance (a)", "note": "Steel gas pipeline crossing a service: laid at least 0.3 m below it."},
    {"id": "C6", "a": "gas", "b": "water,sewer,storm,power,telecom,utility", "dim": "H", "value_m": 0.3, "type": N, "source": T4S,
     "clause": "clearance (b)", "note": "Parallel to a cable, drain or other utility: at least 0.3 m clear."},
    {"id": "C7", "a": "gas", "b": "building", "dim": "H", "value_m": 3.0, "type": N, "source": T4S, "clause": "clearance (g)",
     "note": "At least 3 m from a habitable / industrial building, else +0.3 m cover or slab / casing."},
    # tunnels: no Indian numeric clearance to utilities or foundations (research C19) → specialist assessment
    {"id": "C16", "a": "tunnel,metro_tunnel", "b": "tunnel,metro_tunnel", "dim": "3D", "value_m": 0.0, "diameter_factor": 1.0,
     "type": R, "source": DPR, "clause": "twin bores c/c 15.35 m, OD 6.35 m (~1.4 D clear)", "on_breach": "specialist",
     "note": "Project value, not a code minimum: less than 1 x diameter clear needs a specialist tunnel-interaction assessment."},
    {"id": "C19", "a": "tunnel,metro_tunnel", "b": "*", "dim": "3D", "value_m": 0.0, "diameter_factor": 1.0, "type": NN,
     "source": "No Indian numeric norm found", "clause": "—", "on_breach": "specialist",
     "note": "Referral distance (1 x tunnel diameter), NOT a clearance: anything closer goes to a specialist assessment; only a "
             "physical intersection is a Potential conflict."},
    # anything else: no code value found
    {"id": "U0", "a": "*", "b": "*", "dim": "3D", "value_m": 0.3, "type": R, "source": "No code value found for this pair",
     "clause": "—", "note": "0.3 m maintenance separation, provisional (the IS 1255 / T4S figure for other pairs)."},
]

# Metro protection zone (research C15): 20 m either side of the edge of any Metro structure incl. tunnels and stations.
PROTECTION_ZONES: list[dict[str, Any]] = [
    {"id": "C15", "applies_to": "metro_tunnel,metro_station,metro_viaduct,metro", "distance_m": 20.0, "type": N, "source": UDCPR,
     "note": "Maha-Metro NOC required for any work (incl. utility laying, borewells, geotechnical investigation) within 20 m. "
             "Permission trigger, not an engineering clearance."},
]

# Cover (ground to top of asset) per proposed asset type (research C9–C14, C17). min rows below 'normative' → Potential
# conflict; below a guideline / rule of thumb → Requires investigation. band = usual depth range (C14, sanity only).
COVER: dict[str, dict[str, Any]] = {
    "gas": {"min": [{"value_m": 1.0, "type": N, "source": T4S, "clause": "Table 3 (steel main; 1.2 m at road crossings)"}],
            "band": [1.0, 3.0]},
    "power": {"min": [{"value_m": 0.75, "type": N, "source": IS1255, "clause": "§6.3.2 (LV 0.75 m)"},
                      {"value_m": 1.05, "type": N, "source": IS1255, "clause": "§6.3.2 (11 kV 0.9 m, 22–33 kV 1.05 m, road crossing 1.0 m) — voltage not recorded",
                       "voltage_dependent": True}],
              "band": [0.6, 2.0]},
    "sewer": {"min": [{"value_m": 1.0, "type": N, "source": "CPHEEO Manual on Sewerage (2013) Ch.3 [UNVERIFIED excerpt]", "clause": "min cover 1 m"}],
              "band": [1.0, 6.0]},
    "storm": {"min": [{"value_m": 0.5, "type": N, "source": "CPHEEO Manual on Sewerage (2013) Ch.3 [UNVERIFIED excerpt]", "clause": "min cover 0.5 m"}],
              "band": [0.5, 5.0]},
    "water": {"min": [{"value_m": 0.6, "type": G, "source": IRC98, "clause": "§3.3.1 (any service in a road trench; encase if < 0.6 m)"}],
              "band": [0.6, 6.0]},
    "telecom": {"min": [{"value_m": 0.6, "type": G, "source": IRC98, "clause": "§3.3.1"}], "band": [0.6, 2.0]},
    "utility": {"min": [{"value_m": 0.6, "type": G, "source": IRC98, "clause": "§3.3.1"}], "band": [0.6, 6.0]},
    "tunnel": {"min": [{"value_m": 0.0, "diameter_factor": 2.0, "type": R, "source": DPR, "clause": "NATM overburden ~2–2.5 x D (bored tunnels only)",
                        "bored_only": True}], "band": None},
    "metro_tunnel": {"min": [{"value_m": 0.0, "diameter_factor": 2.0, "type": R, "source": DPR, "clause": "NATM overburden ~2–2.5 x D",
                              "bored_only": True}], "band": None},
}
BAND_SOURCE = {"type": R, "source": IRC98, "clause": "§3.3.3 typical depths (sanity check only: 'unusual depth, verify')"}
GROUND_NOTE = ("Cover is the depth typed relative to local ground. The ground shown in 3D is a surface model (Copernicus GLO-30 "
               "DSM: roofs and trees included), not bare earth, and the road level is not surveyed: real cover is unknown "
               "until a levels survey.")

# Positional uncertainty by evidence (ASCE 38 quality level). vertical None = the record's Z cannot be used ("vertical
# not checkable"): QL-B/C/D and records without a stated datum.
TOLERANCE: dict[str, dict[str, Any]] = {
    "QL-A": {"horizontal_m": 0.05, "vertical_m": 0.03, "source": "ASCE 38-22 (QL-A 30 mm vertical, update deck); ASCE 75-22 level 2 (50 mm) [UNVERIFIED]"},
    "QL-B": {"horizontal_m": 0.3, "vertical_m": None, "source": "ASCE 75-22 level 4 (300 mm) [UNVERIFIED]; designation gives no reliable depth"},
    "QL-C": {"horizontal_m": 1.0, "vertical_m": None, "source": "ASCE 75-22 level 5 (1000 mm) [UNVERIFIED]"},
    "QL-D": {"horizontal_m": 3.0, "vertical_m": None, "source": "Undefined accuracy (records only); 3 m is a planning assumption (rule of thumb)"},
    "UNKNOWN": {"horizontal_m": 3.0, "vertical_m": None, "source": "No quality level: treated as QL-D (rule of thumb)"},
    "user-drawn": {"horizontal_m": 3.0, "vertical_m": None, "source": "Drawn by hand, no survey: treated as QL-D (rule of thumb)"},
    "user-drawn (measured)": {"horizontal_m": 0.3, "vertical_m": 0.3, "source": "Drawn by hand, depth stated as measured by the user (rule of thumb)"},
    "design": {"horizontal_m": 0.0, "vertical_m": 0.0, "source": "Proposed design geometry (exact by definition)"},
}

BUILDINGS: dict[str, Any] = {
    "influence_factor": 1.0, "min_zone_m": 2.0, "max_listed": 25, "type": R,
    "source": "No Indian numeric clearance to foundations (research C19): footprints within ~1 x invert depth (45° spread) of "
              "the asset are listed for a specialist assessment; foundation / basement depths are in no dataset here.",
}
GROUNDWATER: dict[str, Any] = {
    "radius_m": 3000.0, "recent_years": 5, "type": R,
    "source": "Research C21: flag when the structure base is below the recorded depth to water (season-aware); NWDP CGWB / "
              "GSDA manual readings at wells, point observations, not interpolated.",
}
BOREHOLES: dict[str, Any] = {"radius_m": 500.0, "type": R, "source": "Imported borehole logs within this distance (research Top 12 #11)."}

UNKNOWN_WIDTH_ALLOWANCE_M = 1.0   # a footprint of unknown width (OSM metro, PMC storm drains) is assumed this far from its centreline (R)
SCREENING_RADIUS_M = 50.0

# Indian investigation ladder (research Top 12 #12)
LADDER = [
    ("as_builts", "Request the owner's as-built drawings / records (PMC drainage, water, MSEDCL, MNGL, telecom)."),
    ("cbud", "Raise a Call Before u Dig (CBuD) request so all asset owners in the area are notified."),
    ("gpr", "GPR / electromagnetic designation survey (ASCE 38 QL-B; PMC requires GPR before roadworks)."),
    ("trial_pits", "Trial pits / vacuum excavation at the flagged crossing to expose and level the asset (QL-A)."),
    ("metro_noc", "Maha-Metro NOC (within 20 m of a Metro structure, UDCPR 14.2.1.7); request as-built tunnel / pier levels."),
    ("boreholes", "Geotechnical boreholes (and piezometers) along the alignment to at least invert depth."),
    ("specialist", "Specialist geotechnical / structural assessment (no Indian numeric clearance exists for this case)."),
]


def effective(overrides: dict | None = None) -> dict:
    """The rules used by a run (deep copy). Overrides: {'screening_radius_m': x, 'rules': {id: value_m}}; an overridden row
    becomes type 'user_override'."""
    cfg = {"version": CONFIG_VERSION, "rules": copy.deepcopy(RULES), "protection_zones": copy.deepcopy(PROTECTION_ZONES),
           "cover": copy.deepcopy(COVER), "band_source": dict(BAND_SOURCE), "ground_note": GROUND_NOTE,
           "tolerance": copy.deepcopy(TOLERANCE), "buildings": dict(BUILDINGS), "groundwater": dict(GROUNDWATER),
           "boreholes": dict(BOREHOLES), "screening_radius_m": SCREENING_RADIUS_M,
           "unknown_width_allowance_m": UNKNOWN_WIDTH_ALLOWANCE_M, "ladder": [list(x) for x in LADDER]}
    for k, v in (overrides or {}).items():
        if k == "screening_radius_m" and isinstance(v, (int, float)) and 0 < v <= 500:
            cfg[k] = float(v)
        elif k == "rules" and isinstance(v, dict):
            for r in cfg["rules"]:
                nv = v.get(r["id"])
                if isinstance(nv, (int, float)) and nv >= 0:
                    r["value_m"], r["type"] = float(nv), "user_override"
    return cfg


def _match(spec: str, cls: str) -> bool:
    return spec == "*" or cls in spec.split(",")


def rules_for(cfg: dict, a_cls: str, b_cls: str) -> list[dict]:
    """Rows for the pair, oriented so that row['a'] matches a_cls (row['_flipped'] when matched the other way round).
    Specific rows win over wildcard ones: the generic U0 row is used only when no specific row matches; C19 ('tunnel × *')
    only when no tunnel-specific row does."""
    out = []
    for r in cfg["rules"]:
        if _match(r["a"], a_cls) and _match(r["b"], b_cls):
            out.append({**r, "_flipped": False})
        elif _match(r["a"], b_cls) and _match(r["b"], a_cls):
            out.append({**r, "_flipped": True})
    specific = [r for r in out if r["a"] != "*" and r["b"] != "*"]
    if specific:
        return specific
    semi = [r for r in out if not (r["a"] == "*" and r["b"] == "*")]
    return semi or out


def requirement(cfg: dict, a_cls: str, b_cls: str, a_dia: float | None, b_dia: float | None) -> dict:
    """Stricter-wins requirement for a pair: H and V values (3D rows count for both), the rows behind each, ordering
    constraints, comparison rows and whether a breach means 'specialist assessment'."""
    rows = rules_for(cfg, a_cls, b_cls)
    used = [r for r in rows if not r.get("compare_only")]
    dias = [d for d in (a_dia, b_dia) if d]

    def val(r):
        v = r["value_m"]
        if r.get("diameter_factor") and dias:
            v = max(v, r["diameter_factor"] * max(dias))
        return v
    h_rows = [r for r in used if r["dim"] in ("H", "3D")]
    v_rows = [r for r in used if r["dim"] in ("V", "3D")]
    h = max((val(r) for r in h_rows), default=0.0)
    v = max((val(r) for r in v_rows), default=0.0)
    order = None
    for r in used:
        if r.get("order"):
            o = r["order"]
            if r["_flipped"]:
                o = "a_below_b" if o == "a_above_b" else "a_above_b"
            order = {"order": o, "rule": r["id"]}
    return {"horizontal_m": h, "vertical_m": v, "rows": [{**_cite(r), "value_m": round(val(r), 2)} for r in used],
            "h_ids": [r["id"] for r in h_rows if abs(val(r) - h) < 1e-9], "v_ids": [r["id"] for r in v_rows if abs(val(r) - v) < 1e-9],
            "compare": [_cite(r) for r in rows if r.get("compare_only")], "order": order,
            "specialist": any(r.get("on_breach") == "specialist" for r in used)}


def _cite(r: dict) -> dict:
    return {"id": r["id"], "dim": r["dim"], "value_m": r["value_m"], "type": r["type"], "source": r["source"], "clause": r["clause"],
            "note": r.get("note", ""), **({"confirmed_in": r["confirmed_in"]} if r.get("confirmed_in") else {})}


def rules_table(cfg: dict | None = None) -> list[dict]:
    """The rules table organised by asset-type pair (for the UI / docs)."""
    cfg = cfg or effective()
    by: dict[str, list] = {}
    for r in cfg["rules"]:
        by.setdefault(f"{r['a']} × {r['b']}", []).append(_cite(r) | {"compare_only": bool(r.get("compare_only")),
                                                                    "on_breach": r.get("on_breach", "potential_conflict"),
                                                                    "order": r.get("order"), "diameter_factor": r.get("diameter_factor")})
    out = [{"pair": k, "rows": v} for k, v in by.items()]
    for z in cfg["protection_zones"]:
        out.append({"pair": f"any × {z['applies_to']}", "rows": [{"id": z["id"], "dim": "H", "value_m": z["distance_m"], "type": z["type"],
                                                                  "source": z["source"], "clause": "", "note": z["note"], "on_breach": "requires_investigation"}]})
    for cls, c in cfg["cover"].items():
        out.append({"pair": f"cover · {cls}", "rows": [{"id": f"cover:{cls}", "dim": "V", "value_m": m["value_m"], "type": m["type"],
                                                        "source": m["source"], "clause": m["clause"], "note": cfg["ground_note"],
                                                        "diameter_factor": m.get("diameter_factor")} for m in c["min"]]})
    return out
