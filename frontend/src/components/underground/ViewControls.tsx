import React, { useEffect, useState } from 'react';
import { ArrowUpToLine, Eye } from 'lucide-react';
import { Cartesian3, Math as CMath } from 'cesium';
import { undergroundView } from '../../engine/underground/UndergroundView';
import type { UndergroundAlignmentObject, UtilityObject } from '../../engine/objects/types';
import { alignmentsRect } from '../../engine/underground/viewRect';
import { engineInstance } from '../../engine/TwinCityEngine';
import { groundAt } from '../../engine/terrain/groundHeight';
import { useUndergroundStore } from './undergroundStore';
import { sceneGroundLabel } from '../../engine/underground/groundModels';

type Box = [number, number, number, number];

/** Camera height above (+) / below (−) the scene ground, refreshed when the camera moves (throttled). */
function useCameraDepth(): number | null {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const v = engineInstance.getViewer?.();
    if (!v) return;
    let last = 0;
    const read = () => {
      const now = performance.now();
      if (now - last < 150) return;
      last = now;
      const c = v.camera.positionCartographic;
      setH(c.height - groundAt(CMath.toDegrees(c.longitude), CMath.toDegrees(c.latitude)));
    };
    read();
    v.camera.percentageChanged = 0.01;
    const off1 = v.camera.changed.addEventListener(read);
    const off2 = v.camera.moveEnd.addEventListener(() => { last = 0; read(); });
    return () => { off1(); off2(); };
  }, []);
  return h;
}

const centreOf = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/** Camera `backM` south of the point, `h` m above (−: below) its ground. Below ground the camera is set directly:
 * Cesium's flight path does not end below the surface. */
function flyTo(lon: number, lat: number, h: number, pitchDeg: number, backM: number) {
  const v = engineInstance.getViewer?.();
  if (!v) return;
  const dLat = backM / 110574;
  const destination = Cartesian3.fromDegrees(lon, lat - dLat, h + groundAt(lon, lat - dLat));
  const orientation = { heading: 0, pitch: CMath.toRadians(pitchDeg), roll: 0 };
  if (h < 0) { v.camera.setView({ destination, orientation }); v.scene.requestRender(); return; }
  v.camera.flyTo({ destination, orientation, duration: 1.2 });
}

/**
 * Cutaway controls (research Top-12 #9): ground see-through limited to the work area by default (surface context kept
 * everywhere else), X-ray, a camera depth readout, "look from below" and "back to surface".
 */
export const ViewControls: React.FC<{ alignments: UndergroundAlignmentObject[]; utilities?: UtilityObject[] }> = ({ alignments, utilities = [] }) => {
  const [s, setS] = useState(undergroundView.getSettings());
  const [active, setActive] = useState(undergroundView.isActive());
  const [everywhere, setEverywhere] = useState(false);
  useEffect(() => undergroundView.onChange(() => { setS(undergroundView.getSettings()); setActive(undergroundView.isActive()); }), []);
  const recordsArea = useUndergroundStore(st => st.recordsArea);
  // Proposed alignments AND utilities are inside the see-through area (a pipe outside it was hidden under opaque ground)
  const area: Box | null = alignmentsRect([...alignments, ...utilities]) ?? recordsArea;
  const areaKey = area?.map(v => v.toFixed(5)).join(',') ?? '';
  // The see-through ground follows the work area (alignments, else the area the records are listed for)
  useEffect(() => { if (active) undergroundView.update({ rectangleDeg: everywhere ? null : area }); }, [everywhere, areaKey, active]); // eslint-disable-line react-hooks/exhaustive-deps
  const camH = useCameraDepth();
  const ground = sceneGroundLabel();
  const below = camH !== null && camH < 0;
  const pct = Math.round(s.groundOpacity * 100);
  const centre = area ? centreOf(area) : null;
  return (
    <div className="flex flex-col gap-2" data-testid="ug-view-controls">
      <label className="flex items-center gap-3 text-label text-text-2">
        <span className="w-24 shrink-0">Ground opacity</span>
        <input type="range" min={0} max={100} step={5} value={pct} className="flex-1" data-testid="ug-ground-opacity" aria-label="Ground opacity (%)"
          onChange={e => undergroundView.update({ groundOpacity: Number(e.target.value) / 100 })} disabled={!active} />
        <span className="w-10 text-right tabular-nums text-text-1" data-testid="ug-ground-opacity-value">{pct}%</span>
      </label>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className="flex items-center gap-2 text-label text-text-2 min-h-8" title="Buried objects drawn through the ground everywhere">
          <input type="checkbox" checked={s.xray} data-testid="ug-xray" onChange={e => undergroundView.update({ xray: e.target.checked })} disabled={!active} /> X-ray
        </label>
        <label className="flex items-center gap-2 text-label text-text-2 min-h-8" title={area ? 'Off = only the work area is see-through; the rest of the city stays solid' : 'No work area yet: the whole ground is see-through'}>
          <input type="checkbox" checked={everywhere || !area} data-testid="ug-see-through-everywhere" disabled={!active || !area}
            onChange={e => setEverywhere(e.target.checked)} /> See-through everywhere
        </label>
      </div>
      <p className="text-meta text-text-2" data-testid="ug-view-area">
        {!active ? 'Map not ready.' : area && !everywhere ? `Ground is see-through only around ${alignments.length || utilities.length ? 'your drawn objects' : 'the listed records'} (${pct}% opaque); the surface stays aligned above.` : 'Ground is see-through everywhere.'}
      </p>
      <p className="text-meta text-text-3" data-testid="ug-ground-3d" title={ground.long}>{ground.short} · Profile: DSM ground. Same depth below ground at every point in both; only the ground shape differs.</p>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-label tabular-nums ${below ? 'text-warn' : 'text-text-2'}`} data-testid="ug-camera-depth">
          {camH === null ? 'Camera height —' : below ? `Camera ${Math.abs(camH).toFixed(0)} m below ground` : `Camera ${camH >= 1000 ? `${(camH / 1000).toFixed(1)} km` : `${camH.toFixed(0)} m`} above ground`}
        </span>
        <span className="flex-1" />
        <button type="button" className="uos-btn uos-btn-sm" disabled={!active || !centre} data-testid="ug-look-below"
          title="Put the camera 8 m below ground, looking along the work area"
          onClick={() => centre && flyTo(centre[0], centre[1], -8, -4, 260)}><Eye size={12} aria-hidden /> Look from below</button>
        <button type="button" className={`uos-btn uos-btn-sm ${below ? 'uos-btn-primary' : ''}`} disabled={!active} data-testid="ug-back-to-surface"
          onClick={() => {
            const v = engineInstance.getViewer?.();
            const c = v?.camera.positionCartographic;
            const [lon, lat] = centre ?? (c ? [CMath.toDegrees(c.longitude), CMath.toDegrees(c.latitude)] : [0, 0]);
            flyTo(lon, lat, 420, -38, 520);
          }}><ArrowUpToLine size={12} aria-hidden /> Back to surface</button>
      </div>
    </div>
  );
};
