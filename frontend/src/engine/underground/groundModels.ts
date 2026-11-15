/**
 * Which ground each Underground view measures depth from (UNDERGROUND_AUDIT open issue "one ground for both views").
 *
 * The Profile, Cross-section and the editors' elevations use the Copernicus GLO-30 DSM v3 (/api/terrain, m EGM2008). The
 * 3D globe can only show a terrain from a terrain provider (Cesium World Terrain needs an ion token; without one the globe
 * is the flat WGS84 ellipsoid), and the DSM cannot be the 3D surface: it includes roofs and trees, so roads and buildings
 * would ride over them. So the 3D view places every buried object at its typed depth below the 3D ground directly above
 * each point: depths at the points are the same number in both views, and this module states which ground each uses.
 */
import { getGroundField } from '../terrain/groundHeight';

export const PROFILE_GROUND = 'Copernicus GLO-30 DSM v3 (m EGM2008; surface model incl. roofs and trees, ±2–4 m)';

export function sceneGroundLabel(): { short: string; long: string; terrain: boolean } {
  const terrain = getGroundField() !== null;
  return terrain
    ? { terrain, short: '3D ground: Cesium World Terrain', long: `3D ground: Cesium World Terrain (a terrain model, not the DSM). Buried objects are drawn at their typed depth below it at each point; the Profile measures the same depths from the ${PROFILE_GROUND}.` }
    : { terrain, short: '3D ground: flat (no terrain service)', long: `3D ground: drawn flat (WGS84 ellipsoid; no terrain service is available). Buried objects are drawn at their typed depth below it at each point; the Profile and Cross-section measure the same depths from the ${PROFILE_GROUND}, so at each point the depth is the same in both views and only the shape of the ground differs.` };
}
