/**
 * Underground view state on the Cesium globe (UX_ARCHITECTURE §7, PRODUCT_UX_RESEARCH §3.2/§3.3):
 * ground opacity (globe.translucency.frontFaceAlpha / backFaceAlpha, optionally limited to a rectangle), X-ray
 * (translucent ground + no terrain depth test so buried objects show through), undergroundColor, and camera collision
 * detection off so the camera may go below ground. `leave()` restores exactly what `enter()` found.
 *
 * Cesium API used (CesiumJS ref-doc, GlobeTranslucency / Globe / ScreenSpaceCameraController):
 *   globe.translucency.{enabled, frontFaceAlpha, backFaceAlpha, rectangle}, globe.undergroundColor,
 *   globe.undergroundColorAlphaByDistance, globe.depthTestAgainstTerrain, screenSpaceCameraController.enableCollisionDetection.
 * The viewer is passed in (structurally typed) so this is testable without WebGL.
 */
import { Color, Rectangle } from 'cesium';

export interface GlobeLike {
  translucency: {
    enabled: boolean; frontFaceAlpha: number; backFaceAlpha: number; rectangle: unknown;
    frontFaceAlphaByDistance?: unknown; backFaceAlphaByDistance?: unknown;
  };
  undergroundColor: unknown;
  undergroundColorAlphaByDistance?: unknown;
  depthTestAgainstTerrain: boolean;
}
type Showable = { show: boolean } | undefined;
export interface ViewerLike {
  scene: {
    globe: GlobeLike; screenSpaceCameraController: { enableCollisionDetection: boolean }; requestRender?: () => void;
    backgroundColor?: unknown; skyBox?: Showable; skyAtmosphere?: Showable; sun?: Showable; moon?: Showable;
  };
}

export interface UndergroundViewSettings {
  /** Ground opacity 0..1 (1 = opaque ground). */
  groundOpacity: number;
  /** X-ray: buried objects drawn through the ground (no terrain depth test). */
  xray: boolean;
  /** Limit translucency to this lon/lat box [west, south, east, north] in degrees; null = whole globe. */
  rectangleDeg: [number, number, number, number] | null;
  /** See-through everywhere (default) or only inside the work area (the cutaway window, rectangleDeg). */
  seeThroughEverywhere: boolean;
}

/**
 * Applied on EVERY entry into Underground (not only on page load): the settings used to live in a module singleton for
 * the whole tab, so a slider left at 0 % in an earlier visit came back as 0 % on the next entry (UNDERGROUND_VISUAL_FIXES.md).
 */
export const DEFAULT_UNDERGROUND_SETTINGS: UndergroundViewSettings = { groundOpacity: 0.35, xray: false, rectangleDeg: null, seeThroughEverywhere: true };

/** Dark neutral subsurface backdrop seen through the translucent ground (never the far side of the Earth). */
export const SUBSURFACE_BACKDROP_CSS = '#0b1120';

interface Saved {
  enabled: boolean; front: number; back: number; rectangle: unknown; undergroundColor: unknown; depthTest: boolean; collision: boolean;
  frontByDist: unknown; backByDist: unknown; ugAlphaByDist: unknown;
  background: unknown; sky: [boolean | undefined, boolean | undefined, boolean | undefined, boolean | undefined];
}

/** Cesium value factories (injectable so the state logic is testable without the real Cesium module). */
export interface UndergroundViewDeps {
  rectangle: (deg: [number, number, number, number] | null) => unknown;
  tint: () => unknown;
  /** Scene background behind the see-through ground (optional in tests). */
  backdrop?: () => unknown;
}
const cesiumDeps: UndergroundViewDeps = {
  rectangle: deg => (deg ? Rectangle.fromDegrees(...deg) : Rectangle.MAX_VALUE),
  tint: () => Color.fromCssColorString('#1e293b'), // dark slate, opaque (PRODUCT_UX_RESEARCH §3.3)
  backdrop: () => Color.fromCssColorString(SUBSURFACE_BACKDROP_CSS),
};

export class UndergroundView {
  private deps: UndergroundViewDeps;
  constructor(deps: UndergroundViewDeps = cesiumDeps) { this.deps = deps; }

  private saved: Saved | null = null;
  private viewer: ViewerLike | null = null;
  private settings: UndergroundViewSettings = { ...DEFAULT_UNDERGROUND_SETTINGS };
  private listeners = new Set<() => void>();

