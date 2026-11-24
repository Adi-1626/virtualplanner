/**
 * p13 project-level check against ESTIMATED / third-party data (docs/urbanos/VALIDATION_P13.md).
 *
 * Kept apart from the official-count check (components/ui/badges/trafficValidation.ts), which is unchanged and still
 * reports its own result. The data here are labelled estimated: Google Maps typical journey times (read 2026-11-25 for
 * a weekday 09:00 and 23:00) and counts from published studies (Maha-Metro DPR surveys, Nov-Dec 2021, factored to 2026).
 *
 * Criteria (fixed, never loosened; the same numbers as the TAG units they come from):
 * - counts: GEH < 5 at >= 85 % of sites (TAG M3.1 §3.3);
 * - journey times: modelled time within 15 % of the observed time, or within 1 minute if that is larger, on >= 85 % of
 *   routes (TAG M3.1 §3.3, journey-time validation criterion);
 * - screen line: the river crossings' total within 5 % (TAG M3.1);
 * - R² of modelled against counted flows is reported, with no pass mark (TAG sets R² limits for matrix change only).
 * The verdict is computed on the HOLD-OUT records only (never used in any tuning).
 */
export const PROJECT_CRITERIA = Object.freeze({ gehMax: 5, gehShare: 0.85, jtRel: 0.15, jtAbsMin: 1, jtShare: 0.85, screenlineRel: 0.05 });

export interface ProjectObs {
  id: string; record: string; kind: 'jt' | 'count'; split: 'calibration' | 'holdout'; roadClass: string; area: string; hour: number;
  observed: number;
  /** Modelled value (minutes for a journey time, motor vehicles per hour for a count); null when the model gave none. */
  model: number | null;
  routeKm?: number; googleKm?: number; range?: [number, number]; note?: string;
}

export const geh = (m: number, c: number) => Math.sqrt((2 * (m - c) ** 2) / Math.max(1e-9, m + c));
/** TAG journey-time criterion: within 15 % or 1 minute, whichever is larger. */
export const jtOk = (m: number, o: number) => Math.abs(m - o) <= Math.max(PROJECT_CRITERIA.jtRel * o, PROJECT_CRITERIA.jtAbsMin);

export interface GroupScore {
  counts: { n: number; gehOk: number; share: number; meanGeh: number | null; r2: number | null; bias: number | null; missing: number };
  jt: { n: number; ok: number; share: number; medianRelErr: number | null; meanRelErr: number | null; missing: number; byHour: Record<string, { n: number; ok: number }> };
  river: { n: number; model: number; observed: number; pct: number | null };
}
export interface ProjectScore { calibration: GroupScore; holdout: GroupScore; all: GroupScore; pass: boolean; checks: { counts: boolean; jt: boolean; screenline: boolean }; loss: number; summary: Record<string, unknown> }

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function scoreGroup(obs: readonly ProjectObs[]): GroupScore {
  const cs = obs.filter(o => o.kind === 'count'), js = obs.filter(o => o.kind === 'jt');
  const cm = cs.filter(o => o.model !== null), jm = js.filter(o => o.model !== null);
  const gehs = cm.map(o => geh(o.model!, o.observed));
  // A count with no model value counts as a failure (the share is over all sites)
  const gehOk = gehs.filter(g => g < PROJECT_CRITERIA.gehMax).length;
  let r2: number | null = null;
  if (cm.length >= 3) {
    const mo = cm.reduce((n, o) => n + o.observed, 0) / cm.length;
    const ssTot = cm.reduce((n, o) => n + (o.observed - mo) ** 2, 0), ssRes = cm.reduce((n, o) => n + (o.observed - o.model!) ** 2, 0);
    r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
  }
  const sumM = cm.reduce((n, o) => n + o.model!, 0), sumO = cm.reduce((n, o) => n + o.observed, 0);
  const rel = jm.map(o => (o.model! - o.observed) / o.observed);
  const byHour: Record<string, { n: number; ok: number }> = {};
  for (const o of js) { const h = (byHour[String(o.hour)] ??= { n: 0, ok: 0 }); h.n++; if (o.model !== null && jtOk(o.model, o.observed)) h.ok++; }
  const jok = jm.filter(o => jtOk(o.model!, o.observed)).length;
  const rv = cm.filter(o => o.area === 'river');
  const rm = rv.reduce((n, o) => n + o.model!, 0), ro = rv.reduce((n, o) => n + o.observed, 0);
  return {
    counts: { n: cs.length, gehOk, share: cs.length ? gehOk / cs.length : 0, meanGeh: gehs.length ? gehs.reduce((a, b) => a + b, 0) / gehs.length : null, r2, bias: sumO > 0 ? sumM / sumO - 1 : null, missing: cs.length - cm.length },
    jt: { n: js.length, ok: jok, share: js.length ? jok / js.length : 0, medianRelErr: median(rel), meanRelErr: rel.length ? rel.reduce((a, b) => a + b, 0) / rel.length : null, missing: js.length - jm.length, byHour },
    river: { n: rv.length, model: Math.round(rm), observed: Math.round(ro), pct: ro > 0 ? rm / ro - 1 : null },
  };
}

/** Robust (Cauchy) tuning loss: journey times scaled by the 15 % criterion, counts by GEH 5; a missing value costs as a 3x miss. */
export function projectLoss(obs: readonly ProjectObs[]): number {
  const MISS = Math.log(1 + 9);
  const js = obs.filter(o => o.kind === 'jt'), cs = obs.filter(o => o.kind === 'count');
  const lj = js.map(o => (o.model === null || o.model <= 0 ? MISS : Math.log(1 + (Math.log(o.model / o.observed) / PROJECT_CRITERIA.jtRel) ** 2)));
  const lc = cs.map(o => (o.model === null ? MISS : Math.log(1 + (geh(o.model, o.observed) / PROJECT_CRITERIA.gehMax) ** 2)));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return mean(lj) + mean(lc);
}

export function scoreProjectCheck(obs: readonly ProjectObs[]): ProjectScore {
  const calibration = scoreGroup(obs.filter(o => o.split === 'calibration'));
  const holdout = scoreGroup(obs.filter(o => o.split === 'holdout'));
  const all = scoreGroup(obs);
  const checks = {
    counts: holdout.counts.n > 0 && holdout.counts.share >= PROJECT_CRITERIA.gehShare,
    jt: holdout.jt.n > 0 && holdout.jt.share >= PROJECT_CRITERIA.jtShare,
    screenline: holdout.river.pct !== null && Math.abs(holdout.river.pct) <= PROJECT_CRITERIA.screenlineRel,
  };
  const pct = (x: number | null) => (x === null ? null : +(100 * x).toFixed(1));
  const sum = (g: GroupScore) => ({ geh: `${g.counts.gehOk}/${g.counts.n}`, meanGeh: g.counts.meanGeh && +g.counts.meanGeh.toFixed(1), r2: g.counts.r2 && +g.counts.r2.toFixed(3), bias: pct(g.counts.bias),
    jt: `${g.jt.ok}/${g.jt.n}`, jtMedianErr: pct(g.jt.medianRelErr), jtByHour: g.jt.byHour, river: pct(g.river.pct), riverN: g.river.n });
  return { calibration, holdout, all, pass: checks.counts && checks.jt && checks.screenline, checks, loss: projectLoss(obs), summary: { calibration: sum(calibration), holdout: sum(holdout) } };
}
