import { Appearance, PerInstanceColorAppearance } from 'cesium';

/**
 * Realistic shading for batched Design geometry (BUILD_VISUALS_AND_TOOLS_PLAN §A3.2).
 *
 * Same vertex format and per-instance `color` attribute as `PerInstanceColorAppearance`, so traffic tint
 * (`Primitive.getGeometryInstanceAttributes(id).color`) and selection keep working. Lighting differs from Cesium's
 * `czm_phong`, which lights from the eye (a "headlight": every face facing the camera is equally bright, so a box reads
 * flat): here a fixed **design light** in the local east-north-up frame (azimuth 135°, from the south-east, 50° above
 * the horizon) plus a sky/ground hemisphere ambient term. A fixed light (not the clock's sun) keeps shading the same in
 * every screenshot and never goes dark at night, which suits a decision-support view. Both values are a rendering choice
 * (assumed), not a standard.
 */
const VS = /* glsl */ `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec4 color;
in float batchId;

out vec3 v_positionEC;
out vec3 v_normalEC;
out vec3 v_upEC;
out vec3 v_lightEC;
out vec4 v_color;

void main()
{
    vec4 p = czm_computePosition();
    // Geocentric up at the vertex (ellipsoid normal is within 0.2° of this at Pune's latitude; fine for shading)
    vec3 worldPos = position3DHigh + position3DLow;
    vec3 up = normalize(worldPos);
    vec3 east = normalize(cross(vec3(0.0, 0.0, 1.0), up));
    vec3 north = cross(up, east);
    // Design light: azimuth 135 deg (from the SE), elevation 50 deg
    float ce = cos(radians(50.0));
    vec3 lightWC = normalize(ce * sin(radians(135.0)) * east + ce * cos(radians(135.0)) * north + sin(radians(50.0)) * up);

    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
    v_normalEC = czm_normal * normal;
    v_upEC = czm_normal * up;
    v_lightEC = czm_normal * lightWC;
    v_color = color;
    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`;

const FS = /* glsl */ `
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec3 v_upEC;
in vec3 v_lightEC;
in vec4 v_color;

void main()
{
    vec3 n = normalize(v_normalEC);
    // Two-sided: generator winding is not consistent, so face the normal toward the viewer
    if (dot(n, -v_positionEC) < 0.0) n = -n;
    vec3 up = normalize(v_upEC);
    vec3 l = normalize(v_lightEC);
    vec4 base = czm_gammaCorrect(v_color);
    float diffuse = max(dot(n, l), 0.0);
    // Hemisphere ambient: faces looking at the sky are lighter than faces looking at the ground
    float hemi = 0.5 + 0.5 * dot(n, up);
    vec3 ambient = mix(vec3(0.34, 0.33, 0.31), vec3(0.55, 0.58, 0.62), hemi);
    vec3 rgb = base.rgb * (ambient + 0.62 * diffuse);
    out_FragColor = vec4(rgb, base.a);
}
`;

export function createLitTintAppearance(translucent: boolean): Appearance {
  return new Appearance({
    translucent,
    closed: false,
    vertexShaderSource: VS,
    fragmentShaderSource: FS,
    renderState: (Appearance as unknown as { getDefaultRenderState: (t: boolean, c: boolean, e?: unknown) => unknown }).getDefaultRenderState(translucent, false, undefined),
  } as unknown as ConstructorParameters<typeof Appearance>[0]);
}

/** Vertex attributes the shaders read (position + normal), same as the lit PerInstanceColorAppearance. */
export const LIT_TINT_VERTEX_FORMAT = PerInstanceColorAppearance.VERTEX_FORMAT;

export const LIT_TINT_SHADERS = { VS, FS };