  isActive() { return this.saved !== null; }
  getSettings(): UndergroundViewSettings { return { ...this.settings }; }
  onChange(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private emit() { this.listeners.forEach(cb => cb()); }

  /** Saves the globe state and applies the underground settings. Idempotent. */
  enter(viewer: ViewerLike | null) {
    if (!viewer) return;
    if (this.saved && this.viewer === viewer) { this.apply(); return; }
    const g = viewer.scene.globe, sc = viewer.scene;
    this.viewer = viewer;
    this.saved = {
      enabled: g.translucency.enabled, front: g.translucency.frontFaceAlpha, back: g.translucency.backFaceAlpha,
      rectangle: g.translucency.rectangle, undergroundColor: g.undergroundColor, depthTest: g.depthTestAgainstTerrain,
      collision: sc.screenSpaceCameraController.enableCollisionDetection,
      frontByDist: g.translucency.frontFaceAlphaByDistance, backByDist: g.translucency.backFaceAlphaByDistance,
      ugAlphaByDist: g.undergroundColorAlphaByDistance,
      background: sc.backgroundColor, sky: [sc.skyBox?.show, sc.skyAtmosphere?.show, sc.sun?.show, sc.moon?.show],
    };
    // Every entry starts from the defaults (see DEFAULT_UNDERGROUND_SETTINGS); the work-area rectangle is kept
    this.settings = { ...DEFAULT_UNDERGROUND_SETTINGS, rectangleDeg: this.settings.rectangleDeg };
    this.apply();
    this.emit();
  }

  /** Restores the state saved by enter(). */
  leave() {
    const v = this.viewer, s = this.saved;
    if (!v || !s) return;
    const g = v.scene.globe;
    g.translucency.enabled = s.enabled;
    g.translucency.frontFaceAlpha = s.front;
    g.translucency.backFaceAlpha = s.back;
    g.translucency.rectangle = s.rectangle;
    g.undergroundColor = s.undergroundColor;
    g.depthTestAgainstTerrain = s.depthTest;
    if ('frontFaceAlphaByDistance' in g.translucency) g.translucency.frontFaceAlphaByDistance = s.frontByDist;
    if ('backFaceAlphaByDistance' in g.translucency) g.translucency.backFaceAlphaByDistance = s.backByDist;
    if ('undergroundColorAlphaByDistance' in g) g.undergroundColorAlphaByDistance = s.ugAlphaByDist;
    const sc = v.scene;
    if ('backgroundColor' in sc) sc.backgroundColor = s.background;
    [sc.skyBox, sc.skyAtmosphere, sc.sun, sc.moon].forEach((o, i) => { if (o && s.sky[i] !== undefined) o.show = s.sky[i] as boolean; });
    v.scene.screenSpaceCameraController.enableCollisionDetection = s.collision;
    v.scene.requestRender?.();
    this.saved = null;
    this.emit();
  }

  update(patch: Partial<UndergroundViewSettings>) {
    const op = patch.groundOpacity;
    this.settings = {
      ...this.settings, ...patch,
      ...(op !== undefined ? { groundOpacity: Math.min(1, Math.max(0, Number.isFinite(op) ? op : 1)) } : {}),
    };
    this.apply();
    this.emit();
  }

  /** The rectangle translucency is limited to: none when see-through everywhere or no work area yet. */
  effectiveRectangle(): [number, number, number, number] | null {
    return this.settings.seeThroughEverywhere ? null : this.settings.rectangleDeg;
  }

  private apply() {
    const v = this.viewer;
    if (!v || !this.saved) return;
    const g = v.scene.globe, sc = v.scene;
    const { groundOpacity, xray } = this.settings;
    const translucent = groundOpacity < 1;
    g.translucency.enabled = translucent;
    g.translucency.frontFaceAlpha = groundOpacity;
    // The back face is NEVER drawn: through a hollow globe it showed the far side of the Earth (Greenland / North
    // America under Pune at 0 %). What is seen through the ground is the dark subsurface backdrop instead.
    g.translucency.backFaceAlpha = 0;
    if ('frontFaceAlphaByDistance' in g.translucency) g.translucency.frontFaceAlphaByDistance = undefined;
    if ('backFaceAlphaByDistance' in g.translucency) g.translucency.backFaceAlphaByDistance = undefined;
    g.translucency.rectangle = this.deps.rectangle(this.effectiveRectangle());
    g.undergroundColor = this.deps.tint();
    if ('undergroundColorAlphaByDistance' in g) g.undergroundColorAlphaByDistance = undefined;
    // Backdrop: no stars, sky glow, sun or moon behind the see-through ground
    if (this.deps.backdrop) sc.backgroundColor = this.deps.backdrop();
    [sc.skyBox, sc.skyAtmosphere, sc.sun, sc.moon].forEach(o => { if (o) o.show = false; });
    // Without X-ray the ground hides what is below it outside the see-through ground (the depth test keeps the cutaway
    // honest). X-ray turns the terrain depth test off: buried objects are drawn through solid ground everywhere, and
    // the surface buildings fade (UndergroundContext.runtime).
    g.depthTestAgainstTerrain = !xray;
    sc.screenSpaceCameraController.enableCollisionDetection = false;
    sc.requestRender?.();
  }
}

export const undergroundView = new UndergroundView();
