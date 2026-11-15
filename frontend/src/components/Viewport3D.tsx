import React, { useEffect, useRef, useState } from 'react';
import { cesiumIonToken } from '../lib/cesiumToken';
import { dropFailedBaseLayer, watchBaseImageryState, watchImageryErrors } from '../lib/baseImageryErrors';
import {
  Viewer,
  Ion,
  type ProviderViewModel,
  Cartesian3,
  Math as CesiumMath,
  ScreenSpaceEventType
} from 'cesium';
import * as CesiumNs from 'cesium';
import { engineInstance } from '../engine/TwinCityEngine';
import type { EditingMode } from '../engine/editing/EditingEngine';

export const Viewport3D: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageryError, setImageryError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Set Cesium Ion default token if available in env, otherwise blank
    const ionToken = cesiumIonToken();
    if (ionToken) {
      Ion.defaultAccessToken = ionToken;
    }

    // The base-layer picker's own models, with its default (first) one selected explicitly: otherwise the widget first
    // creates a default world-imagery layer that the picker immediately replaces (a second, wasted ion request whose
    // failure nobody could listen to)
    // (exported at runtime by Cesium but missing from its type declarations)
    const imageryModels = (CesiumNs as unknown as { createDefaultImageryProviderViewModels: () => ProviderViewModel[] }).createDefaultImageryProviderViewModels();

    // Initialize Cesium Viewer with clean, clutter-free options
    const viewer = new Viewer(containerRef.current, {
      imageryProviderViewModels: imageryModels,
      selectedImageryProviderViewModel: imageryModels[0],
      animation: false, // Custom scenario timelines
      timeline: false,  // Custom simulation slider
      geocoder: false,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      infoBox: false, // Custom context properties panel
      selectionIndicator: false,
      baseLayerPicker: true, // Allow user to toggle between satellite and street base maps
      fullscreenButton: true,
      terrainProvider: undefined // Default ellipsoid or generic terrain
    });

    // A failed base-map request is reported to the user once, not dumped to the console as a raw RequestErrorEvent
    const stopImageryWatch = watchImageryErrors(viewer.imageryLayers, msg => (window as any).showToast?.(msg, 'error'));
    // ...and stays noted on the map while the base layer is the failed one
    const stopBaseState = watchBaseImageryState(viewer.imageryLayers, setImageryError);
    // ...and taken out, or the globe (and everything draped on it: area and zone outlines) is never drawn
    const stopDropFailed = dropFailedBaseLayer(viewer.imageryLayers, viewer.scene.globe);

    // Disable default double-click camera tracking/zoom
    viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // Configure lighting and camera
    viewer.scene.globe.enableLighting = true;
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;

    // Set initial camera view centered on Pune (73.8567, 18.5204) at 1500m altitude
    const initialPosition = Cartesian3.fromDegrees(73.8567, 18.5204, 1500);
    viewer.camera.setView({
      destination: initialPosition,
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-45),
        roll: 0.0
      }
    });

    // Register Cesium viewer inside our master TwinCityEngine
    engineInstance.setViewer(viewer);

    // Cleanup: release engine resources bound to this viewer before destroying it
    return () => {
      stopImageryWatch();
      stopBaseState();
      stopDropFailed();
      engineInstance.dispose();
      viewer.destroy();
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      {/* Target element for Cesium container */}
      <div ref={containerRef} className="w-full h-full absolute inset-0" />

      {imageryError && (
        <div role="status" data-testid="base-imagery-notice"
          className="uos-imagery-notice rounded px-2 py-1 text-[11px] leading-snug pointer-events-none"
          style={{ background: 'rgba(15,20,28,0.85)', color: 'var(--text-2, #a9b3c1)', border: '1px solid var(--border, #2a3340)' }}>
          {imageryError}
        </div>
      )}

      {/* Overlay to show current drawing tool tips */}
      <DrawingHUD />
    </div>
  );
};

/** One short line per tool: what to click and how to finish. */
const HUD_TEXT: Record<Exclude<EditingMode, 'select'>, (n: number) => string> = {
  draw_road: n => `Road: click points on the map, double-click or Enter to finish (${n} placed)`,
  draw_flyover: n => `Flyover: click points along the route, double-click or Enter to finish (${n} placed)`,
  draw_metro: n => `Metro line: click points along the route, double-click or Enter to finish (${n} placed)`,
  draw_metro_flyover: n => `Double-deck: click points along the route, double-click or Enter to finish (${n} placed)`,
  draw_building: n => `Building: click 3 or more corners, double-click or Enter to finish (${n} placed)`,
  draw_underground: n => `Tunnel: click plan points, double-click or Enter to finish (${n} placed). Set depths in Underground`,
  draw_utility: n => `Utility: click points along the line, double-click or Enter to finish (${n} placed)`,
  draw_zone: n => `Demand zone: click 3 or more corners, double-click or Enter to finish (${n} placed)`,
  draw_junction: () => 'Junction: click where two or more roads meet',
  place_station: () => 'Station: click on or near a metro line',
  draw_gateway: () => 'Gateway: click on or near a road where traffic enters the area',
  import_osm: n => n > 0
    ? `Draw Area: ${n} boundary points. Drag points to move them, drag a midpoint to add one, then choose "Map Selected Area" in the tool panel`
    : 'Draw Area: click 3+ points to outline a polygon, then choose Map Selected Area',
};

const DrawingHUD: React.FC = () => {
  const [mode, setMode] = React.useState(engineInstance.editing.getMode());
  const [pointsCount, setPointsCount] = React.useState(0);

  useEffect(() => {
    const unsub = engineInstance.editing.onChange(() => {
      setMode(engineInstance.editing.getMode());
      setPointsCount(engineInstance.editing.getDrawingPoints().length);
    });
    return unsub;
  }, []);

  if (mode === 'select') return null;

  const multiPoint = !engineInstance.editing.isSingleClickMode(mode);
  // "Finish" completes the line or outline being drawn (it used to discard it); with nothing drawn it leaves the tool
  const canFinish = multiPoint && mode !== 'import_osm' && pointsCount > 0;
  const onDone = () => {
    if (canFinish && !engineInstance.finishDrawing()) return; // too few points: keep drawing (the toast says why)
    engineInstance.editing.cancelDrawing();
  };

  return (
    <div data-testid="drawing-hud" className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-indigo-400/30 shadow-2xl flex items-center gap-3 text-sm z-999 animate-fade-in pointer-events-auto max-w-[min(42rem,calc(100vw-48rem))]">
      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
      <div className="flex flex-col">
        <span className="text-slate-100">{HUD_TEXT[mode](pointsCount)}</span>
        <span className="text-xs text-slate-400">
          {multiPoint && pointsCount > 0 ? 'Right-click a point to remove it · ' : ''}Tool stays active · Esc cancels
        </span>
      </div>
      <button
        type="button"
        data-testid="drawing-hud-done"
        onClick={onDone}
        title={canFinish ? 'Finish this drawing and leave the tool' : 'Leave the tool'}
        className="px-3 py-1 rounded-lg bg-white/[0.07] text-slate-100 hover:bg-white/[0.12] border border-white/10 text-sm font-semibold transition cursor-pointer shrink-0"
      >
        {canFinish ? 'Finish' : 'Done'}
      </button>
    </div>
  );
};
