#!/usr/bin/env python3
"""
p16 city-wide robustness harness: the fixed test set of study areas (docs/urbanos/CITYWIDE_P16.md §2).

Samples ~40 study areas across Pune, stratified by road class and place type, from the app's own OSM index (the roads the
app loads), with a fixed seed. Output: citywideAreas.json next to this script's parent (frontend/src/engine/testing/),
one record per area with the stratum, why it was picked, the seed road (app road id osm_<way>), a load box and the hours.

Re-running with the same inputs (OSM index of 2026-11-02, PMC river polygons, the synthetic demand zones) and the same
seed reproduces the file exactly. Needs shapely (PYTHONPATH=/workspace/work/p14-run/pydeps on the dev machine).

  python3 sample_areas.py --osm /workspace/work/vp-int-e2e/db_osm_index.db \
     --rivers /workspace/work/urbanos-data/derived/pmc_rivers/2026-11-13/pmc_rivers.geojson \
     --zones /workspace/work/urbanos-data/synthetic/demand-v1/out/pune_synthetic_demand_v2.json \
     --wards /workspace/work/urbanos-data/raw/datameet_municipal_wards/2026-11-13
"""
import argparse, json, math, random, re, sqlite3, os
from shapely.geometry import LineString, shape, Point
from shapely.ops import unary_union
from shapely.prepared import prep

SEED = 16
HOURS = [9, 14, 19, 23]
M = 111320.0

# Place anchors (approximate centres, read off OpenStreetMap; ASSUMED to represent the place, not survey points)
IT_PARKS = [
    ("Hinjawadi Phase 1 (Rajiv Gandhi Infotech Park)", 73.7385, 18.5920),
    ("Hinjawadi Phase 3", 73.6960, 18.5880),
    ("Kharadi (EON IT Park)", 73.9470, 18.5520),
    ("Magarpatta City (Cybercity)", 73.9270, 18.5150),
    ("Talawade IT Park", 73.7880, 18.6820),
    ("Yerawada / Kalyani Nagar (Commerzone)", 73.8950, 18.5560),
]
MIDC = [
    ("Bhosari MIDC", 73.8420, 18.6330),
    ("Pimpri-Chinchwad MIDC (Telco Rd)", 73.8090, 18.6410),
    ("Chinchwad MIDC (Thermax Chowk)", 73.7800, 18.6560),
    ("Hadapsar Industrial Estate", 73.9300, 18.5030),
]
# Old city (Peth areas): Kasba, Somwar, Mangalwar, Raviwar, Shukrawar, Budhwar, Sadashiv, Narayan, Shaniwar, Ganesh,
# Nana, Bhavani peths, roughly between Shivaji Rd, Laxmi Rd, Bajirao Rd, Tilak Rd and the Mutha (ASSUMED box)
PETH_BOX = (73.8460, 18.5040, 73.8720, 18.5230)


def dist_m(a, b):
    return math.hypot((a[0] - b[0]) * M * math.cos(math.radians(a[1])), (a[1] - b[1]) * M)


