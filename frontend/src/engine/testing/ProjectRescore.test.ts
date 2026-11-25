import { describe, it } from 'vitest';
import fs from 'fs';
import { scoreProjectCheck, type ProjectObs } from '../calibration/projectCheck';

/**
 * Opt-in (RESCORE=1): re-score recorded project-check runs after a record fix, without re-running the unchanged records
 * (records are evaluated independently, so replacing the changed records' observations is the same as a full re-run).
 *   RESCORE_IN     JSON-lines run output; each line with `obs` and a name (`eval`, `screen.name`) is one run
 *   RESCORE_PATCH  JSON-lines with the same names, carrying `obs` for the changed records only (matched by obs id)
 *   RESCORE_OUT    JSON-lines output: name, the full score (loss, calibration, hold-out)
 * Used for the validation-v1 2026-11-25 record fix (docs/urbanos/VALIDATION_P13.md).
 */
const nameOf = (d: { eval?: string; screen?: { name: string } }) => d.eval ?? d.screen?.name ?? null;
describe.runIf(!!process.env.RESCORE)('re-score recorded project-check runs', () => {
  it('re-scores', () => {
    const read = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { eval?: string; screen?: { name: string }; obs?: ProjectObs[] });
    const patch = new Map<string, Map<string, ProjectObs>>();
    for (const d of process.env.RESCORE_PATCH ? read(process.env.RESCORE_PATCH) : []) { const n = nameOf(d); if (n && d.obs) patch.set(n, new Map(d.obs.map(o => [o.id, o]))); }
    for (const d of read(process.env.RESCORE_IN!)) {
      const n = nameOf(d); if (!n || !d.obs) continue;
      const p = patch.get(n); let replaced = 0;
      const obs = d.obs.map(o => { const q = p?.get(o.id); if (q) { replaced++; return q; } return o; });
      fs.appendFileSync(process.env.RESCORE_OUT!, JSON.stringify({ name: n, replaced, score: scoreProjectCheck(obs) }) + '\n');
    }
  });
});
