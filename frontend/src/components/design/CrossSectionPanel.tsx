import React, { useMemo, useState } from 'react';
import { engineInstance } from '../../engine/TwinCityEngine';
import { BASE_SCENARIO_ID } from '../../engine/scenarios/ScenarioManager';
import type { RoadObject } from '../../engine/objects/types';
import { CROSS_SECTION_TEMPLATES, SOURCES, USDG_IN_BETWEEN_RULE, sourceLabel, templateById, templateForRow } from '../../engine/crossSection/templates';
import { commitCrossSectionTemplate, sectionView, upgradeBlockReason, type SectionWithTemplate } from '../../engine/crossSection/apply';
import { checkCrossSection, summarizeChecks, type XsCheck } from '../../engine/crossSection/checks';
import { CrossSectionDiagram, CrossSectionLegend } from './CrossSectionDiagram';

const icon = (s: XsCheck['status']) => (s === 'pass' ? '✅' : s === 'warn' ? '⚠️' : s === 'unknown' ? '❔' : s === 'info' ? 'ℹ️' : '❌');
const colour = (s: XsCheck['status']) => (s === 'pass' ? 'text-emerald-400' : s === 'warn' ? 'text-amber-400' : s === 'fail' ? 'text-red-400' : 'text-slate-400');

/** The cross-section screening results, in the same card layout as the flyover desk check. */
export const CrossSectionChecks: React.FC<{ checks: readonly XsCheck[] }> = ({ checks }) => {
  const sum = summarizeChecks(checks);
  const head = sum.fail + sum.warn > 0 ? `${sum.fail + sum.warn} flag${sum.fail + sum.warn > 1 ? 's' : ''}${sum.unknown ? ` · ${sum.unknown} not screened` : ''}`
    : sum.unknown ? `No flag found · ${sum.unknown} not screened` : 'No flag found';
  return (
    <div className="space-y-1.5" data-testid="xs-checks">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-bold text-slate-400 uppercase tracking-widest font-mono">Cross-section checks <span className="ml-1 rounded border border-amber-400/30 px-1 text-[9px] text-amber-300 normal-case tracking-normal">screening</span></span>
        <span className={`font-bold ${sum.fail ? 'text-red-400' : sum.warn ? 'text-amber-300' : 'text-slate-300'}`} data-testid="xs-checks-summary">{head}</span>
      </div>
      {checks.map(c => (
        <div key={c.id} className="bg-slate-900/40 border border-white/5 rounded-lg p-2.5 text-xs space-y-0.5" data-testid={`xs-check-${c.id}`} data-status={c.status}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5"><span>{icon(c.status)}</span><span>{c.name}</span></span>
            <span className={`text-[11px] font-bold font-mono ${colour(c.status)}`}>{c.actual == null ? '—' : c.required == null ? `${c.actual} ${c.unit}` : `${c.actual} / ${c.required} ${c.unit}`}</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">{c.message}</p>
          <p className="text-[10px] text-slate-600 leading-relaxed">Source: {c.basis}</p>
        </div>
      ))}
    </div>
  );
};

/**
 * Road inspector: the road's street cross-section (diagram), its screening checks, the available right-of-way, and
 * "Upgrade to a template" with a before/after diagram. Applying a template is one Undo step; an OSM baseline road is
 * only changed as a proposal's copy (docs/urbanos/CROSS_SECTIONS.md).
 */
