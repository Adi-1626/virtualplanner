import React, { useEffect, useMemo, useState } from 'react';
import { engineInstance } from '../../engine/TwinCityEngine';
import type { CityObject, UndergroundAlignmentObject, UtilityObject } from '../../engine/objects/types';
import { utilityAsAlignment } from '../../engine/underground/utilityModel';
import type { Certainty } from '../../engine/objects/certainty';
import { isAlignment } from '../../engine/underground/alignmentFactory';
import { useEngineObjects } from '../../shell/useEngineObjects';
import { useUndergroundStore } from './undergroundStore';

export const field = 'flex flex-col gap-0.5';
export const lbl = 'text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5';
export const input = 'rounded border px-1.5 py-1 text-[13px] focus:outline-none w-full';
export const inputStyle: React.CSSProperties = { background: 'var(--surface-2, #1E252E)', borderColor: 'var(--border-strong, #4A5563)', color: 'var(--text-1, #E6EAF0)' };
export const labelStyle: React.CSSProperties = { color: 'var(--text-2, #A9B3C1)' };
export const note: React.CSSProperties = { color: 'var(--text-3, #8B95A3)' };

export const CERTAINTY_OPTIONS: { value: Certainty; label: string }[] = [
  { value: 'hypothetical', label: 'Hypothetical (design / assumed)' },
  { value: 'estimated', label: 'Estimated' },
  { value: 'measured', label: 'Measured (survey / record)' },
  { value: 'unknown', label: 'Unknown' },
];

const isUtilityObj = (o: CityObject): o is UtilityObject => o.type === 'utility';
const isAlignmentObj = (o: CityObject): o is UndergroundAlignmentObject => isAlignment(o);

/** Underground alignments in the active alternative (re-renders on object / alternative changes). */
export const useAlignments = () => useEngineObjects(isAlignmentObj);

function useSelectedId(): string | null {
  const [id, setId] = useState<string | null>(() => engineInstance.selection.getSelection()[0] ?? null);
  useEffect(() => engineInstance.selection.onChange?.(() => setId(engineInstance.selection.getSelection()[0] ?? null)) as (() => void) | undefined, []);
  return id;
}

/**
 * The alignment the drawer and the checks work on: the selected one if an alignment is selected, else the one chosen
 * in the panel, else the most recent one. null when the alternative has none.
 */
export function useActiveAlignment(): { alignments: UndergroundAlignmentObject[]; active: UndergroundAlignmentObject | null } {
  const alignments = useAlignments();
  const selectedId = useSelectedId();
  const activeId = useUndergroundStore(s => s.activeId);
  const selected = alignments.find(a => a.id === selectedId);
  const chosen = alignments.find(a => a.id === activeId);
  return { alignments, active: selected ?? chosen ?? alignments[alignments.length - 1] ?? null };
}

/**
 * What the Profile / Cross-section draw: a selected drawn utility (as an alignment-shaped view, utilityAsAlignment), else
 * the active alignment. `isUtility` tells the views to say "top of pipe".
 */
export function useActiveSubject(): { active: UndergroundAlignmentObject | null; isUtility: boolean } {
  const { active } = useActiveAlignment();
  const selectedId = useSelectedId();
  const utils = useEngineObjects(isUtilityObj);
  const u = utils.find(x => x.id === selectedId);
  const view = useMemo(() => (u ? utilityAsAlignment(u) : null), [u]);
  return view ? { active: view, isUtility: true } : { active, isUtility: false };
}

/** Applies an edit with Undo (history.recordUpdate + ObjectManager.update: copy-on-write in a proposal). */
export function commitAlignment(before: UndergroundAlignmentObject, after: UndergroundAlignmentObject, what: string, coalesceKey?: string) {
  engineInstance.history.recordUpdate(before, after, `${what} — ${before.name || before.id}`, coalesceKey);
  const { id: _id, type: _type, ...updates } = after;
  void _id; void _type;
  engineInstance.objects.update(before.id, updates as Partial<CityObject>);
}

export const fmtM = (v: number | null | undefined, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? 'Unknown' : `${v.toFixed(digits)} m`);
/** A depth below ground for hover text: negative = above ground (a building's roof), 0 = at ground, null = Unknown. */
export const fmtDepth = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? 'Unknown'
  : v < 0 ? `${fmtM(-v)} above ground` : v === 0 ? 'at ground' : `${fmtM(v)} below ground`);
