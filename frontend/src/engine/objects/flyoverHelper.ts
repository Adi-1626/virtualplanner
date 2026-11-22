import type { FlyoverObject, MetroFlyoverObject } from './types';
import type { TrafficNetwork } from './trafficTypes';
import { flyoverOffsetAt, flyoverRampProfile, type FlyoverRampProfile } from '../geometry/vertical/flyoverRamp';
import { isAsBuiltFlyover } from '../simulation/BridgeFeasibilityEngine';

function getDistanceMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function resampleCoordinates(coords: number[][], interval: number): number[][] {
  if (coords.length < 2) return coords;
  const newCoords: number[][] = [];
  
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    newCoords.push(p1);
    
    const dist = getDistanceMeters(p1[0], p1[1], p2[0], p2[1]);
    const numSegments = Math.floor(dist / interval);
    
    if (numSegments > 1) {
      for (let j = 1; j < numSegments; j++) {
        const t = j / numSegments;
        newCoords.push([
          p1[0] + (p2[0] - p1[0]) * t,
          p1[1] + (p2[1] - p1[1]) * t,
          (p1[2] || 0) + ((p2[2] || 0) - (p1[2] || 0)) * t
        ]);
      }
    }
  }
  newCoords.push(coords[coords.length - 1]);
  return newCoords;
}

/** Same plan positions (z ignored), within ~1 mm. */
function samePlan(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): boolean {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i][0] - b[i][0]) > 1e-8 || Math.abs(a[i][1] - b[i][1]) > 1e-8) return false;
  return true;
}

/**
 * A flyover whose plan line was regenerated (GEOMETRY_EDITOR_DESIGN.md §3.4): `groundLine` is its new ground-level path.
 * The stored ground coordinates are dropped so applyFlyoverElevationProfile rebuilds them and the ramp/deck profile from
 * the new path (grade-driven ramps, flyoverRampProfileOf). Mutates and returns `flyover`.
 */
export function resetFlyoverGround<T extends { coordinates: unknown; groundCoordinates?: unknown }>(flyover: T, groundLine: readonly (readonly number[])[]): T {
  (flyover as any).coordinates = groundLine.map(c => [c[0], c[1], c[2] || 0]);
  delete (flyover as any).groundCoordinates;
  applyFlyoverElevationProfile(flyover);
  return flyover;
}

/** Design speed for the ramp's vertical curves: the alignment's, else the deck speed (= design speed for new flyovers, D1). */
function flyoverDesignSpeed(flyover: any): number | null {
  const a = flyover.alignment?.designSpeedKmh;
  if (typeof a === 'number' && a > 0) return a;
  return typeof flyover.speedLimit === 'number' && flyover.speedLimit > 0 ? flyover.speedLimit : null;
}

/**
 * The ramp profile this flyover gets on a line of `totalLengthM` (geometry/vertical/flyoverRamp.ts): grade-driven
 * (4 % urban / 3.3 % highway, IRC:SP:90-2023 §4.13, with IRC:86-2018 Table 9.2 vertical curves) for a design drawn or
 * edited here; the legacy 40 m ramp for an as-built (mapped) flyover, which is never reshaped (D5).
 */
export function flyoverRampProfileOf(flyover: any, totalLengthM: number): FlyoverRampProfile {
  return flyoverRampProfile(flyover.elevation || 6.0, totalLengthM, {
    roadClass: flyover.roadClass, designSpeedKmh: flyoverDesignSpeed(flyover), asBuilt: isAsBuiltFlyover(flyover),
  });
}

