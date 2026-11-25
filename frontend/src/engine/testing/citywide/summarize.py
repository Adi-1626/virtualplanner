#!/usr/bin/env python3
"""Summarise a p16 harness run (JSON lines from P16Citywide.test.ts): pass counts by stratum and hour, band failures,
key metrics per area. Usage: summarize.py RUN.jsonl [--md] [--areas]"""
import json, sys, statistics as st
from collections import defaultdict

STRATA = ['arterial', 'subarterial', 'collector', 'local', 'bridge', 'flyover', 'oldcity', 'itpark', 'midc', 'fringe']
HOURS = [9, 14, 19, 23]


def load(path):
    rows = {}
    for line in open(path):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if 'area' in r and 'hour' in r:
            rows[(r['area'], r['hour'])] = r  # last row wins (re-runs)
    return list(rows.values())


def table(rows, md=True):
    out = []
    by = defaultdict(lambda: [0, 0])
    for r in rows:
        k = (r['stratum'], r['hour'])
        by[k][1] += 1
        by[k][0] += 1 if r.get('bands', {}).get('pass') else 0
    hdr = '| Stratum | ' + ' | '.join(f'{h:02d}:00' for h in HOURS) + ' | All |'
    out += [hdr, '|' + '---|' * (len(HOURS) + 2)]
    tot = [0, 0]
    col = {h: [0, 0] for h in HOURS}
    for s in STRATA:
        cells, ps, ns = [], 0, 0
        for h in HOURS:
            p, n = by.get((s, h), [0, 0])
            cells.append(f'{p}/{n}' if n else '-')
            ps += p; ns += n; col[h][0] += p; col[h][1] += n
        tot[0] += ps; tot[1] += ns
        out.append(f'| {s} | ' + ' | '.join(cells) + f' | {ps}/{ns} |')
    out.append('| **all** | ' + ' | '.join(f'**{col[h][0]}/{col[h][1]}**' for h in HOURS) + f' | **{tot[0]}/{tot[1]}** |')
    return '\n'.join(out), tot


def failures(rows):
    f = defaultdict(lambda: defaultdict(int))
    for r in rows:
        for b in r.get('bands', {}).get('failed', []):
            f[b][r['hour']] += 1
    lines = ['| Band | ' + ' | '.join(f'{h:02d}:00' for h in HOURS) + ' |', '|' + '---|' * (len(HOURS) + 1)]
    for b in sorted(f):
        lines.append(f'| {b} | ' + ' | '.join(str(f[b].get(h, 0)) for h in HOURS) + ' |')
    return '\n'.join(lines)


def per_area(rows):
    lines = ['| Area | h | demand veh/h | through % | median ratio | p10 km/h | v/c>1.2 len % | studied road ratio (max v/c) | micro trip km/h | failed |', '|' + '---|' * 10]
    for r in sorted(rows, key=lambda r: (r['area'], r['hour'])):
        if not r.get('ok'):
            lines.append(f"| {r['area']} | {r['hour']} | - | - | - | - | - | - | - | {r.get('error','')[:60]} |")
            continue
        p = r.get('parts', {}); tot = sum(p.values()) or 1
        mic = r.get('micro', {}).get('runs', [])
        mk = '/'.join(f"{x['tripKmh']:.0f}" if x.get('tripKmh') else '-' for x in mic)
        sec = r.get('section', {})
        lines.append(f"| {r['area']} | {r['hour']} | {r.get('demandVph')} | {100*p.get('through',0)/tot:.0f} | {r.get('speedRatioMedian') or 0:.2f} | {r.get('speedKmhP10') or 0:.1f} | {100*r.get('overLenShare',0):.1f} | {sec.get('ratio')} ({sec.get('maxVc')}) | {mk} | {','.join(r['bands']['failed'])} |")
    return '\n'.join(lines)


if __name__ == '__main__':
    rows = load(sys.argv[1])
    t, tot = table(rows)
    print(f'rows {len(rows)}; pass {tot[0]}/{tot[1]}\n')
    print(t)
    print()
    print(failures(rows))
    if '--areas' in sys.argv:
        print()
        print(per_area(rows))
