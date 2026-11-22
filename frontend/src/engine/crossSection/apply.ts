/**
 * Cross-section templates ↔ the road section model (docs/urbanos/CROSS_SECTIONS.md).
 *
 * A template is stored on a road as its section profile (carriageways A/B, roadsides, median: what the renderer, the
 * traffic model and the feasibility screen already read) plus `section.crossSection`, the template's own element list
 * and source, so the diagram and the checks can show the strips by the source's names. When a later edit changes the
 * profile so it no longer matches the stored elements, the elements are derived from the profile again
 * (`templateEdited`).
 *
 * Mapping of a template strip to the roadside fields: clear walkway → footpathWidth; tree pits / furniture / MUZ and
 * buffer → vergeWidth; cycle track → cycleTrackWidth; parking (incl. mixed bus-stop / parking strips) → parkingWidth.
 */
import type { CarriagewayProfile, RoadObject, RoadSectionProfile, RoadsideProfile } from '../objects/types';
import { normalizeRoadSections } from '../objects/roadSections';
import { elementsTotalM, type CrossSectionTemplate, type SourceRef, type XsElement } from './templates';

export interface AppliedCrossSection {
  templateId: string;
  code: string;
  rowM: number;
  elements: XsElement[];
  source: SourceRef;
  appliedAt: string;
  /** The cross-section the road had just before this template replaced it (for the before/after diagram). */
  replaced?: XsElement[];
}

export type SectionWithTemplate = RoadSectionProfile & { crossSection?: AppliedCrossSection };