export const CrossSectionPanel: React.FC<{ road: RoadObject }> = ({ road }) => {
  const sections = (road.sections ?? []) as SectionWithTemplate[];
  const sec = sections[0];
  const view = useMemo(() => (sec ? sectionView(sec) : null), [sec]);
  const suggested = road.availableRowM ? templateForRow(road.availableRowM) : undefined;
  const [pick, setPick] = useState<string>('');
  const chosen = templateById(pick || suggested?.id || '');
  const block = upgradeBlockReason(road, { activeScenarioId: engineInstance.objects.getActiveScenarioId(), baseScenarioId: BASE_SCENARIO_ID });
  const checks = useMemo(() => (view ? checkCrossSection(view.elements, { roadClass: road.roadClass, availableRowM: road.availableRowM, availableRowSource: road.availableRowSource }) : []),
    [view, road.roadClass, road.availableRowM, road.availableRowSource]);
  const previewChecks = useMemo(() => (chosen ? summarizeChecks(checkCrossSection(chosen.elements, { roadClass: road.roadClass, availableRowM: road.availableRowM })) : null),
    [chosen, road.roadClass, road.availableRowM]);
  if (!sec || !view) return null;

  const setRow = (field: 'availableRowM' | 'availableRowSource', value: number | null | string) => {
    if (block) return;
    const updates = { [field]: value } as Partial<RoadObject>;
    engineInstance.history.recordUpdate(road, { ...road, ...updates }, `Update ${road.name || road.id} available RoW`, `${road.id}:${field}`);
    engineInstance.objects.update(road.id, updates);
  };
  const apply = () => {
    if (!chosen) return;
    const res = commitCrossSectionTemplate(engineInstance.objects, engineInstance.history, road, chosen, BASE_SCENARIO_ID);
    if (!res.ok) { (window as any).showToast?.(res.reason, 'error'); return; }
    (window as any).showToast?.(`Cross-section ${chosen.code} applied to ${road.name || 'the road'} (Undo reverts it).`, 'info');
    setPick('');
  };
  const replaced = view.template?.replaced;

  return (
    <section className="space-y-3 rounded-xl border border-white/5 bg-slate-950/20 p-3" data-testid="xs-panel">
      <div className="space-y-1">
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest font-mono">Street cross-section</div>
        {sections.length > 1 && <p className="text-[11px] text-slate-500">This road has {sections.length} section profiles; the first is shown. Applying a template replaces them with one.</p>}
        {replaced
          ? <div className="space-y-1.5" data-testid="xs-before-after">
              <CrossSectionDiagram elements={replaced} title="Before" testId="xs-diagram-before" compact />
              <CrossSectionDiagram elements={view.elements} title={`After — template ${view.template!.code}`} testId="xs-diagram-current" />
            </div>
          : <CrossSectionDiagram elements={view.elements} title={view.template ? `Template ${view.template.code}` : 'As stored'} testId="xs-diagram-current" />}
        {view.template && <p className="text-[10px] text-slate-500" data-testid="xs-template-source">Source: {sourceLabel(view.template.source)}. {templateById(view.template.templateId)?.widthsRead}</p>}
        {view.templateEdited && <p className="text-[11px] text-amber-300" data-testid="xs-template-edited">Edited after template {sec.crossSection!.code} was applied; the strips below are read from the stored profile.</p>}
        <CrossSectionLegend />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5 text-[11px] text-slate-400">Available RoW (m)
          <input type="number" min={0} step={0.5} data-testid="xs-available-row" disabled={!!block} placeholder="Unknown"
            value={road.availableRowM ?? ''} onChange={e => { const v = Number(e.target.value); setRow('availableRowM', e.target.value === '' || !(v > 0) ? null : v); }}
            className="bg-slate-900 border border-slate-700/50 rounded-lg p-1.5 text-xs text-slate-200 disabled:opacity-50" />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-slate-400">RoW source
          <input type="text" data-testid="xs-available-row-source" disabled={!!block} placeholder="e.g. DP sheet / survey"
            value={road.availableRowSource ?? ''} onChange={e => setRow('availableRowSource', e.target.value)}
            className="bg-slate-900 border border-slate-700/50 rounded-lg p-1.5 text-xs text-slate-200 disabled:opacity-50" />
        </label>
      </div>
      <p className="text-[10px] text-slate-500">Blank = unknown: the right-of-way fit is then not screened. The drawn width is not the right-of-way.</p>

      <CrossSectionChecks checks={checks} />

      <div className="space-y-1.5 border-t border-white/5 pt-2" data-testid="xs-upgrade">
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest font-mono">Upgrade to a template</div>
        <select data-testid="xs-template-select" value={pick || suggested?.id || ''} onChange={e => setPick(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700/50 rounded-lg p-2 text-xs text-slate-200">
          <option value="">Choose a template…</option>
          {CROSS_SECTION_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}{suggested?.id === t.id ? ' (fits the available RoW)' : ''}</option>)}
        </select>
        {road.availableRowM && !suggested && <p className="text-[11px] text-amber-300">No USDG template is narrower than {road.availableRowM} m among those loaded (smallest 12 m).</p>}
        {chosen && (
          <div className="space-y-1">
            <CrossSectionDiagram elements={view.elements} title="Before" testId="xs-preview-before" compact />
            <CrossSectionDiagram elements={chosen.elements} title={`After — ${chosen.code}`} testId="xs-preview-after" />
            <p className="text-[10px] text-slate-500">{chosen.use} Source: {sourceLabel(chosen.source)}. {chosen.widthsRead}</p>
            {previewChecks && <p className="text-[11px] text-slate-400" data-testid="xs-preview-checks">Screening of the template here: {previewChecks.fail} fail · {previewChecks.warn} warn · {previewChecks.unknown} not screened.</p>}
            <p className="text-[10px] text-slate-500">{USDG_IN_BETWEEN_RULE.text} ({sourceLabel(USDG_IN_BETWEEN_RULE.source)})</p>
            {block
              ? <p className="text-[11px] text-amber-300" data-testid="xs-upgrade-blocked">{block}</p>
              : <button type="button" onClick={apply} data-testid="xs-apply"
                  className="w-full rounded-lg border border-indigo-400/30 bg-indigo-500/15 px-3 py-1.5 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/25">
                  Apply {chosen.code} to this road (one Undo step)
                </button>}
          </div>
        )}
        <p className="text-[10px] text-slate-600">Templates: {SOURCES.USDG.title} ({SOURCES.USDG.status}). Checks also use {SOURCES.IRC86.title} ({SOURCES.IRC86.status}). Screening only — not a design check or approval.</p>
      </div>
    </section>
  );
};
