import type { ScreeningFinding } from '../../lib/coordinationApi';

/**
 * Insufficient-data findings grouped by their shared reason (one dataset, network or missing input), so ~1,000 "vertical not
 * checkable" pairs read as a handful of lines: "PMC storm-water drains: no depth recorded — vertical clearance not checkable
 * · 501 crossings or near passes". The backend sets `gap_group`; older results without it fall back to category / dataset.
 */
export interface GapGroup { key: string; label: string; unit: string; findings: ScreeningFinding[]; crossings: number; objects: number }

const plural = (n: number, unit: string) => {
  if (n === 1) return `1 ${unit}`;
  if (unit === 'crossing or near pass') return `${n} crossings or near passes`;
  return `${n} ${unit.endsWith('s') ? unit : `${unit}s`}`;
};

export function gapGroupOf(f: ScreeningFinding): { key: string; label: string; unit: string } {
  if (f.gap_group) return f.gap_group;
  const ds = f.other?.dataset?.name;
  if (f.other && ds) {
    const name = ds.split(' — ')[0].split(' (')[0].split(',')[0].trim();
    return { key: `vertical:${f.other.dataset?.id ?? name}`, label: `${name}: vertical clearance not checkable`, unit: 'crossing or near pass' };
  }
  return { key: `cat:${f.category}`, label: f.title, unit: 'finding' };
}

/** Groups in first-seen order of size (largest first), each with how many cross in plan and how many proposed objects it touches. */
export function groupGaps(findings: readonly ScreeningFinding[]): GapGroup[] {
  const by = new Map<string, GapGroup>();
  for (const f of findings) {
    const g = gapGroupOf(f);
    let cur = by.get(g.key);
    if (!cur) { cur = { ...g, findings: [], crossings: 0, objects: 0 }; by.set(g.key, cur); }
    cur.findings.push(f);
    if (f.measurements?.crossing === true) cur.crossings += 1;
  }
  for (const g of by.values()) g.objects = new Set(g.findings.map(f => f.proposed.id)).size;
  return [...by.values()].sort((a, b) => b.findings.length - a.findings.length || a.label.localeCompare(b.label));
}

/** "501 crossings or near passes (444 cross in plan) · 21 proposed objects" — the count line of a group. */
export function gapCountText(g: GapGroup): string {
  const parts = [plural(g.findings.length, g.unit)];
  if (g.unit === 'crossing or near pass' && g.crossings > 0 && g.crossings < g.findings.length) parts[0] += ` (${g.crossings} cross in plan)`;
  if (g.unit !== 'object' && g.objects > 1) parts.push(`${g.objects} proposed objects`);
  return parts.join(' · ');
}
