/**
 * "What would this proposal touch?" — deterministic screening indicators for the selected road / flyover / double-deck
 * (roadmap theme 7, docs/urbanos/ENVIRONMENT_WORKSPACE.md): PMC census trees and WorldCover green area inside the
 * footprint (centreline ± width/2, buffered in metres by the server) and within IMPACT_BUFFER_M of it. Counts and areas only — no scores, no
 * "significance", never an environmental impact assessment. The footprint is outlined on the map while shown.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Trees } from 'lucide-react';
import { Cartesian3, Color, ColorMaterialProperty, CustomDataSource, PolylineDashMaterialProperty, type Viewer } from 'cesium';
import { envDataApi, type LandcoverAreas } from '../../lib/envDataApi';
import { engineInstance } from '../../engine/TwinCityEngine';
import { fmtArea, greenOf, IMPACT_BUFFER_M, impactCsv, ringsOf, type ImpactArea, type ImpactResult } from './envPlanner';
import { clearTips, setTip } from './envTips';
import { downloadText } from './download';
import type { CityObject } from '../../engine/objects/types';

const FOOT = Color.fromCssColorString('#ff2fd0');
let ds: CustomDataSource | null = null;
function viewer(): Viewer | null { const v = engineInstance.getViewer() as Viewer | null; return v && !v.isDestroyed() ? v : null; }

function clearFootprint() {
  const v = viewer();
  if (ds && v) v.dataSources.remove(ds, true);
  ds = null;
  clearTips('env_overlay_impact_');
  v?.scene.requestRender();
}

function drawFootprint(rings: { ring: number[][]; label: string; dashed: boolean }[]) {
  const v = viewer();
  if (!v) return;
  clearFootprint();
  const s = new CustomDataSource('env-impact');
  rings.forEach((r, i) => {
    const id = `env_overlay_impact_${i}`;
    // drawn through buildings and above every drape (depth-fail material), so the outline is never hidden
    const mat = r.dashed ? new PolylineDashMaterialProperty({ color: FOOT, dashLength: 12 }) : new ColorMaterialProperty(FOOT);
    s.entities.add({ id, polyline: { positions: r.ring.map(p => Cartesian3.fromDegrees(p[0], p[1], 3)), width: r.dashed ? 3 : 4, material: mat, depthFailMaterial: mat } });
    setTip(id, { type: 'Screening footprint', name: r.label, detail: 'Approximate: centreline ± width/2. Used for the tree and green-area counts.', evidence: 'Modelled — drawn from the proposal geometry' });
  });
  void v.dataSources.add(s);
  ds = s;
  v.scene.requestRender();
}

async function area(geometry: unknown): Promise<ImpactArea> {
  const [t, lc] = await Promise.allSettled([envDataApi.treesInPolygon(geometry), envDataApi.landcoverAreasPolygon(geometry, 'proposal')]);
  const g = greenOf(lc.status === 'fulfilled' ? (lc.value as LandcoverAreas) : null);
  return {
    trees: t.status === 'fulfilled' ? t.value.count : null, rare: t.status === 'fulfilled' ? t.value.rare : null,
    treeError: t.status === 'rejected' ? (t.reason as Error).message : undefined,
    greenM2: g.greenM2, treeCoverM2: g.treeCoverM2, areaM2: g.areaM2, outside: g.outside,
    lcError: lc.status === 'rejected' ? (lc.reason as Error).message : undefined,
  };
}

const Cell: React.FC<{ v: string; testId?: string }> = ({ v, testId }) => <td className="text-right tabular-nums text-text-1 py-0.5" data-testid={testId}>{v}</td>;
const num = (n: number | null, err?: string) => n == null ? (err ? 'UNKNOWN' : 'UNKNOWN') : n.toLocaleString();

export const EnvImpact: React.FC<{ obj: CityObject }> = ({ obj }) => {
  const [res, setRes] = useState<ImpactResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const coords = (obj as { coordinates?: number[][] }).coordinates ?? [];
  const width = (obj as { width?: number }).width ?? 0;
  const key = `${obj.id}:${width}:${coords.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';')}`;
  // a result describes one geometry: drop it (and its outline) when the proposal or its shape changes
  useEffect(() => { seq.current++; setRes(null); setErr(null); setBusy(false); clearFootprint(); }, [key]);
  useEffect(() => () => { seq.current++; clearFootprint(); }, []);
  const run = async () => {
    const my = ++seq.current;
    const ll = coords.map(c => [c[0], c[1]]);
    if (ll.length < 2) { setErr('The proposal needs at least two points.'); return; }
    if (!(width > 0)) { setErr('The proposal has no width, so its footprint is unknown. Set a width in Design first.'); return; }
    setBusy(true); setErr(null); setRes(null);
    try {
      // footprints are buffered in metres on the server (bends and doubled-back vertices stay correct)
      const [foot, buf] = await Promise.all([envDataApi.footprint(ll, width), envDataApi.footprint(ll, width + 2 * IMPACT_BUFFER_M)]);
      const [a, b] = await Promise.all([area(foot.geometry), area(buf.geometry)]);
      if (my !== seq.current) return;
      setRes({ name: obj.name || obj.type, type: obj.type, lengthM: foot.properties.length_m, widthM: width, footprint: a, buffer: b });
      drawFootprint([...ringsOf(foot.geometry).map(ring => ({ ring, label: 'Proposal footprint', dashed: false })),
        ...ringsOf(buf.geometry).map(ring => ({ ring, label: `Footprint + ${IMPACT_BUFFER_M} m each side`, dashed: true }))]);
    } catch (e) {
      if (my === seq.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setBusy(false);
    }
  };
  const anyErr = res && (res.footprint.treeError || res.footprint.lcError);
  return (
    <div className="space-y-1.5 min-w-0 [overflow-wrap:anywhere]" data-testid="env-impact">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="uos-btn uos-btn-sm uos-btn-primary" data-testid="env-impact-run" onClick={() => void run()} disabled={busy}>
          {busy ? <Loader2 size={13} aria-hidden className="animate-spin" /> : <Trees size={13} aria-hidden />}Count trees &amp; green area
        </button>
        {res && <button type="button" className="uos-btn uos-btn-sm" data-testid="env-impact-csv" onClick={() => downloadText(`environment-screening-${(res.name || 'proposal').replace(/[^\w-]+/g, '_')}.csv`, impactCsv(res, new Date().toISOString()), 'text/csv')}><Download size={13} aria-hidden />CSV</button>}
      </div>
      {err && <p className="text-meta text-warn" role="status" data-testid="env-impact-error">{err}</p>}
      {res && (
        <div data-testid="env-impact-result">
          <p className="text-meta text-text-2">{res.name} · {Math.round(res.lengthM).toLocaleString()} m long · {res.widthM} m wide (outlined in magenta on the map: solid = footprint, dashed = with margin)</p>
          <table className="w-full text-label mt-1">
            <thead><tr className="text-meta text-text-3"><th className="text-left font-normal">Inside</th><th className="text-right font-normal">footprint</th><th className="text-right font-normal">with {IMPACT_BUFFER_M} m margin</th></tr></thead>
            <tbody>
              <tr><td className="text-text-2">Census trees</td><Cell v={num(res.footprint.trees)} testId="env-impact-trees" /><Cell v={num(res.buffer.trees)} testId="env-impact-trees-buffer" /></tr>
              <tr><td className="text-text-2">of which rare</td><Cell v={num(res.footprint.rare)} /><Cell v={num(res.buffer.rare)} /></tr>
              <tr><td className="text-text-2">Green area</td><Cell v={fmtArea(res.footprint.greenM2)} testId="env-impact-green" /><Cell v={fmtArea(res.buffer.greenM2)} /></tr>
              <tr><td className="text-text-2">Tree cover</td><Cell v={fmtArea(res.footprint.treeCoverM2)} /><Cell v={fmtArea(res.buffer.treeCoverM2)} /></tr>
            </tbody>
          </table>
          {res.footprint.outside && <p className="text-meta text-text-2" data-testid="env-impact-outside">Outside the land-cover data: green area UNKNOWN, not zero.</p>}
          {anyErr && <p className="text-meta text-warn" role="status">Part could not be computed: {[res.footprint.treeError, res.footprint.lcError].filter(Boolean).join('; ')}. Shown as UNKNOWN.</p>}
          <p className="text-meta text-text-3">Trees: PMC census 2019 (measured; felled or planted since are not reflected). Green area: tree, shrub, grass, crop and wetland classes of ESA WorldCover 2021 (inferred, 10 m pixels).
            Footprint = centreline ± width/2 (flat ends); the margin column includes the footprint. A Trees Act survey and a site visit are still required.</p>
        </div>
      )}
    </div>
  );
};
