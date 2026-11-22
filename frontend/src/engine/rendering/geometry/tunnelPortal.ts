/**
 * Tunnel portal placement (BUILD_VISUALS_AND_TOOLS_PLAN §A3.7, R7). Pure: works on a floor-level profile (metres, 0 =
 * ground, negative below) along a path, so road tunnels (road level) and underground alignments (invert level) share it.
 *
 * A portal sits where the floor drops to `-(openingHeight + cover)`: from there on the structure has its crown at least
 * `cover` below ground and is a closed tunnel. Between the surface (floor above `-openStart`) and that point the road
 * runs in an open **boat section** (U-shaped retaining walls, open to the sky). The headwall faces the shallow side.
 */
import { cumulativeLengths, densify, type PathPt } from './markingPattern';

export interface PortalPlan {
  /** Plan distance of the headwall along the path (m). */
  headwallS: number;
  /** +1: the open approach lies at larger s (headwall faces forward); -1: at smaller s. */
  facing: 1 | -1;
}
export interface BoatRun { s0: number; s1: number }

/** Floor level at plan distance s (linear between stations). */
export function levelAt(cum: readonly number[], levels: readonly number[], s: number): number {
  if (s <= cum[0]) return levels[0];
  for (let i = 1; i < cum.length; i++) {
    if (s <= cum[i]) {
      const L = cum[i] - cum[i - 1];
      return L > 0 ? levels[i - 1] + ((levels[i] - levels[i - 1]) * (s - cum[i - 1])) / L : levels[i];
    }
  }
  return levels[levels.length - 1];
}

/**
 * Portals and boat-section runs along a floor-level profile.
 * @param cum  plan distances of the stations
 * @param levels  floor level at each station (m, negative below ground)
 * @param openingHeight  clear height of the tunnel opening (m)
 * @param cover  crown cover at the headwall (m)
 * @param openStart  floor depth below which the boat walls start (shallower than this the road is effectively at grade)
 */
export function planPortals(cum: readonly number[], levels: readonly number[], openingHeight: number, cover: number, openStart = 0.3): { portals: PortalPlan[]; boats: BoatRun[] } {
  const deep = -(openingHeight + cover);
  const portals: PortalPlan[] = [];
  const boats: BoatRun[] = [];
  if (cum.length < 2) return { portals, boats };
  // Headwalls: every crossing of the deep level between stations
  for (let i = 1; i < cum.length; i++) {
    const a = levels[i - 1], b = levels[i];
    if ((a > deep) === (b > deep) || a === b) continue;
    const s = cum[i - 1] + ((deep - a) / (b - a)) * (cum[i] - cum[i - 1]);
    portals.push({ headwallS: s, facing: a > deep ? -1 : 1 });
  }
  // Boat runs: stretches where the floor lies between -openStart and the deep level (open cut, walled)
  const inBand = (z: number) => z < -openStart && z > deep;
  const cuts: number[] = [];
  for (let i = 0; i < cum.length; i++) cuts.push(cum[i]);
  for (let i = 1; i < cum.length; i++) {
    for (const edge of [-openStart, deep]) {
      const a = levels[i - 1], b = levels[i];
      if ((a > edge) !== (b > edge) && a !== b) cuts.push(cum[i - 1] + ((edge - a) / (b - a)) * (cum[i] - cum[i - 1]));
    }
  }
  cuts.sort((x, y) => x - y);
  let run: BoatRun | null = null;
  for (let k = 1; k < cuts.length; k++) {
    const s0 = cuts[k - 1], s1 = cuts[k];
    if (s1 - s0 < 1e-6) continue;
    if (inBand(levelAt(cum, levels, (s0 + s1) / 2))) {
      if (run && Math.abs(run.s1 - s0) < 1e-6) run.s1 = s1;
      else boats.push((run = { s0, s1 }));
    }
  }
  return { portals, boats };
}

/** Portal plan for a path whose z is the floor level (road tunnels and their approaches); densified to `step` m. */
export function planPortalsOnPath(path: readonly PathPt[], openingHeight: number, cover: number, step = 5): { path: PathPt[]; cum: number[]; portals: PortalPlan[]; boats: BoatRun[] } {
  const p = densify(path, step);
  const cum = cumulativeLengths(p);
  return { path: p, cum, ...planPortals(cum, p.map(q => q[2] || 0), openingHeight, cover) };
}