export function applyFlyoverElevationProfile(flyover: any) {
  if (!flyover.coordinates || flyover.coordinates.length < 2) return;

  // Resample coordinates to have at most 10m spacing
  flyover.coordinates = resampleCoordinates(flyover.coordinates, 10.0);

  // Calculate cumulative distance along path
  const distanceList: number[] = [0];
  let totalDist = 0;
  for (let i = 1; i < flyover.coordinates.length; i++) {
    const dist = getDistanceMeters(
      flyover.coordinates[i - 1][0],
      flyover.coordinates[i - 1][1],
      flyover.coordinates[i][0],
      flyover.coordinates[i][1]
    );
    totalDist += dist;
    distanceList.push(totalDist);
  }

  // Ramp shape from the deck height and the decided grade, the same profile BridgeFeasibilityEngine checks
  // (docs/urbanos/PLANNING_DEFAULTS_DECISIONS.md D5). An as-built flyover keeps the legacy 40 m ramp.
  const profile = flyoverRampProfileOf(flyover, totalDist);

  // Preserve/Reconstruct ground coordinates to avoid double-elevation accumulation
  // Rebuilt when the plan changed: a vertex added (length differs) or moved (a reshape that keeps the vertex count)
  if (!flyover.groundCoordinates || flyover.groundCoordinates.length !== flyover.coordinates.length || !samePlan(flyover.groundCoordinates, flyover.coordinates)) {
    const averageElev = flyover.coordinates.reduce((sum: number, c: any) => sum + (c[2] || 0), 0) / flyover.coordinates.length;
    if (averageElev > 1.0) {
      // Heights already carry a ramp profile: take off the one that made them (stored with the object; a flyover from
      // before it was stored was made with the legacy 40 m ramp)
      const prev: FlyoverRampProfile = flyover.rampProfile && typeof flyover.rampProfile.modelledRampM === 'number'
        ? { ...flyover.rampProfile, totalLengthM: totalDist, modelledRampM: Math.min(flyover.rampProfile.modelledRampM, totalDist / 2) }
        : flyoverRampProfile(flyover.elevation || 6.0, totalDist, { asBuilt: true });
      flyover.groundCoordinates = flyover.coordinates.map((c: any, i: number) => [c[0], c[1], Math.max(0, (c[2] || 0) - flyoverOffsetAt(prev, distanceList[i]))]);
    } else {
      flyover.groundCoordinates = flyover.coordinates.map((c: any) => [c[0], c[1], c[2] || 0]);
    }
  }

  const baseCoords = flyover.groundCoordinates;
  flyover.rampProfile = profile;
  flyover.coordinates = baseCoords.map((c: any, i: number) => [c[0], c[1], (c[2] || 0) + flyoverOffsetAt(profile, distanceList[i])]);
}

export function getFlyoverConnectionStatus(
  flyover: FlyoverObject | MetroFlyoverObject | any,
  network: TrafficNetwork | null
): {
  connected: boolean;
  startConnected: boolean;
  endConnected: boolean;
  startNodeId?: string;
  endNodeId?: string;
} {
  if (!network || !network.nodes || !network.edges || !flyover.coordinates || flyover.coordinates.length < 2) {
    return { connected: false, startConnected: false, endConnected: false };
  }

  const flyoverId = flyover.id;
  const startCoord = flyover.coordinates[0];
  const endCoord = flyover.coordinates[flyover.coordinates.length - 1];

  let startNodeId: string | undefined;
  let endNodeId: string | undefined;

  // Spatial tolerance used in builder is 0.00006 degrees (~6 meters)
  const tol = 0.00006;

  network.nodes.forEach(node => {
    const startDist = Math.sqrt((node.coordinates[0] - startCoord[0]) ** 2 + (node.coordinates[1] - startCoord[1]) ** 2);
    if (startDist < tol && Math.abs((node.coordinates[2] || 0) - (startCoord[2] || 0)) < 3.0) {
      startNodeId = node.id;
    }

    const endDist = Math.sqrt((node.coordinates[0] - endCoord[0]) ** 2 + (node.coordinates[1] - endCoord[1]) ** 2);
    if (endDist < tol && Math.abs((node.coordinates[2] || 0) - (endCoord[2] || 0)) < 3.0) {
      endNodeId = node.id;
    }
  });

  if (!startNodeId || !endNodeId) {
    return { connected: false, startConnected: !!startNodeId, endConnected: !!endNodeId };
  }

  let startConnected = false;
  let endConnected = false;

  const startNode = network.nodes.get(startNodeId);
  if (startNode) {
    const allEdges = [...startNode.incomingSegments, ...startNode.outgoingSegments];
    startConnected = allEdges.some(edgeId => {
      const edge = network.edges.get(edgeId);
      return edge && edge.roadId !== flyoverId;
    });
  }

  const endNode = network.nodes.get(endNodeId);
  if (endNode) {
    const allEdges = [...endNode.incomingSegments, ...endNode.outgoingSegments];
    endConnected = allEdges.some(edgeId => {
      const edge = network.edges.get(edgeId);
      return edge && edge.roadId !== flyoverId;
    });
  }

  return {
    connected: startConnected && endConnected,
    startConnected,
    endConnected,
    startNodeId,
    endNodeId
  };
}
