import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { engineInstance } from '../../engine/TwinCityEngine';
import { JUNCTION_POINT_COLORS, type JunctionPointKind } from '../../engine/rendering/renderers/TrafficNetworkVisualizer';

const LAYER = 'traffic_network_debug';
const LEGEND: { kind: JunctionPointKind; label: string }[] = [
  { kind: 't_junction', label: 'T' },
  { kind: 'x_junction', label: 'X' },
  { kind: 'complex', label: '5+' },
  { kind: 'roundabout', label: 'Roundabout' },
  { kind: 'dead_end', label: 'Dead end' },
];

/**
 * Map toggles for the Design workspace. "Junction points" shows the traffic network's junctions and dead ends
 * as points. Off by default and remembered on this device: with the whole city loaded it is thousands of points,
 * and when off none are created (docs/urbanos/DESIGN_WORKSPACE.md, Points layer).
 */
export const DesignMapToggles: React.FC = () => {
  const [on, setOn] = useState(() => engineInstance.layers.isVisible(LAYER));
  const [count, setCount] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => engineInstance.layers.onChange(() => setOn(engineInstance.layers.isVisible(LAYER))), []);
  useEffect(() => {
    if (!on) { setCount(0); setPending(false); return; }
    // The network is built in a worker; poll briefly for the point count
    const tick = () => { setCount(engineInstance.junctionPointCount()); setPending(engineInstance.junctionPointsPending()); };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [on]);

  return (
    <div className="flex flex-col gap-1.5" data-testid="design-map-toggles">
      <button type="button" role="switch" aria-checked={on} data-testid="toggle-junction-points"
        onClick={() => engineInstance.layers.setVisibility(LAYER, !on)}
        title="Junction points: show junctions, roundabouts and dead ends of the traffic network as coloured points. Off by default; with the whole city loaded it is thousands of points and slows the map."
        className="uos-row w-full text-left">
        {on && pending ? <Loader2 size={14} aria-hidden className="animate-spin text-text-2" /> : on ? <Eye size={14} aria-hidden className="text-accent" /> : <EyeOff size={14} aria-hidden className="text-text-3" />}
        <span className={`flex-1 text-label ${on ? 'text-text-1' : 'text-text-2'}`}>Junction points</span>
        <span className="text-meta text-text-3 tabular-nums">{on ? (pending ? 'building…' : count.toLocaleString()) : 'off'}</span>
      </button>
      {on && (
        <ul className="flex flex-wrap gap-x-2.5 gap-y-1 px-1 text-meta text-text-3" aria-label="Junction point colours">
          {LEGEND.map(l => (
            <li key={l.kind} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: JUNCTION_POINT_COLORS[l.kind] }} aria-hidden />{l.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