const emptySide = (): RoadsideProfile => ({ footpathWidth: 0, cycleTrackWidth: 0, vergeWidth: 0, parkingWidth: 0, drainageWidth: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;

function sideOf(els: readonly XsElement[]): RoadsideProfile {
  const s = emptySide();
  for (const e of els) {
    if (e.kind === 'footpath') s.footpathWidth += e.widthM;
    else if (e.kind === 'cycle_track') s.cycleTrackWidth += e.widthM;
    else if (e.kind === 'parking') s.parkingWidth += e.widthM;
    else if (e.kind === 'furniture' || e.kind === 'buffer') s.vergeWidth += e.widthM;
  }
  return { footpathWidth: r2(s.footpathWidth), cycleTrackWidth: r2(s.cycleTrackWidth), vergeWidth: r2(s.vergeWidth), parkingWidth: r2(s.parkingWidth), drainageWidth: 0 };
}

/** Lanes of an undivided two-way carriageway split between the directions (as synthesizeDefaultSections does). */
const splitLanes = (n: number) => { const b = Math.floor(n / 2); return b === 0 && n > 1 ? [n - 1, 1] : [n - b, b]; };

/** The section profile a template gives, covering vertices [start, end]. */
export function templateSection(t: CrossSectionTemplate, startNodeIndex: number, endNodeIndex: number,
  provenance: RoadSectionProfile['provenance'], replaced?: XsElement[]): SectionWithTemplate {
  const cwIdx = t.elements.map((e, i) => (e.kind === 'carriageway' ? i : -1)).filter(i => i >= 0);
  if (cwIdx.length === 0) throw new Error(`Template ${t.code} has no carriageway`);
  const first = cwIdx[0], last = cwIdx[cwIdx.length - 1];
  const left = sideOf(t.elements.slice(0, first));
  const right = sideOf(t.elements.slice(last + 1));
  const medianW = r2(t.elements.slice(first + 1, last).filter(e => e.kind === 'median').reduce((n, e) => n + e.widthM, 0));
  let carriagewayA: CarriagewayProfile, carriagewayB: CarriagewayProfile | undefined;
  if (cwIdx.length >= 2) {
    const a = t.elements[first], b = t.elements[last];
    carriagewayA = { direction: 'forward', lanes: a.lanes ?? 1, laneWidth: r2(a.widthM / (a.lanes ?? 1)), leftRoadside: left, rightRoadside: emptySide() };
    carriagewayB = { direction: 'backward', lanes: b.lanes ?? 1, laneWidth: r2(b.widthM / (b.lanes ?? 1)), leftRoadside: emptySide(), rightRoadside: right };
  } else {
    const c = t.elements[first];
    const lanes = c.lanes ?? 2;
    const lw = r2(c.widthM / lanes);
    if (c.direction === 'both' && lanes > 1) {
      const [la, lb] = splitLanes(lanes);
      carriagewayA = { direction: 'both', lanes: la, laneWidth: lw, leftRoadside: left, rightRoadside: emptySide() };
      carriagewayB = { direction: 'backward', lanes: lb, laneWidth: lw, leftRoadside: emptySide(), rightRoadside: right };
    } else {
      carriagewayA = { direction: c.direction === 'backward' ? 'backward' : 'forward', lanes, laneWidth: lw, leftRoadside: left, rightRoadside: right };
    }
  }
  return {
    startNodeIndex, endNodeIndex,
    totalRowWidth: t.rowM,
    wideningPossible: false,
    hasMedian: medianW > 0,
    medianWidth: medianW,
    carriagewayA, carriagewayB,
    reservedSpaces: [],
    provenance,
    crossSection: { templateId: t.id, code: t.code, rowM: t.rowM, elements: t.elements.map(e => ({ ...e })), source: t.source, appliedAt: new Date().toISOString(), ...(replaced ? { replaced } : {}) },
  };
}

const sideElements = (s: RoadsideProfile | undefined, outerFirst: boolean): XsElement[] => {
  if (!s) return [];
  const els: XsElement[] = [];
  if (s.footpathWidth > 0) els.push({ kind: 'footpath', widthM: s.footpathWidth, label: 'Footpath' });
  if (s.vergeWidth > 0) els.push({ kind: 'furniture', widthM: s.vergeWidth, label: 'Verge / furniture' });
  if (s.cycleTrackWidth > 0) els.push({ kind: 'cycle_track', widthM: s.cycleTrackWidth, label: 'Cycle track' });
  if (s.parkingWidth > 0) els.push({ kind: 'parking', widthM: s.parkingWidth, label: 'Parking' });
  if (s.drainageWidth > 0) els.push({ kind: 'furniture', widthM: s.drainageWidth, label: 'Drainage' });
  return outerFirst ? els : els.reverse();
};

/** Elements of a section profile, left edge → right edge (strip order inside a roadside is schematic). */
export function profileElements(sec: RoadSectionProfile): XsElement[] {
  const A = sec.carriagewayA, B = sec.carriagewayB;
  const out: XsElement[] = [...sideElements(A.leftRoadside, true)];
  const cwEl = (c: CarriagewayProfile): XsElement => ({ kind: 'carriageway', widthM: r2(c.lanes * c.laneWidth), lanes: c.lanes, direction: c.direction, label: `Carriageway, ${c.lanes} lane${c.lanes === 1 ? '' : 's'}` });
  if (B && B.lanes > 0) {
    if (!sec.hasMedian && A.direction === 'both') {
      // An undivided two-way road is stored as two carriageways with no median: one carriageway on the ground
      out.push(...sideElements(A.rightRoadside, false));
      out.push({ kind: 'carriageway', widthM: r2(A.lanes * A.laneWidth + B.lanes * B.laneWidth), lanes: A.lanes + B.lanes, direction: 'both', label: `Carriageway, ${A.lanes + B.lanes} lanes` });
      out.push(...sideElements(B.leftRoadside, true));
    } else {
      out.push(cwEl(A), ...sideElements(A.rightRoadside, false));
      if (sec.hasMedian && sec.medianWidth > 0) out.push({ kind: 'median', widthM: sec.medianWidth, label: 'Median' });
      out.push(...sideElements(B.leftRoadside, true), cwEl(B));
    }
    out.push(...sideElements(B.rightRoadside, false));
  } else {
    out.push(cwEl(A), ...sideElements(A.rightRoadside, false));
  }
  return out;
}

const sameW = (a: number, b: number) => Math.abs(a - b) < 0.011;

/** Whether the section profile is still what its stored template gave (else a later edit changed it). */
export function templateStillMatches(sec: SectionWithTemplate): boolean {
  const xs = sec.crossSection;
  if (!xs) return false;
  const t = { id: xs.templateId, code: xs.code, rowM: xs.rowM, elements: xs.elements } as CrossSectionTemplate;
  let fresh: SectionWithTemplate;
  try { fresh = templateSection(t, 0, 1, sec.provenance); } catch { return false; }
  const sides = (s: RoadSectionProfile) => [s.carriagewayA.leftRoadside, s.carriagewayA.rightRoadside, s.carriagewayB?.leftRoadside, s.carriagewayB?.rightRoadside];
  const lanes = (s: RoadSectionProfile) => [s.carriagewayA.lanes, s.carriagewayA.laneWidth, s.carriagewayB?.lanes ?? 0, s.carriagewayB?.laneWidth ?? 0];
  const sa = sides(sec), sb = sides(fresh);
  for (let i = 0; i < 4; i++) {
    const x = sa[i], y = sb[i];
    if (!x !== !y) {
      const z = x ?? y!;
      if (z.footpathWidth || z.cycleTrackWidth || z.vergeWidth || z.parkingWidth || z.drainageWidth) return false;
      continue;
    }
    if (x && y && !(sameW(x.footpathWidth, y.footpathWidth) && sameW(x.cycleTrackWidth, y.cycleTrackWidth) && sameW(x.vergeWidth, y.vergeWidth) && sameW(x.parkingWidth, y.parkingWidth) && sameW(x.drainageWidth || 0, y.drainageWidth || 0))) return false;
  }
  const la = lanes(sec), lb = lanes(fresh);
  if (la.some((v, i) => !sameW(v, lb[i]))) return false;
  return sec.hasMedian === fresh.hasMedian && sameW(sec.medianWidth || 0, fresh.medianWidth || 0);
}

export interface SectionView {
  elements: XsElement[];
  totalM: number;
  /** The stored template, when the profile still matches it. */
  template?: AppliedCrossSection;
  /** A template was applied but the profile was edited afterwards. */
  templateEdited: boolean;
}

/** What the diagram and the checks read for a section. */
export function sectionView(sec: SectionWithTemplate): SectionView {
  if (sec.crossSection && templateStillMatches(sec)) return { elements: sec.crossSection.elements, totalM: elementsTotalM(sec.crossSection.elements), template: sec.crossSection, templateEdited: false };
  const elements = profileElements(sec);
  return { elements, totalM: elementsTotalM(elements), templateEdited: !!sec.crossSection };
}

/** The road's legacy top-level fields as a template gives them (ObjectManager.syncRoadProperties recomputes the same). */
function legacyFields(sec: RoadSectionProfile): Partial<RoadObject> {
  const A = sec.carriagewayA, B = sec.carriagewayB;
  const laneCount = A.lanes + (B?.lanes ?? 0);
  const left = A.leftRoadside.footpathWidth || 0;
  const right = B ? (B.rightRoadside.footpathWidth || 0) : (A.rightRoadside.footpathWidth || 0);
  return {
    laneCount, laneWidth: A.laneWidth, isOneWay: !B || B.lanes === 0,
    hasDivider: sec.hasMedian, dividerWidth: sec.hasMedian ? sec.medianWidth : 0,
    hasFootpath: left > 0 || right > 0, footpathWidth: Math.max(left, right),
    width: r2(A.lanes * A.laneWidth + (B ? B.lanes * B.laneWidth : 0) + (sec.hasMedian ? sec.medianWidth : 0) + left + right),
    trafficCapacity: laneCount * 1000,
  };
}

/**
 * The changes applying a template makes to a road: ONE section over the whole line (normalizeRoadSections, the same
 * coverage rule the geometry commit uses) and the derived legacy fields. The plan geometry is not changed, so crossings
 * and junction joins stay as they are. Provenance keeps the original source and marks the profile as edited by hand.
 */
export function templateRoadUpdates(road: RoadObject, t: CrossSectionTemplate, opts: { syncedSections?: RoadSectionProfile[] } = {}): Partial<RoadObject> {
  const existing = opts.syncedSections ?? road.sections ?? [];
  const prior = existing[0] as SectionWithTemplate | undefined;
  const replaced = prior ? sectionView(prior).elements : undefined;
  const was = prior?.provenance ?? { originalSource: road.osmProvenance ? 'OSM' : 'manual', originalConfidence: 'estimated', geometryModified: false, verificationStatus: 'unverified' } as RoadSectionProfile['provenance'];
  const provenance: RoadSectionProfile['provenance'] = { ...was, profileModified: true, lastModifiedBy: 'manual' };
  const last = Math.max(0, road.coordinates.length - 1);
  const sec = templateSection(t, 0, last, provenance, replaced);
  const sections = normalizeRoadSections([sec], road.coordinates.length);
  // A drawn flyover's ramp share of this road's capacity is kept (ObjectManager.syncRoadProperties does the same)
  const legacy = legacyFields(sec);
  const cut = road.flyoverImpact?.capacityReductionPercent ?? 0;
  if (cut > 0 && legacy.laneCount) legacy.trafficCapacity = Math.round(legacy.laneCount * 1000 * (1 - cut / 100));
  return { sections, ...legacy };
}

/** Why a template cannot be applied to this road here, or null. OSM baseline objects are never edited. */
export function upgradeBlockReason(road: RoadObject, ctx: { activeScenarioId: string; baseScenarioId: string }): string | null {
  if (road.type !== 'road') return 'Only roads take a street cross-section template.';
  if (road.coordinates.length < 2) return 'The road has no line.';
  const owner = road.scenarioId ?? ctx.baseScenarioId;
  if (road.osmProvenance && ctx.activeScenarioId === ctx.baseScenarioId && owner === ctx.baseScenarioId)
    return 'Imported from OpenStreetMap: the baseline copy is never edited. Open or create a proposal (alternative) and apply the template there; it is saved as the proposal\'s copy of this road.';
  return null;
}

/** What a template commit needs of the object store and the undo history (ObjectManager, HistoryManager). */
export interface TemplateCommitStore {
  update(id: string, updates: Partial<RoadObject>): void;
  getActiveScenarioId(): string;
}
export interface TemplateCommitHistory {
  recordUpdate(before: any, after: any, description?: string, coalesceKey?: string): void;
}

/**
 * Applies a template to a road as ONE Undo step (no coalescing). In a proposal, an OSM baseline road is copied on write
 * into the proposal's change set by ObjectManager.update; the baseline row is not touched.
 */
export function commitCrossSectionTemplate(objects: TemplateCommitStore, history: TemplateCommitHistory, road: RoadObject, t: CrossSectionTemplate,
  baseScenarioId: string): { ok: true; road: RoadObject } | { ok: false; reason: string } {
  const reason = upgradeBlockReason(road, { activeScenarioId: objects.getActiveScenarioId(), baseScenarioId });
  if (reason) return { ok: false, reason };
  const updates = templateRoadUpdates(road, t);
  const after = { ...road, ...updates } as RoadObject;
  history.recordUpdate(road, after, `Apply cross-section ${t.code} to ${road.name || road.id}`);
  objects.update(road.id, updates);
  return { ok: true, road: after };
}
