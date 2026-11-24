import type { LegendGroup, LegendItem } from '../rendering/mapLegend';
import { LEGEND_ORDER } from '../rendering/mapLegend';
import {
  STUDY_ROLE_COLORS, STUDY_BOUNDARY_COLORS, STUDY_GRADE_SEPARATION_COLOR, STUDY_JUNCTION_COLORS, STUDY_PROBLEM_COLORS, SELECT_LINK_COLORS, STUDY_EMPTY_COLOR,
} from '../rendering/renderers/StudyAreaVisualizer';
import { SPEED_COLORS } from '../rendering/renderers/MicroTrafficVisualizer';
import { VC_BANDS } from './RoadAnalysis';
import { DIRECTION_COLORS } from './directions';
import type { StudyArea } from './StudyAreaExplorer';
import type { MapOverlay } from './SimulationMode';

/**
 * Map key groups for Simulate (docs/urbanos/SIM_FLOW_P12.md §8), from the same colour constants the map uses. Only what
 * is drawn now: the study area's markers that exist in it, the overlay on show, the live view while it runs.
 */
type G = Omit<LegendGroup, 'id'>;

/** Colours the comparison overlay uses (SimulationMode.redrawOverlay). */
export const COMPARISON_COLORS = { better: '#34d399', worse: '#f43f5e' } as const;
/** The cause overlay: the studied road, the traced queue. */
export const CAUSE_COLORS = { section: '#67e8f9', queue: '#f43f5e' } as const;
/** Ranked bottleneck and new-bottleneck markers. */
export const BOTTLENECK_COLOR = '#f43f5e';

export function studyLegend(area: Pick<StudyArea, 'junctions' | 'boundary' | 'gradeSeparations' | 'problems' | 'segments'>, o: { live: boolean; overlay: MapOverlay }): G {
  const items: LegendItem[] = [
    { id: 'seed', label: 'The road you are studying', detail: 'pulsing glow', swatch: { kind: 'glow', color: STUDY_ROLE_COLORS.seed } },
  ];
  // The role colours only show when neither the live speeds nor an overlay recolour the stretches
  if (!o.live && o.overlay === 'none') {
    const roles = new Set(area.segments.map(s => s.role));
    if (roles.has('downstream')) items.push({ id: 'downstream', label: 'Roads its traffic goes on to', detail: 'downstream of the studied road', swatch: { kind: 'line', color: STUDY_ROLE_COLORS.downstream } });
    if (roles.has('upstream')) items.push({ id: 'upstream', label: 'Roads its traffic comes from', detail: 'upstream of the studied road', swatch: { kind: 'line', color: STUDY_ROLE_COLORS.upstream } });
    if (roles.has('both')) items.push({ id: 'both', label: 'Roads both before and after it', detail: 'reached both ways from the studied road', swatch: { kind: 'line', color: STUDY_ROLE_COLORS.both } });
  }
  const kinds = new Set(area.junctions.map(j => j.kind));
  if ([...kinds].some(k => k !== 'dead_end' && k !== 'roundabout')) items.push({ id: 'junction', label: 'Junction', detail: 'larger dot = more roads meet; shown when zoomed in', swatch: { kind: 'dot', color: STUDY_JUNCTION_COLORS.junction, color2: '#0f172a' } });
  if (kinds.has('roundabout')) items.push({ id: 'roundabout', label: 'Roundabout', swatch: { kind: 'dot', color: STUDY_JUNCTION_COLORS.roundabout, color2: '#0f172a' } });
  if (kinds.has('dead_end')) items.push({ id: 'dead_end', label: 'Dead end', swatch: { kind: 'dot', color: STUDY_JUNCTION_COLORS.dead_end, color2: '#0f172a' } });
  const b = new Set(area.boundary.map(x => x.kind));
  if (b.has('entry')) items.push({ id: 'in', label: 'Traffic enters the area', detail: 'IN ×n: n entry points within 150 m', swatch: { kind: 'label', color: STUDY_BOUNDARY_COLORS.entry, text: 'IN' } });
  if (b.has('exit')) items.push({ id: 'out', label: 'Traffic leaves the area', detail: 'OUT ×n: n exit points within 150 m', swatch: { kind: 'label', color: STUDY_BOUNDARY_COLORS.exit, text: 'OUT' } });
  if (b.has('entry_exit') || (b.has('entry') && b.has('exit'))) items.push({ id: 'inout', label: 'Traffic enters and leaves', detail: 'two-way road at the edge, or entries and exits close together', swatch: { kind: 'label', color: STUDY_BOUNDARY_COLORS.entry_exit, text: 'IN/OUT' } });
  if (area.gradeSeparations.length) items.push({ id: 'grade', label: 'Roads cross without meeting', detail: 'a flyover or bridge over another road: no turns between them', swatch: { kind: 'ring', color: STUDY_GRADE_SEPARATION_COLOR } });
  const shown = area.problems.filter(p => p.severity !== 'info' || p.kind === 'area_edge');
  if (shown.some(p => p.kind !== 'area_edge' && p.severity === 'error')) items.push({ id: 'p-error', label: 'Network error', detail: 'e.g. a one-way trap; see Details → network checks', swatch: { kind: 'dot', color: STUDY_PROBLEM_COLORS.error, color2: '#ffffff' } });
  if (shown.some(p => p.kind !== 'area_edge' && p.severity === 'warning')) items.push({ id: 'p-warn', label: 'Network warning', detail: 'e.g. two roads that almost meet', swatch: { kind: 'dot', color: STUDY_PROBLEM_COLORS.warning, color2: '#ffffff' } });
  if (shown.some(p => p.kind === 'area_edge')) items.push({ id: 'p-edge', label: 'Road cut at the edge of the mapped area', swatch: { kind: 'dot', color: STUDY_PROBLEM_COLORS.area_edge, color2: '#ffffff' } });
  return { title: 'Study area', items, order: LEGEND_ORDER.simStudy, note: 'Hover or tap a marker on the map to see what it is.' };
}

