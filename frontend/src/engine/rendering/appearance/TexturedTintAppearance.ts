import * as CesiumNs from 'cesium';
import {
  Appearance,
  Cartesian3,
  Material,
  Matrix3,
  Matrix4,
  TextureMinificationFilter,
  TextureMagnificationFilter,
  Transforms,
  type Viewer,
} from 'cesium';

// Exported by Cesium at runtime but missing from its type declarations
type Ctor = new (opts?: unknown) => unknown;
const Ces = CesiumNs as unknown as {
  EncodedCartesian3: { fromCartesian: (c: Cartesian3) => { high: Cartesian3; low: Cartesian3 } };
  Sampler: Ctor;
  Texture: Ctor;
  TextureWrap: { CLAMP_TO_EDGE: number };
};
import { LIT_TINT_SHADERS } from './LitTintAppearance';
import { ATLAS_GUTTER, ATLAS_SIZE, ATLAS_SLOT, ATLAS_SLOTS, ATLAS_URL } from '../materials/textureAtlas';

/**
 * Realistic shading with CC0 detail textures (BUILD_VISUALS_AND_TOOLS_PLAN §A3.3), Medium / High tiers.
 *
 * Spike result (2026-11-22): a custom per-instance attribute (`matSlot`) on a custom `Appearance` works: Primitive puts
 * every per-instance attribute in its batch table and the vertex shader reads it with `czm_batchTable_matSlot(batchId)`.
 * Per-instance `color` stays the same attribute as PerInstanceColorAppearance's, so traffic tint (setColor) and the
 * selection colour keep working; the texture only modulates it (detail × 2, mean 1), i.e. a colour-modulated material.
 *
 * No per-vertex UVs are needed: texture coordinates are world metres in the tile's local east-north-up frame
 * (origin passed high/low-encoded so it is exact at ECEF magnitudes), projected on the face's dominant axis. Faces are
 * planar with hard edges, so one sample per fragment is enough (no triplanar blend). Detail fades out with distance
 * (250–700 m) so distant surfaces do not shimmer; mipmaps are generated for the atlas.
 */

const slotTiles = ATLAS_SLOTS.map(s => s.tileM.toFixed(2)).join(', ');

const VS = LIT_TINT_SHADERS.VS
  .replace('out vec4 v_color;', `out vec4 v_color;
out vec3 v_local;
out vec3 v_nLocal;
out float v_slot;
uniform vec3 u_originHigh;
uniform vec3 u_originLow;
uniform mat3 u_enu;`)
  .replace('    v_color = color;', `    v_color = color;
    vec3 rel = (position3DHigh - u_originHigh) + (position3DLow - u_originLow);
    v_local = rel * u_enu;
    v_nLocal = normal * u_enu;
    v_slot = czm_batchTable_matSlot(batchId);`);

const FS = `
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec3 v_upEC;
in vec3 v_lightEC;
in vec4 v_color;
in vec3 v_local;
in vec3 v_nLocal;
in float v_slot;

const float SLOT_TILE_M[${ATLAS_SLOTS.length}] = float[](${slotTiles});

float urbanosDetail(vec3 p, vec3 nl, float slot, float dist)
{
    if (slot < -0.5) return 0.5;
    int s = int(slot + 0.5);
    vec3 a = abs(nl);
    vec2 m = a.z >= a.x && a.z >= a.y ? p.xy : (a.x >= a.y ? p.yz : p.xz);
    vec2 t = m / SLOT_TILE_M[s];
    vec2 cell = vec2(mod(float(s), 4.0), floor(float(s) / 4.0));
    float inner = ${(ATLAS_SLOT - 2 * ATLAS_GUTTER).toFixed(1)} / ${ATLAS_SIZE.toFixed(1)};
    vec2 o = (cell * ${ATLAS_SLOT.toFixed(1)} + ${ATLAS_GUTTER.toFixed(1)}) / ${ATLAS_SIZE.toFixed(1)};
    vec2 uv = o + fract(t) * inner;
    uv.y = 1.0 - uv.y; // image rows run top-down, texture v bottom-up
    vec2 gx = dFdx(t) * inner, gy = dFdy(t) * inner;
    float d = urbanosAtlasGrad(uv, vec2(gx.x, -gx.y), vec2(gy.x, -gy.y));
    return mix(d, 0.5, smoothstep(250.0, 700.0, dist));
}

void main()
{
    vec3 n = normalize(v_normalEC);
    if (dot(n, -v_positionEC) < 0.0) n = -n;
    vec3 up = normalize(v_upEC);
    vec3 l = normalize(v_lightEC);
    vec4 base = czm_gammaCorrect(v_color);
    float detail = urbanosDetail(v_local, v_nLocal, v_slot, length(v_positionEC));
    float diffuse = max(dot(n, l), 0.0);
    float hemi = 0.5 + 0.5 * dot(n, up);
    vec3 ambient = mix(vec3(0.34, 0.33, 0.31), vec3(0.55, 0.58, 0.62), hemi);
    vec3 rgb = base.rgb * (2.0 * detail) * (ambient + 0.62 * diffuse);
    out_FragColor = vec4(rgb, base.a);
}
`;

