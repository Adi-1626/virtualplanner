/**
 * Default alignment settings per object type — ONE place to change them (GEOMETRY_EDITOR_DESIGN.md §5).
 * Decided 2026-11-22 from the governing standards: docs/urbanos/PLANNING_DEFAULTS_DECISIONS.md (D1 design speeds, D3
 * superelevation, D4 no spirals). Defaults apply to NEW alignments only; a stored alignment keeps its own settings.
 */
import type { RoadClassification } from '../../objects/types';
import type { AlignmentDefaultsInput, AlignmentSettings, DefaultAlignmentSettingsFn } from './types';

export const GEOMETRY_DEFAULTS = {
  /**
   * D1: surface road design speed by class (km/h), IRC:86-2018 Table 3.1 plain terrain: highway = urban expressway 80,
   * arterial 60 (sub-arterial is also 60), collector 40, local 30.
   */
  roadDesignSpeedKmh: { highway: 80, arterial: 60, collector: 40, local: 30 } as Record<RoadClassification, number>,
  /**
   * D1: flyover / double-deck design speed by class (km/h) = the class design speed: IRC:SP:90-2023 §4.9 Table 4.3 gives
   * urban grade-separator design speeds as IRC:86-2018 Table 3.1. A different value is set per object by the user.
   */
  flyoverDesignSpeedKmh: { highway: 80, arterial: 60, collector: 40, local: 30 } as Record<RoadClassification, number>,
  /** D3: superelevation cap on surface roads: 4 %, IRC:86-2018 §8.2.1 (urban sections with frequent intersections). 7 % is the non-urban option. */
  eMaxSurface: 0.04 as const,
  /**
   * D3: superelevation used for the minimum-radius screen on flyover decks: 7 %. IRC:SP:90-2023 §4.12.2: 7 % where the
   * radius is below the desirable minimum (the case this screen tests), 5 % at or above it on urban sections, 4 % on urban
   * sections with frequent intersections (a deck has none along it). IRC:SP:90-2010 §6.13.2 also capped at 7 %.
   */
  eMaxFlyoverDeck: 0.07 as const,
  /** D4: no spirals in this phase — curves are circular; the screen reports the transition length a curve would need. */
  spiralsEnabled: false,
  /** D4: utilities, utility trunks and storm drains bend at sharp angle points only (no public Indian minimum radius found). */
  utilityBehaviour: 'angled' as const,
  /** D6: OSM-imported roads (and imported metro, records) keep their geometry locked; only properties are edited. */
  importedGeometryLocked: true,
  /** Metro: Pune Metro S–K Revised Final DPR max design speed (km/h) — project value. Radius checks use the DPR radii, not V. */
  metroDesignSpeedKmh: 90,
  /** Auto-fillet off-switch for drawing (on by default for `curved` objects). */
  autoFillet: true,
} as const;

/**
 * Criteria set for a road-like object: IRC:86-2018 urban for every class (the `highway` class in this Pune model is an
 * urban expressway, Table 3.1). The rural IRC:73 criteria stay in the engine for objects that already carry them.
 */
const roadCriteria = (_cls: RoadClassification) => 'irc86-urban' as AlignmentSettings['criteria'];

export const defaultAlignmentSettings: DefaultAlignmentSettingsFn = (input: AlignmentDefaultsInput): AlignmentSettings => {
  const D = GEOMETRY_DEFAULTS;
  const cls = input.roadClass ?? 'local';
  switch (input.type) {
    case 'road':
      return { behaviour: 'curved', designSpeedKmh: D.roadDesignSpeedKmh[cls], designSpeedSource: 'class-default', eMax: D.eMaxSurface, criteria: roadCriteria(cls) };
    case 'flyover':
    case 'metro_flyover':
      return { behaviour: 'curved', designSpeedKmh: D.flyoverDesignSpeedKmh[cls], designSpeedSource: 'class-default', eMax: D.eMaxFlyoverDeck, criteria: roadCriteria(cls) };
    case 'metro_line':
      return { behaviour: 'curved', designSpeedKmh: D.metroDesignSpeedKmh, designSpeedSource: 'class-default', eMax: D.eMaxFlyoverDeck, criteria: 'metro-pune-sk-dpr' };
    case 'underground_alignment': {
      const k = input.alignmentKind;
      if (k === 'underground_metro' || k === 'bored_tunnel')
        return { behaviour: 'curved', designSpeedKmh: D.metroDesignSpeedKmh, designSpeedSource: 'class-default', eMax: D.eMaxFlyoverDeck, criteria: 'metro-pune-sk-dpr' };
      if (k === 'cut_and_cover')
        return { behaviour: 'curved', designSpeedKmh: null, designSpeedSource: 'class-default', eMax: D.eMaxSurface, criteria: 'none' };
      return { behaviour: D.utilityBehaviour, designSpeedKmh: null, designSpeedSource: 'class-default', eMax: D.eMaxSurface, criteria: 'none' };
    }
    case 'utility':
      return { behaviour: D.utilityBehaviour, designSpeedKmh: null, designSpeedSource: 'class-default', eMax: D.eMaxSurface, criteria: 'none' };
  }
};

/**
 * The design speed an object's alignment stands for: the value the user set, or, while it is still the class default,
 * the default of the object's current class (a class changed after drawing, or before classSpeedUpdates existed, left a
 * stale class default behind: a flyover drawn as local and made arterial ran at 30 km/h, p11 user test).
 */
export function alignmentDesignSpeed(obj: { type?: string; roadClass?: RoadClassification; alignment?: { designSpeedKmh: number | null; designSpeedSource?: string } | null; osmProvenance?: unknown }): number | null {
  const a = obj.alignment;
  if (!a || typeof a.designSpeedKmh !== 'number') return a?.designSpeedKmh ?? null;
  if (a.designSpeedSource === 'user' || obj.osmProvenance || !obj.roadClass) return a.designSpeedKmh;
  if (obj.type === 'road') return GEOMETRY_DEFAULTS.roadDesignSpeedKmh[obj.roadClass] ?? a.designSpeedKmh;
  if (obj.type === 'flyover' || obj.type === 'metro_flyover') return GEOMETRY_DEFAULTS.flyoverDesignSpeedKmh[obj.roadClass] ?? a.designSpeedKmh;
  return a.designSpeedKmh;
}
