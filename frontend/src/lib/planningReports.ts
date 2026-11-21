/** View-model helpers for the Reports workspace (pure; unit-tested). */
import type { AuditEvent } from '../engine/planning/planningApi';
import type { StaleVerdict } from './coordinationApi';
import { plural } from './plural';

export interface ReportScopeInfo {
  alternatives: number; datasets: number; assessments: number; runs: number; decisions: number;
  /** Findings visible to the project; null = could not be read (not 0). */
  issues: number | null;
  lastDetection: (StaleVerdict & { id: string; created_at: string }) | null;
  lastPdf: string | null; lastDocx: string | null; lastCsv: string | null;
}

/** Time of the newest `export` audit event of the project with this label (e.g. "PDF report"), or null = never. */
export function lastExport(events: readonly Pick<AuditEvent, 'action' | 'label' | 'at' | 'entity_type'>[], label: string): string | null {
  let best: string | null = null;
  for (const e of events) {
    if (e.action !== 'export' || e.entity_type !== 'project_report' || e.label !== label) continue;
    if (best == null || e.at > best) best = e.at;
  }
  return best;
}

/** The "Inputs:" line of a report card, with correct singular / plural ("1 alternative", not "1 alternatives"). */
export function reportInputsText(s: Pick<ReportScopeInfo, 'alternatives' | 'datasets' | 'assessments' | 'runs' | 'decisions'>): string {
  return `Inputs: ${[plural(s.alternatives, 'alternative'), plural(s.datasets, 'dataset'), plural(s.assessments, 'screening'),
    plural(s.runs, 'run'), plural(s.decisions, 'decision')].join(' · ')}`;
}