const MATERIAL_SOURCE = `
float urbanosAtlasGrad(vec2 uv, vec2 dx, vec2 dy) { return textureGrad(atlas, uv, dx, dy).r; }
czm_material czm_getMaterial(czm_materialInput materialInput) { return czm_getDefaultMaterial(materialInput); }
`;

let sharedMaterial: Material | null = null;
let atlasRequested = false;

/** The shared atlas material; its texture (with mipmaps) is created once the image loads and the GL context exists. */
function atlasMaterial(viewer: Viewer): Material {
  if (!sharedMaterial) {
    sharedMaterial = new Material({
      strict: false,
      translucent: false,
      fabric: { type: 'UrbanosDetailAtlas', uniforms: { atlas: Material.DefaultImageId }, source: MATERIAL_SOURCE },
    } as unknown as ConstructorParameters<typeof Material>[0]);
  }
  if (!atlasRequested) {
    atlasRequested = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const context = (viewer.scene as unknown as { context: unknown }).context;
      const texture = new Ces.Texture({
        context,
        source: img,
        sampler: new Ces.Sampler({
          wrapS: Ces.TextureWrap.CLAMP_TO_EDGE,
          wrapT: Ces.TextureWrap.CLAMP_TO_EDGE,
          minificationFilter: TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
          magnificationFilter: TextureMagnificationFilter.LINEAR,
        }),
      });
      (texture as unknown as { generateMipmap: () => void }).generateMipmap();
      (sharedMaterial as unknown as { uniforms: Record<string, unknown> }).uniforms.atlas = texture;
      viewer.scene.requestRender();
    };
    img.onerror = () => console.warn('[TexturedTintAppearance] detail atlas failed to load; surfaces stay untextured');
    img.src = new URL(ATLAS_URL, document.baseURI).href;
  }
  return sharedMaterial;
}

/** Whether textured shading can run here (a real WebGL 2 context: textureGrad and float arrays need GLSL ES 3.00). */
export function texturesSupported(viewer: Viewer): boolean {
  const ctx = (viewer?.scene as unknown as { context?: { webgl2?: boolean } })?.context;
  return !!ctx && ctx.webgl2 === true;
}

/** Local frame of a tile: origin (encoded high/low) and the east-north-up axes as matrix columns. */
export function tileFrameUniforms(origin: Cartesian3) {
  const enc = Ces.EncodedCartesian3.fromCartesian(origin);
  const m4 = Transforms.eastNorthUpToFixedFrame(origin);
  const enu = Matrix4.getMatrix3(m4, new Matrix3());
  // Values, not functions: Primitive wraps each appearance uniform in its own getter
  return { u_originHigh: enc.high, u_originLow: enc.low, u_enu: enu };
}

export function createTexturedTintAppearance(viewer: Viewer, translucent: boolean, origin: Cartesian3): Appearance {
  const app = new Appearance({
    material: atlasMaterial(viewer),
    translucent,
    closed: false,
    vertexShaderSource: VS,
    fragmentShaderSource: FS,
    renderState: (Appearance as unknown as { getDefaultRenderState: (t: boolean, c: boolean, e?: unknown) => unknown }).getDefaultRenderState(translucent, false, undefined),
  } as unknown as ConstructorParameters<typeof Appearance>[0]);
  (app as unknown as { uniforms: Record<string, unknown> }).uniforms = tileFrameUniforms(origin);
  return app;
}

export const TEXTURED_TINT_SHADERS = { VS, FS, MATERIAL_SOURCE };
