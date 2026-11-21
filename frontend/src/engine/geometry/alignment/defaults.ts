/**
 * Default alignment settings per object type — ONE place to change them (GEOMETRY_EDITOR_DESIGN.md §5, decisions D1–D4, D6).
 * These are the proposed defaults; the user has NOT confirmed them yet (2026-11-21).
 */
import type { RoadClassification } from '../../objects/types';
import type { AlignmentDefaultsInput, AlignmentSettings, DefaultAlignmentSettingsFn } from './types';

export const GEOMETRY_DEFAULTS = {
  /** D1: surface road design speed by class (km/h): IRC:86-1983 Table 1 urban arterial 80 / collector 50 / local 30; highway 80. */
  roadDesignSpeedKmh: { highway: 80, arterial: 80, collector: 50, local: 30 } as Record<RoadClassification, number>,
  /** D1: flyover / double-deck design speed by class (km/h) — the app's existing ROAD_CLASS_DEFAULTS.flyoverSpeed. */
  flyoverDesignSpeedKmh: { highway: 100, arterial: 80, collector: 60, local: 40 } as Record<RoadClassification, number>,
  /** D2: superelevation cap used by the screen on surface roads (IRC:86 §10.2.1 "desirably 4 %" on urban sections). */
  eMaxSurface: 0.04 as const,
  /** D2: superelevation cap on flyover decks (IRC:SP:90-2010 §6.13.2, 7 %). */
  eMaxFlyoverDeck: 0.07 as const,
  /** D3: no spirals in phase 1 — curves are circular; the screen only reports the transition length a curve would need. */
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

/** Criteria set for a road-like object of this class: highway → IRC:73 formula, else IRC:86 urban. */
const roadCriteria = (cls: RoadClassification) => (cls === 'highway' ? 'irc73-rural' : 'irc86-urban') as AlignmentSettings['criteria'];

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