/** The live view: stretches by speed, the vehicles, the signal heads. */
export function liveLegend(o: { signals: boolean }): G {
  const items: LegendItem[] = [
    { id: 'free', label: 'Moving freely', detail: '60% or more of the speed limit', swatch: { kind: 'line', color: SPEED_COLORS.free } },
    { id: 'slow', label: 'Slow', detail: '25–60% of the speed limit', swatch: { kind: 'line', color: SPEED_COLORS.slow } },
    { id: 'stopped', label: 'Stop-and-go', detail: 'under 25% of the speed limit', swatch: { kind: 'line', color: SPEED_COLORS.stopped } },
    { id: 'empty', label: 'No vehicles now', swatch: { kind: 'line', color: STUDY_EMPTY_COLOR } },
    { id: 'vehicles', label: 'Simulated vehicles', detail: 'cars, two-wheelers, autos, buses and trucks as 3D models nearby; light dots further away', swatch: { kind: 'dot', color: '#e2e8f0' } },
  ];
  if (o.signals) items.push({ id: 'signals', label: 'Traffic signal heads', detail: 'red, amber and green as simulated (timings modelled, not measured)', swatch: { kind: 'dot', color: '#ef4444', color2: '#22c55e' } });
  return { title: 'Live traffic (simulated)', items, evidence: 'modelled', order: LEGEND_ORDER.simLive, note: 'Speed lines show from 900 m away; up close the vehicles show the traffic.' };
}

/** The overlay chosen in the panel (one at a time). */
export function overlayLegend(kind: MapOverlay, o: { hasRootMarker?: boolean; bottlenecks?: number; newBottlenecks?: number } = {}): G | null {
  if (kind === 'none') return null;
  if (kind === 'select-link') return {
    title: 'Where its traffic comes from and goes', order: LEGEND_ORDER.simOverlay, evidence: 'modelled',
    items: [{ id: 'none', label: 'None of its traffic', swatch: { kind: 'line', color: STUDY_EMPTY_COLOR } }],
    scale: { unit: 'share of the studied road\'s traffic on each stretch (routed, veh/h)', steps: [{ color: SELECT_LINK_COLORS[0], label: 'little' }, { color: SELECT_LINK_COLORS[1], label: 'most' }] },
  };
  if (kind === 'area-vc') return {
    title: 'How full each road is', order: LEGEND_ORDER.simOverlay, evidence: 'modelled',
    items: [
      { id: 'faint', label: 'Faint: under 30% full', swatch: { kind: 'line', color: VC_BANDS[0].css } },
      ...(o.bottlenecks ? [{ id: 'bn', label: 'Worst stretches, numbered 1–5', detail: 'ranked by the extra vehicle-hours they cause', swatch: { kind: 'dot' as const, color: BOTTLENECK_COLOR, color2: '#ffffff' } }] : []),
    ],
    scale: { unit: 'routed volume ÷ capacity (IRC:106), %', steps: VC_BANDS.map(b => ({ color: b.css, label: b.label })) },
  };
  if (kind === 'cause') return {
    title: 'Why it is slow', order: LEGEND_ORDER.simOverlay, evidence: 'modelled',
    items: [
      { id: 'section', label: 'The road you are studying', swatch: { kind: 'line', color: CAUSE_COLORS.section } },
      { id: 'queue', label: 'The queue traced back from it', detail: 'stretches where its vehicles stood behind a full road', swatch: { kind: 'line', color: CAUSE_COLORS.queue } },
      ...(o.hasRootMarker ? [{ id: 'root', label: 'Queue starts here', detail: 'the junction holding the first vehicle of the queue', swatch: { kind: 'dot' as const, color: CAUSE_COLORS.queue, color2: '#ffffff' } }] : []),
    ],
  };
  // comparison
  return {
    title: 'Proposal against the existing city', order: LEGEND_ORDER.simOverlay, evidence: 'modelled',
    items: [
      { id: 'better', label: 'Less loaded in the proposal', detail: 'load fell by 5 points of capacity or more', swatch: { kind: 'line', color: COMPARISON_COLORS.better } },
      { id: 'worse', label: 'More loaded in the proposal', detail: 'load rose by 5 points of capacity or more', swatch: { kind: 'line', color: COMPARISON_COLORS.worse } },
      { id: 'same', label: 'Little or no change', detail: 'under 5 points either way (dimmed)', swatch: { kind: 'line', color: STUDY_EMPTY_COLOR } },
      ...(o.newBottlenecks ? [{ id: 'new-bn', label: 'New bottleneck', detail: 'over capacity in the proposal, not before', swatch: { kind: 'dot' as const, color: BOTTLENECK_COLOR, color2: '#ffffff' } }] : []),
    ],
    note: 'Stronger colour = bigger change. Same trips, hour and seeds on both sides.',
  };
}

/** The studied road's directions, as the arrows and the panel colour them. */
export function directionsLegend(labels: readonly string[]): G | null {
  if (!labels.length) return null;
  return {
    title: 'Directions of the studied road', order: LEGEND_ORDER.simDirections,
    items: labels.map((l, i) => ({ id: `dir-${i}`, label: l.charAt(0).toUpperCase() + l.slice(1), detail: 'arrow on the map, same colour in the panel', swatch: { kind: 'arrow', color: DIRECTION_COLORS[i % DIRECTION_COLORS.length] } })),
  };
}