def length_m(coords):
    return sum(dist_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--osm', required=True)
    ap.add_argument('--rivers', required=True)
    ap.add_argument('--zones', required=True)
    ap.add_argument('--wards', required=True, help='datameet_municipal_wards raw folder (PMC 2022 and PCMC electoral wards)')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'citywideAreas.json'))
    a = ap.parse_args()
    rng = random.Random(SEED)
    zones = [z for z in json.load(open(a.zones))['zones'] if z['kind'] == 'internal']
    zx = (min(z['lon'] for z in zones), min(z['lat'] for z in zones), max(z['lon'] for z in zones), max(z['lat'] for z in zones))
    rv = json.load(open(a.rivers))
    river = unary_union([shape(f['geometry']).buffer(0) for f in rv['features']])

    # Jurisdiction from the municipal ward outlines (datameet, community traced); the cantonments have no outline here:
    # outside PMC and PCMC, within 2 km of a CMP-2024 Cantonment zone point = Cantonment, else the rest of the PMR (fringe)
    pmc = unary_union([shape(f['geometry']).buffer(0) for f in json.load(open(os.path.join(a.wards, 'pune-electoral-wards_2022.geojson')))['features']])
    pcmc = unary_union([shape(f['geometry']).buffer(0) for f in json.load(open(os.path.join(a.wards, 'pcmc-electoral-wards.geojson')))['features']])
    cants = [z for z in zones if z['juris'] == 'Cantonment']
    pmc, pcmc = prep(pmc), prep(pcmc)
    memo = {}

    def juris(pt):
        k = (pt[0], pt[1])
        if k not in memo:
            memo[k] = juris0(pt)
        return memo[k]

    def juris0(pt):
        z = min(zones, key=lambda z: dist_m(pt, (z['lon'], z['lat'])))
        P = Point(pt[0], pt[1])
        if pcmc.contains(P):
            return 'PCMC', z['name']
        if pmc.contains(P):
            return 'PMC', z['name']
        if any(dist_m(pt, (c['lon'], c['lat'])) <= 2000 for c in cants):
            return 'Cantonment', z['name']
        return 'PMR', z['name']

    con = sqlite3.connect(f'file:{a.osm}?mode=ro', uri=True)
    ways = []
    for wid, tags, geom in con.execute('select id, tags, geometry from ways order by id'):
        t = json.loads(tags)
        hw = t.get('highway')
        if hw not in ('trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street',
                      'trunk_link', 'primary_link', 'secondary_link'):
            continue
        if t.get('access') in ('private', 'no') or t.get('area') == 'yes':
            continue
        g = json.loads(geom)
        mid = g[len(g) // 2]
        if not (zx[0] <= mid[0] <= zx[2] and zx[1] <= mid[1] <= zx[3]):
            continue
        ways.append({'id': wid, 'hw': hw, 'tags': t, 'g': g, 'mid': mid, 'len': length_m(g),
                     'bridge': t.get('bridge') not in (None, 'no'), 'name': t.get('name', '')})

    picked = []

    def far_enough(pt, min_m):
        return all(dist_m(pt, p['centre']) >= min_m for p in picked)

    def take(pool, k, stratum, road_class, why, min_sep=2500, extra=None):
        pool = sorted(pool, key=lambda w: w['id'])
        rng.shuffle(pool)
        got = 0
        for w in pool:
            if got >= k:
                break
            if not far_enough(w['mid'], min_sep):
                continue
            # one area per named road per stratum
            if w['name'] and any(p['stratum'] == stratum and p['roadName'] == w['name'] for p in picked):
                continue
            j, zname = juris(w['mid'])
            xs = [c[0] for c in w['g']]; ys = [c[1] for c in w['g']]
            pad = 300 / M
            picked.append({
                'id': f"p16_{len(picked) + 1:02d}_{stratum}",
                'stratum': stratum, 'roadClass': road_class, 'osmHighway': w['hw'],
                'roadName': w['name'] or None, 'seedRoadIds': [f"osm_{w['id']}"],
                'centre': [round(w['mid'][0], 6), round(w['mid'][1], 6)],
                'jurisdiction': j, 'nearestZone': zname,
                'loadBox': {'minLng': min(xs) - pad, 'minLat': min(ys) - pad, 'maxLng': max(xs) + pad, 'maxLat': max(ys) + pad},
                'range': 2000, 'hours': HOURS,
                'why': why(w) if callable(why) else why,
                **(extra(w) if extra else {}),
            })
            got += 1
        return got

    # Rare strata first (so the minimum spacing never squeezes them out), then the road classes
    # 5. River bridges over the Mula, Mutha, Mula-Mutha (PMC river polygons) and the Pavana (OSM name): 5
    brg = [w for w in ways if w['bridge'] and w['len'] >= 60 and w['hw'] in ('trunk', 'primary', 'secondary', 'tertiary')
           and 'bypass' not in w['name'].lower()
           and (LineString(w['g']).intersects(river) or re.search(r'pavana|pawana', w['name'], re.I))]
    take([w for w in brg if re.search(r'pavana|pawana', w['name'], re.I)], 1, 'bridge', 'bridge',
         lambda w: f"river bridge over the Pavana: {w['name']}", min_sep=1500)
    take([w for w in brg if not re.search(r'pavana|pawana', w['name'], re.I)], 4, 'bridge', 'bridge',
         lambda w: f"river bridge over the Mula/Mutha (crosses the PMC river polygon): {w['name'] or 'unnamed'}", min_sep=1500)
    # 6. Flyovers / road over-bridges (bridge not over a river, main road, >= 250 m): 3
    fly = [w for w in ways if w['bridge'] and w['len'] >= 250 and w['hw'] in ('trunk', 'primary', 'secondary', 'trunk_link', 'primary_link')
           and not LineString(w['g']).intersects(river)]
    take(fly, 3, 'flyover', 'flyover', lambda w: f"flyover / road over-bridge ({w['hw']}, {round(w['len'])} m) {w['name'] or 'unnamed'}", min_sep=2000)
    # 7. Old-city lanes (Peth areas): 4, closer together (the old city is small)
    x0, y0, x1, y1 = PETH_BOX
    take([w for w in ways if w['hw'] in ('residential', 'unclassified', 'living_street', 'tertiary') and not w['bridge'] and w['len'] >= 60
          and x0 <= w['mid'][0] <= x1 and y0 <= w['mid'][1] <= y1], 4, 'oldcity', 'old-city lane',
         lambda w: f"old-city (Peth) street ({w['hw']}) {w['name'] or 'unnamed'}", min_sep=600)
    # 8. IT parks: 3 of the anchors, a road within 700 m of the anchor
    for name, lon, lat in sorted(rng.sample(IT_PARKS, 3)):
        take([w for w in ways if w['hw'] in ('primary', 'secondary', 'tertiary', 'residential', 'unclassified') and not w['bridge']
              and dist_m(w['mid'], (lon, lat)) <= 700], 1, 'itpark', 'IT park', lambda w, n=name: f"IT park: {n} ({w['hw']} {w['name'] or 'unnamed'})", min_sep=1500)
    # 9. MIDC industrial areas: 3 of the anchors
    for name, lon, lat in sorted(rng.sample(MIDC, 3)):
        take([w for w in ways if w['hw'] in ('primary', 'secondary', 'tertiary', 'residential', 'unclassified') and not w['bridge']
              and dist_m(w['mid'], (lon, lat)) <= 800], 1, 'midc', 'MIDC', lambda w, n=name: f"industrial: {n} ({w['hw']} {w['name'] or 'unnamed'})", min_sep=1500)
    # 10. Fringe villages: 4 CMP-2024 zones of the rest of the PMR (outside PMC/PCMC/Cantonments), a road near the zone point
    fr = sorted([z for z in zones if z['juris'] == 'PMR'], key=lambda z: z['name'])
    rng.shuffle(fr)
    n_fr = 0
    for z in fr:
        if n_fr >= 4:
            break
        n_fr += take([w for w in ways if w['hw'] in ('secondary', 'tertiary', 'residential', 'unclassified') and not w['bridge']
                      and dist_m(w['mid'], (z['lon'], z['lat'])) <= 1200 and juris(w['mid'])[0] == 'PMR'], 1, 'fringe', 'fringe village',
                     lambda w, z=z: f"fringe village / PMR zone {z['name']} ({w['hw']} {w['name'] or 'unnamed'})", min_sep=3000)

    main_cls = ('trunk', 'primary')
    # 1. Arterials (Indo-HCM / IRC:86 arterial = OSM trunk, primary): 5
    take([w for w in ways if w['hw'] in main_cls and not w['bridge'] and w['len'] >= 150], 5, 'arterial', 'arterial',
         lambda w: f"arterial ({w['hw']}) {w['name'] or 'unnamed'}: random draw from {sum(1 for x in ways if x['hw'] in main_cls)} arterial ways")
    # 2. Sub-arterials (secondary): 4
    take([w for w in ways if w['hw'] == 'secondary' and not w['bridge'] and w['len'] >= 120], 4, 'subarterial', 'sub-arterial',
         lambda w: f"sub-arterial (secondary) {w['name'] or 'unnamed'}")
    # 3. Collectors (tertiary): 4
    take([w for w in ways if w['hw'] == 'tertiary' and not w['bridge'] and w['len'] >= 100], 4, 'collector', 'collector',
         lambda w: f"collector (tertiary) {w['name'] or 'unnamed'}")
    # 4. Local / residential streets: 6, at least one per jurisdiction group
    loc = [w for w in ways if w['hw'] in ('residential', 'living_street', 'unclassified') and not w['bridge'] and w['len'] >= 80]
    for jset, k in ((('PMC',), 2), (('PCMC',), 2), (('Cantonment',), 1), (('PMR',), 1)):
        take([w for w in loc if juris(w['mid'])[0] in jset], k, 'local', 'local',
             lambda w: f"local street ({w['hw']}) {w['name'] or 'unnamed'}, {juris(w['mid'])[0]}", min_sep=2000)
    doc = {'schema': 'urbanos.citywide_areas/v1', 'seed': SEED, 'hours': HOURS,
           'built': 'sample_areas.py (frontend/src/engine/testing/citywide)', 'osmIndex': 'db_osm_index.db (western-zone-latest.osm.pbf, 2026-11-02)',
           'strata': sorted({p['stratum'] for p in picked}), 'areas': picked}
    with open(a.out, 'w') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    from collections import Counter
    print(len(picked), Counter(p['stratum'] for p in picked), Counter(p['jurisdiction'] for p in picked))


if __name__ == '__main__':
    main()
