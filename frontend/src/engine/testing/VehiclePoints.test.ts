import { describe, it, expect, vi, afterEach } from 'vitest';
import { Cartesian3, Matrix4, Model, PointPrimitiveCollection, type Viewer } from 'cesium';
import { MicroTrafficVisualizer } from '../rendering/renderers/MicroTrafficVisualizer';
import type { VehicleView } from '../simulation/TrafficMicroSim';
import type { VehicleSource } from '../simulation/liveTrafficRun';

// The real Cesium classes (the suite's setup mocks 'cesium' without Model or a working point collection)
vi.mock('cesium', async importOriginal => await importOriginal());

/**
 * Vehicles beyond the 3D-model cap (600 nearest the camera) used to vanish from the map. They are now drawn as
 * points, all in one batched PointPrimitiveCollection (docs/urbanos/SIMULATE_AUDIT.md, Fixes).
 */

const fakeViewer = () => {
  const added: unknown[] = [];
  const viewer = {
    isDestroyed: () => false,
    camera: { positionWC: Cartesian3.fromDegrees(73.8, 18.5, 500) },
    scene: { primitives: { add: (p: unknown) => { added.push(p); return p; }, remove: (p: unknown) => { const i = added.indexOf(p); if (i >= 0) added.splice(i, 1); return true; } } },
  };
  return { viewer: viewer as unknown as Viewer, added };
};

const source = (n: number, opacity = 1): VehicleSource => ({
  forEachVehicle(visit: (v: Readonly<VehicleView>) => void) {
    for (let i = 0; i < n; i++) visit({ id: i, kind: 'car', lng: 73.8 + i * 1e-5, lat: 18.5, z: 0, heading: 0, pitch: 0, speedKmh: 30, speedRatio: 0.6, opacity, focus: false });
  },
  forEachSignal() {},
});

afterEach(() => vi.restoreAllMocks());

describe('vehicles beyond the model cap', () => {
  it('600 nearest get models; the rest are points in one collection; points are reused and hidden, and cleared with the drawing', async () => {
    vi.spyOn(Model, 'fromGltfAsync').mockImplementation(async () => ({ show: false, modelMatrix: new Matrix4(), color: undefined, destroy() {} }) as unknown as Model);
    const { viewer, added } = fakeViewer();
    const viz = new MicroTrafficVisualizer();
    viz.setViewer(viewer);
    viz.draw(source(700));
    await new Promise(r => setTimeout(r, 0));
    viz.draw(source(700));
    expect(viz.lastDraw).toEqual({ models: 600, points: 100 });
    const collections = added.filter(p => p instanceof PointPrimitiveCollection) as PointPrimitiveCollection[];
    expect(collections).toHaveLength(1);
    const pc = collections[0];
    const shown = () => { let k = 0; for (let i = 0; i < pc.length; i++) if (pc.get(i).show) k++; return k; };
    expect(shown()).toBe(100);
    // Fewer vehicles: the spare points are hidden, not removed or re-created
    const before = pc.length;
    viz.draw(source(650));
    expect(viz.lastDraw).toEqual({ models: 600, points: 50 });
    expect(pc.length).toBe(before);
    expect(shown()).toBe(50);
    viz.clear();
    expect(added.includes(pc)).toBe(false);
    expect(viz.lastDraw).toEqual({ models: 0, points: 0 });
  });

  it('when the 3D models cannot load every vehicle is still drawn, as a point', async () => {
    vi.spyOn(Model, 'fromGltfAsync').mockImplementation(() => Promise.reject(new Error('offline')));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { viewer } = fakeViewer();
    const viz = new MicroTrafficVisualizer();
    viz.setViewer(viewer);
    viz.draw(source(20));
    await new Promise(r => setTimeout(r, 0));
    viz.draw(source(20));
    expect(viz.lastDraw).toEqual({ models: 0, points: 20 });
  });

  it('fully faded vehicles are not drawn at all', () => {
    const { viewer } = fakeViewer();
    const viz = new MicroTrafficVisualizer();
    viz.setViewer(viewer);
    viz.draw(source(5, 0));
    expect(viz.lastDraw).toEqual({ models: 0, points: 0 });
  });
});
