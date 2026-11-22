import { utilityZ } from '../../underground/utilityModel';
import { isUnmappedMetroTunnel, unmappedUndergroundStation } from '../../underground/metroLevel';
import type { CityObject, RoadObject, BuildingObject, FlyoverObject, MetroLineObject, MetroStationObject, UtilityObject, JunctionObject, MetroFlyoverObject } from '../../objects/types';
import { groundAt, getGroundField, withFlatGround } from '../../terrain/groundHeight';
import { depressedLevel, elevatedLayer, isOsmBridge } from '../../objects/bridgeElevation';
import { junctionLayout } from '../../objects/junctionLayout';
import { ROAD_CLASS_LIFT_M } from '../../objects/roadSurface';
import { crossingGaps, piecesBetween, type Gap } from './junctionGaps';
import { resolveStationHeading } from '../../objects/stationAlignment';
import { GeometryContext } from './GeometryContext';
import type { MeshData, MaterialConfig } from '../types';
import { cumulativeLengths, dashAll, fitToTerrain, pierStations, pointAt, type PathPt } from './markingPattern';
import { dim } from '../standards/visualDims';
import { extrudeProfile } from './extrudeProfile';
import { boxGirderProfile, jerseyMedianProfile, jerseyParapetProfile, rectProfile, uGirderParts } from '../standards/profiles';

/**
 * Helper to convert WGS84 coordinates to ECEF Cartesian3 coordinates.
 */
function wgs84ToCartesian(lng: number, lat: number, h: number): [number, number, number] {
  const a = 6378137.0; // semi-major axis in meters
  const f = 1.0 / 298.257223563; // flattening
  const e2 = 2.0 * f - f * f; // eccentricity squared

  // Model heights are above the ground; the ground is the sampled terrain when terrain is on
  h += groundAt(lng, lat);
  const radLng = lng * (Math.PI / 180.0);
  const radLat = lat * (Math.PI / 180.0);

  const cosLat = Math.cos(radLat);
  const sinLat = Math.sin(radLat);

  const N = a / Math.sqrt(1.0 - e2 * sinLat * sinLat);

  const x = (N + h) * cosLat * Math.cos(radLng);
  const y = (N + h) * cosLat * Math.sin(radLng);
  const z = ((1.0 - e2) * N + h) * sinLat;

  return [x, y, z];
}

/**
 * Cross product of two 3D vectors
 */
function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

/**
 * Normalize a 3D vector
 */
function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len === 0) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Direction of travel in ECEF between two [lng, lat] points (for orienting piers and caps across the deck). */
function ecefTangent(a: readonly number[], b: readonly number[]): [number, number, number] {
  const pa = wgs84ToCartesian(a[0], a[1], 0);
  const pb = wgs84ToCartesian(b[0], b[1], 0);
  return [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
}

export class ProceduralGeometryGenerator {
  /**
   * Translates a CityObject configuration to a group of MeshData meshes
   */
  /**
   * @param scene Either a GeometryContext shared across a batch (fast), or a plain
   *   map of all objects (a context is built for this single call).
   */
  public generateMeshData(obj: CityObject, scene?: ReadonlyMap<string, CityObject> | GeometryContext): MeshData[] {
    // A part cut away entirely (e.g. a footpath on a road that is all junction) has no geometry,
    // and an empty buffer stops Cesium rendering altogether
    return this.generateAllMeshData(obj, scene).filter(m => m.positions.length > 0 && m.indices.length > 0);
  }

  private generateAllMeshData(obj: CityObject, scene?: ReadonlyMap<string, CityObject> | GeometryContext): MeshData[] {
    const allObjects = scene instanceof GeometryContext ? scene : scene ? new GeometryContext(scene) : undefined;
    try {
      if (obj.type === 'building') {
        return this.generateBuildingMesh(obj as BuildingObject);
      }
      if (obj.type === 'road') {
        return this.generateRoadMeshes(obj as RoadObject, allObjects);
      }
      if (obj.type === 'flyover') {
        return this.generateFlyoverMeshes(obj as FlyoverObject);
      }
      if (obj.type === 'metro_flyover') {
        return this.generateMetroFlyoverMeshes(obj as MetroFlyoverObject);
      }
      if (obj.type === 'metro_line') {
        // Existing tunnel with an unmapped depth: no invented −6 m deck; a labelled plan line is drawn on the surface
        // by the Underground renderer (metroLevel.ts)
        if (isUnmappedMetroTunnel(obj)) return [];
        return this.generateMetroLineMeshes(obj as MetroLineObject);
      }
      if (obj.type === 'metro_station') {
        if (unmappedUndergroundStation(obj, allObjects ? allObjects.ofType('metro_line') : [])) return [];
        return this.generateMetroStationMeshes(obj as MetroStationObject, allObjects);
      }
      if (obj.type === 'utility') {
        return this.generateUtilityMesh(obj as UtilityObject);
      }
      if (obj.type === 'junction') {
        return this.generateJunctionMeshes(obj as JunctionObject, allObjects);
      }
    } catch (err) {
      console.error(`Failed to generate procedural geometry for object ${obj.id}:`, err);
    }
    return [];
  }

  /**
   * Generates a list of 3D building meshes for [Far, Medium, Close] LODs
   */
  /** A building's base sits flat at the lowest ground under its footprint. */
  private generateBuildingMesh(building: BuildingObject): MeshData[] {
    return withFlatGround(building.coordinates, () => this.generateBuildingMeshOnGround(building));
  }

  private generateBuildingMeshOnGround(building: BuildingObject): MeshData[] {
    const footprint = building.coordinates;
    const height = building.height || 10;
    const numPoints = footprint.length;
    if (numPoints === 0) return [];

    // --- 1. FAR LOD: Flat footprint mesh ---
    const farPositions: number[] = [];
    const farIndices: number[] = [];

    for (let i = 0; i < numPoints; i++) {
      const pt = footprint[i];
      const bot = wgs84ToCartesian(pt[0], pt[1], 0.1); // 0.1m height to prevent z-fighting
      farPositions.push(...bot);
    }

    // Triangle fan for flat footprint
    for (let i = 1; i < numPoints - 1; i++) {
      farIndices.push(0, i, i + 1);
    }

    const farMaterial: MaterialConfig = {
      type: 'solid',
      color: '#475569' // Muted footprint color
    };

    const farMesh: MeshData = {
      positions: new Float64Array(farPositions),
      indices: new Uint32Array(farIndices),
      material: farMaterial,
      layerId: 'building'
    };

    // --- 2. MEDIUM LOD: Simple extruded building ---
    const medPositionsList: number[] = [];
    const medIndicesList: number[] = [];

    // Vertices: Bottom ring, then top ring
    for (let i = 0; i < numPoints; i++) {
      const pt = footprint[i];
      const bot = wgs84ToCartesian(pt[0], pt[1], 0);
      medPositionsList.push(...bot);
    }
    for (let i = 0; i < numPoints; i++) {
      const pt = footprint[i];
      const top = wgs84ToCartesian(pt[0], pt[1], height);
      medPositionsList.push(...top);
    }

    // Walls
    for (let i = 0; i < numPoints; i++) {
      const next = (i + 1) % numPoints;
      const bCurr = i;
      const bNext = next;
      const tCurr = i + numPoints;
      const tNext = next + numPoints;
      medIndicesList.push(bCurr, bNext, tNext);
      medIndicesList.push(bCurr, tNext, tCurr);
    }

    // Roof cap
    const roofOffset = numPoints;
    for (let i = 1; i < numPoints - 1; i++) {
      medIndicesList.push(roofOffset, roofOffset + i, roofOffset + i + 1);
    }

    const medMaterial: MaterialConfig = {
      type: 'solid',
      color: building.usageType === 'commercial' ? '#38bdf8' : building.usageType === 'industrial' ? '#f59e0b' : '#64748b'
    };

    const medMesh: MeshData = {
      positions: new Float64Array(medPositionsList),
      indices: new Uint32Array(medIndicesList),
      material: medMaterial,
      layerId: 'building'
    };

    // --- 3. CLOSE LOD: Reuse extruded geometry with enhanced visual material ---
    const closeMaterial: MaterialConfig = {
      type: 'solid',
      color: building.usageType === 'commercial' ? '#0ea5e9' : building.usageType === 'industrial' ? '#d97706' : '#4b5563' // High-quality contrasting colors
    };

    const closeMesh: MeshData = {
      positions: medMesh.positions, // REUSE same typed array coordinates (no allocation!)
      indices: medMesh.indices,     // REUSE same typed array indices
      material: closeMaterial,
      layerId: 'building'
    };

    return [farMesh, medMesh, closeMesh];
  }

  /** Ribbons over several paths merged into one buffer (pieces between junctions, or marking dashes). */
  private ribbonsOver(paths: readonly (readonly number[])[][], left: number, right: number, elevation = 0, thickness = 0): { positions: number[]; indices: number[] } {
    const positions: number[] = [];
    const indices: number[] = [];
    for (const piece of paths) {
      const r = this.generateRibbon(piece as [number, number, number][], left, right, elevation, thickness);
      const base = positions.length / 3;
      for (const v of r.positions) positions.push(v);
      for (const i of r.indices) indices.push(i + base);
    }
    return { positions, indices };
  }

  /**
   * One road marking line at a lateral offset: broken (IRC:35 mark/gap) when `mark` is given, else continuous.
   * Width and pattern come from standards/visualDims.ts.
   */
  private markingLine(
    paths: readonly (readonly number[])[][],
    offset: number,
    width: number,
    color: string,
    materialId: 'marking_white' | 'marking_yellow',
    layerId: MeshData['layerId'],
    pattern?: { mark: number; gap: number },
    lift = dim('markingLift')
  ): MeshData {
    const lines = pattern ? dashAll(paths as unknown as PathPt[][], pattern.mark, pattern.gap) : paths;
    const r = this.ribbonsOver(lines as unknown as number[][][], offset - width / 2, offset + width / 2, lift, 0);
    return {
      positions: new Float64Array(r.positions),
      indices: new Uint32Array(r.indices),
      material: { type: pattern ? 'dashed' : 'solid', color, materialId },
      layerId
    };
  }

  /**
   * Generates ECEF parallel ribbon geometries along a centerline path
   */
  private generateRibbon(
    coords: [number, number, number][],
    leftOffset: number,
    rightOffset: number,
    elevation: number = 0,
    thickness: number = 0
  ): { positions: number[]; indices: number[] } {
    const positions: number[] = [];
    const indices: number[] = [];
    const numPoints = coords.length;
    if (numPoints < 2) return { positions, indices };

    // 1. Calculate side offset vertices
    for (let i = 0; i < numPoints; i++) {
      const curr = coords[i];
      const next = coords[i + 1] || curr;
      const prev = coords[i - 1] || curr;

      const pCurr = wgs84ToCartesian(curr[0], curr[1], (curr[2] || 0) + elevation);

      // Ellipsoidal surface normal (up direction)
      const up = normalize(pCurr);

      // Path tangent in ECEF space
      const pNext = wgs84ToCartesian(next[0], next[1], (next[2] || 0) + elevation);
      const pPrev = wgs84ToCartesian(prev[0], prev[1], (prev[2] || 0) + elevation);
      const tangent = normalize([pNext[0] - pPrev[0], pNext[1] - pPrev[1], pNext[2] - pPrev[2]]);

      // Lateral vector (perpendicular to tangent and up, pointing right)
      const right = normalize(cross(tangent, up));

      // Compute left and right offset points
      const pLeft = [
        pCurr[0] + right[0] * leftOffset,
        pCurr[1] + right[1] * leftOffset,
        pCurr[2] + right[2] * leftOffset
      ];
      const pRight = [
        pCurr[0] + right[0] * rightOffset,
        pCurr[1] + right[1] * rightOffset,
        pCurr[2] + right[2] * rightOffset
      ];

      // Add to positions list
      positions.push(...pLeft, ...pRight);

      // If thickness is requested, add bottom vertices for 3D profiles
      if (thickness > 0) {
        const pLeftBot = [
          pLeft[0] - up[0] * thickness,
          pLeft[1] - up[1] * thickness,
          pLeft[2] - up[2] * thickness
        ];
        const pRightBot = [
          pRight[0] - up[0] * thickness,
          pRight[1] - up[1] * thickness,
          pRight[2] - up[2] * thickness
        ];
        positions.push(...pLeftBot, ...pRightBot);
      }
    }

    // 2. Generate quad indices
    const stride = thickness > 0 ? 4 : 2;
    for (let i = 0; i < numPoints - 1; i++) {
      const currIdx = i * stride;
      const nextIdx = (i + 1) * stride;

      const lCurr = currIdx;
      const rCurr = currIdx + 1;
      const lNext = nextIdx;
      const rNext = nextIdx + 1;

      // Triangle 1: left curr -> right curr -> right next
      indices.push(lCurr, rCurr, rNext);
      // Triangle 2: left curr -> right next -> left next
      indices.push(lCurr, rNext, lNext);

      // Add sides if thickness > 0
      if (thickness > 0) {
        const lCurrBot = currIdx + 2;
        const rCurrBot = currIdx + 3;
        const lNextBot = nextIdx + 2;
        const rNextBot = nextIdx + 3;

        // Top -> Bottom left wall
        indices.push(lCurr, lNext, lNextBot);
        indices.push(lCurr, lNextBot, lCurrBot);

        // Top -> Bottom right wall
        indices.push(rCurr, rNextBot, rNext);
        indices.push(rCurr, rCurrBot, rNextBot);
      }
    }

    return { positions, indices };
  }



  private calculateOffsetsForSection(section: any) {
    const hasMedian = section.hasMedian;
    const medianWidth = section.medianWidth || 0;
    const halfMedian = hasMedian ? medianWidth / 2 : 0;

    const A = section.carriagewayA;
    const B = section.carriagewayB;

    let carriageA_start = 0;
    let carriageA_end = 0;
    let carriageB_start = 0;
    let carriageB_end = 0;

    if (B) {
      // Divided road: centerline is the center of the median
      carriageA_start = -(halfMedian + A.lanes * A.laneWidth);
      carriageA_end = -halfMedian;

      carriageB_start = halfMedian;
      carriageB_end = halfMedian + B.lanes * B.laneWidth;
    } else {
      // Undivided road: centerline is the center of carriageway A's lanes
      const carriageWidth = A.lanes * A.laneWidth;
      carriageA_start = -carriageWidth / 2;
      carriageA_end = carriageWidth / 2;
    }

    // Left elements (start from carriage A's leftmost edge and expand left/outward)
    const leftElements = this.getRoadsideOffsets(A.leftRoadside, carriageA_start, -1);
    // Right elements of carriage A (only applicable for undivided roads or inner median side)
    const rightElementsA = this.getRoadsideOffsets(A.rightRoadside, carriageA_end, 1);

    let rightElementsB = null;
    let leftElementsB = null;

    if (B) {
      // B.rightRoadside expands right/outward from carriage B's rightmost edge
      rightElementsB = this.getRoadsideOffsets(B.rightRoadside, carriageB_end, 1);
      // B.leftRoadside (inner side of carriage B, facing median)
      leftElementsB = this.getRoadsideOffsets(B.leftRoadside, carriageB_start, -1);
    }

    return {
      median: [-halfMedian, halfMedian],
      carriageA: [carriageA_start, carriageA_end],
      carriageB: B ? [carriageB_start, carriageB_end] : null,
      leftA: leftElements,
      rightA: rightElementsA,
      leftB: leftElementsB,
      rightB: rightElementsB
    };
  }

  private getRoadsideOffsets(roadside: any, baseOffset: number, sign: number) {
    const hasElements = (roadside.footpathWidth || 0) > 0 ||
                        (roadside.cycleTrackWidth || 0) > 0 ||
                        (roadside.vergeWidth || 0) > 0 ||
                        (roadside.parkingWidth || 0) > 0 ||
                        (roadside.drainageWidth || 0) > 0;
    const curbWidth = hasElements ? 0.2 : 0;

    let current = baseOffset;

    // Curb
    const curbStart = current;
    current += sign * curbWidth;
    const curbEnd = current;

    // Footpath
    const fpStart = current;
    current += sign * (roadside.footpathWidth || 0);
    const fpEnd = current;

    // Cycle Track
    const ctStart = current;
    current += sign * (roadside.cycleTrackWidth || 0);
    const ctEnd = current;

    // Verge
    const vgStart = current;
    current += sign * (roadside.vergeWidth || 0);
    const vgEnd = current;

    // Parking
    const pkStart = current;
    current += sign * (roadside.parkingWidth || 0);
    const pkEnd = current;

    // Drainage
    const drStart = current;
    current += sign * (roadside.drainageWidth || 0);
    const drEnd = current;

    return {
      curb: [Math.min(curbStart, curbEnd), Math.max(curbStart, curbEnd)],
      footpath: [Math.min(fpStart, fpEnd), Math.max(fpStart, fpEnd)],
      cycleTrack: [Math.min(ctStart, ctEnd), Math.max(ctStart, ctEnd)],
      verge: [Math.min(vgStart, vgEnd), Math.max(vgStart, vgEnd)],
      parking: [Math.min(pkStart, pkEnd), Math.max(pkStart, pkEnd)],
      drainage: [Math.min(drStart, drEnd), Math.max(drStart, drEnd)]
    };
  }

  private generateRoadMeshes(road: RoadObject, allObjects?: GeometryContext): MeshData[] {
    const meshes: MeshData[] = [];
    const coords = road.coordinates;
    if (coords.length < 2) return meshes;

    let roadCoords = coords;
    // Bridges and roads on a raised OSM layer: their heights come from liftOsmBridges (ramped at the ends)
    const isBridge = isOsmBridge(road.osmProvenance) || elevatedLayer(road) > 0;
    // Tunnels and roads in a cut: their depths come from liftOsmBridges too, where something crosses over them
    const isTunnel = !!road.osmProvenance?.tunnel || depressedLevel(road) > 0;
    const bridgeElevation = 6.0;
    const maxElev = coords.reduce((max, c) => Math.max(max, c[2] || 0), 0);
    const minElev = coords.reduce((min, c) => Math.min(min, c[2] || 0), 0);

    if (isBridge && maxElev < 0.01) {
      // Heights not worked out (yet): draw the deck level at the usual height
      roadCoords = coords.map(c => [c[0], c[1], bridgeElevation]);
    } else if (isTunnel && minElev > -0.01) {
      // No depth worked out (nothing crosses over it): just below the surface
      roadCoords = coords.map(c => [c[0], c[1], -0.2]);
    } else if (isTunnel) {
      roadCoords = coords;
    } else {
      // Where roads overlap at a junction the bigger road lies on top, a few
      // centimetres up, so surfaces never flicker against each other and the
      // smaller road's markings stay under the bigger road's asphalt
      const lift = ROAD_CLASS_LIFT_M[road.roadClass] ?? 0;
      if (lift > 0) roadCoords = coords.map(c => [c[0], c[1], (c[2] || 0) + lift]);
    }


    // Use synthesized sections if not present
    const sections = road.sections && road.sections.length > 0
      ? road.sections
      : this.synthesizeDefaultSectionsForGenerator(road);

    // One asphalt grey, a shade darker for bigger roads: where roads overlap at a
    // junction the surface reads as one, not as patches of different colours
    let asphaltColor = '#2b313b'; // default: arterial
    if (road.roadClass === 'highway') {
      asphaltColor = '#262b34';
    } else if (road.roadClass === 'collector') {
      asphaltColor = '#30363f';
    } else if (road.roadClass === 'local') {
      asphaltColor = '#353b45';
    }

    for (const section of sections) {
      const startIdx = Math.max(0, Math.min(section.startNodeIndex, coords.length - 1));
      const endIdx = Math.max(startIdx, Math.min(section.endNodeIndex, coords.length - 1));
      if (endIdx - startIdx < 1) continue;

      let sectionCoords = roadCoords.slice(startIdx, endIdx + 1);
      // Terrain on: at-grade roads are subdivided where the ground bends between vertices (no chording through or
      // floating over a hill) and follow a 30 m moving-median profile (DSM canopy / roof bumps removed, never more
      // than 0.3 m below the ground). Bridges, cuts and tunnels keep their worked-out levels.
      if (getGroundField() && !isBridge && !isTunnel) {
        sectionCoords = fitToTerrain(sectionCoords as PathPt[], groundAt);
      }
      const offsets = this.calculateOffsetsForSection(section);

      // Keep the road surface continuous. The junction surface overlaps its approaches.
      // Footpaths, kerbs, medians and lane markings stop where other roads meet or
      // cross this one, so junctions are clean asphalt rather than criss-crossed
      const pieces = this.junctionPieces(sectionCoords, road, allObjects);
      // One-way roads and ramps: IRC:35-2015 §4.8.1 shorter pattern (1.5 m / 3 m); otherwise 3 m / 6 m
      const laneDash = road.isOneWay
        ? { mark: dim('rampLineMark'), gap: dim('rampLineGap') }
        : { mark: dim('laneLineMark'), gap: dim('laneLineGap') };
      const onPieces = (left: number, right: number, elevation = 0, thickness = 0) => {
        const positions: number[] = [];
        const indices: number[] = [];
        for (const piece of pieces) {
          const r = this.generateRibbon(piece as [number, number, number][], left, right, elevation, thickness);
          const base = positions.length / 3;
          positions.push(...r.positions);
          for (const i of r.indices) indices.push(i + base);
        }
        return { positions, indices };
      };

      // 1. Asphalt (Carriageway A)
      if (offsets.carriageA[1] - offsets.carriageA[0] > 0.1) {
        const asphaltA = this.generateRibbon(sectionCoords, offsets.carriageA[0], offsets.carriageA[1], 0);
        meshes.push({
          positions: new Float64Array(asphaltA.positions),
          indices: new Uint32Array(asphaltA.indices),
          material: { type: 'solid', color: asphaltColor },
          layerId: 'asphalt'
        });

        // 1b. Lane lines for Carriageway A: IRC:35-2015 broken white, 150 mm, 3 m mark / 6 m gap (urban)
        const lanesA = section.carriagewayA.lanes;
        if (lanesA > 1) {
          const A_width = offsets.carriageA[1] - offsets.carriageA[0];
          const laneW = A_width / lanesA;
          for (let i = 1; i < lanesA; i++) {
            const offsetMark = offsets.carriageA[0] + i * laneW;
            meshes.push(this.markingLine(pieces, offsetMark, dim('laneLineWidth'), '#e2e8f0', 'marking_white', 'marking', laneDash));
          }
        }
      }

      // 2. Asphalt (Carriageway B)
      if (offsets.carriageB && (offsets.carriageB[1] - offsets.carriageB[0] > 0.1)) {
        const asphaltB = this.generateRibbon(sectionCoords, offsets.carriageB[0], offsets.carriageB[1], 0);
        meshes.push({
          positions: new Float64Array(asphaltB.positions),
          indices: new Uint32Array(asphaltB.indices),
          material: { type: 'solid', color: asphaltColor },
          layerId: 'asphalt'
        });

        // 2b. Lane lines for Carriageway B (as A)
        const lanesB = section.carriagewayB.lanes;
        if (lanesB > 1) {
          const B_width = offsets.carriageB[1] - offsets.carriageB[0];
          const laneW = B_width / lanesB;
          for (let i = 1; i < lanesB; i++) {
            const offsetMark = offsets.carriageB[0] + i * laneW;
            meshes.push(this.markingLine(pieces, offsetMark, dim('laneLineWidth'), '#e2e8f0', 'marking_white', 'marking', laneDash));
          }
        }
      }

      // 2c. Centre line on undivided two-way roads: IRC:35-2015 §4.6.1 white broken 3 m / 6 m, 150 mm urban
      // (yellow is for no-overtaking sections only; the earlier US-style double yellow is not an Indian marking)
      if (offsets.carriageB && !section.hasMedian) {
        meshes.push(this.markingLine(pieces, offsets.carriageA[1], dim('centreLineWidth'), '#e2e8f0', 'marking_white', 'marking',
          { mark: dim('centreLineMark'), gap: dim('centreLineGap') }));
      }

      // 2d. Divided roads, two or more lanes a side: edge lines 150 mm (IRC:35 §4.5.3), 0.1 m off the kerb (CoP-3);
      // the median-side line yellow (CoP-3 §(3))
      if (section.hasMedian && offsets.carriageB) {
        const off = dim('edgeLineOffset') + dim('edgeLineWidth') / 2;
        const w = dim('edgeLineWidth');
        if (section.carriagewayA.lanes >= 2) {
          meshes.push(this.markingLine(pieces, offsets.carriageA[0] + off, w, '#e2e8f0', 'marking_white', 'marking'));
          meshes.push(this.markingLine(pieces, offsets.carriageA[1] - off, w, '#eab308', 'marking_yellow', 'marking'));
        }
        if (section.carriagewayB.lanes >= 2) {
          meshes.push(this.markingLine(pieces, offsets.carriageB[0] + off, w, '#eab308', 'marking_yellow', 'marking'));
          meshes.push(this.markingLine(pieces, offsets.carriageB[1] - off, w, '#e2e8f0', 'marking_white', 'marking'));
        }
      }

      // 3. Central Median
      if (section.hasMedian && section.medianWidth > 0) {
        const divider = onPieces(offsets.median[0], offsets.median[1], 0.15, 0.15);
        meshes.push({
          positions: new Float64Array(divider.positions),
          indices: new Uint32Array(divider.indices),
          material: { type: 'solid', color: '#334155' },
          layerId: 'divider'
        });
      }

      // 4. Roadside Elements Helper
      const generateRoadside = (elements: any) => {
        if (!elements) return;

        // Skip curbs, footpaths, cycle tracks for tunnels
        if (isTunnel) return;

        // Kerb and footpath: 150 mm above the road (PMC USDG §3.1 maximum; IRC:86-2018), was 0.22 m
        const kerbH = dim('kerbHeight');
        if (elements.curb[1] - elements.curb[0] > 0.05) {
          const curb = onPieces(elements.curb[0], elements.curb[1], kerbH, kerbH);
          meshes.push({
            positions: new Float64Array(curb.positions),
            indices: new Uint32Array(curb.indices),
            material: { type: 'solid', color: '#4b5563' },
            layerId: 'curb'
          });
        }

        if (elements.footpath[1] - elements.footpath[0] > 0.05) {
          const fp = onPieces(elements.footpath[0], elements.footpath[1], kerbH, kerbH);
          meshes.push({
            positions: new Float64Array(fp.positions),
            indices: new Uint32Array(fp.indices),
            material: { type: 'solid', color: '#475569' },
            layerId: 'sidewalk'
          });
        }

        // Cycle Track (extruded 0.05m)
        if (elements.cycleTrack[1] - elements.cycleTrack[0] > 0.05) {
          const ct = onPieces(elements.cycleTrack[0], elements.cycleTrack[1], 0.05, 0.05);
          meshes.push({
            positions: new Float64Array(ct.positions),
            indices: new Uint32Array(ct.indices),
            material: { type: 'solid', color: '#065f46' },
            layerId: 'cycleway'
          });
        }

        // Verge (extruded 0.02m)
        if (elements.verge[1] - elements.verge[0] > 0.05) {
          const vg = onPieces(elements.verge[0], elements.verge[1], 0.02, 0.02);
          meshes.push({
            positions: new Float64Array(vg.positions),
            indices: new Uint32Array(vg.indices),
            material: { type: 'solid', color: '#15803d' },
            layerId: 'verge'
          });
        }

        // Parking (extruded 0.0m)
        if (elements.parking[1] - elements.parking[0] > 0.05) {
          const pk = onPieces(elements.parking[0], elements.parking[1], 0);
          meshes.push({
            positions: new Float64Array(pk.positions),
            indices: new Uint32Array(pk.indices),
            material: { type: 'solid', color: '#475569' },
            layerId: 'parking'
          });
        }

        // Drainage (extruded 0.0m, or slightly lower)
        if (elements.drainage[1] - elements.drainage[0] > 0.05) {
          const dr = onPieces(elements.drainage[0], elements.drainage[1], -0.1, 0.1);
          meshes.push({
            positions: new Float64Array(dr.positions),
            indices: new Uint32Array(dr.indices),
            material: { type: 'solid', color: '#1f2937' },
            layerId: 'drainage'
          });
        }
      };

      // Generate for all roadsides
      generateRoadside(offsets.leftA);
      generateRoadside(offsets.rightA);
      generateRoadside(offsets.leftB);
      generateRoadside(offsets.rightB);

      // 5. Bridge deck: a pale concrete slab with parapet walls, so a deck reads
      // clearly against the dark roads beneath it
      if (isBridge) {
        const roadWidth = road.width || (offsets.carriageA[1] - offsets.carriageA[0]) * 2;
        const halfW = roadWidth / 2;
        const slab = this.generateRibbon(sectionCoords, -halfW, halfW, -0.05, 1.1);
        meshes.push({
          positions: new Float64Array(slab.positions),
          indices: new Uint32Array(slab.indices),
          material: { type: 'solid', color: '#a8b3c1' },
          layerId: 'transit_deck'
        });
        for (const [from, to] of [[-halfW, -halfW + 0.35], [halfW - 0.35, halfW]]) {
          // Broken where another deck joins, so merging carriageways do not wall each other off
          const parapet = onPieces(from, to, 0.95, 1.0);
          meshes.push({
            positions: new Float64Array(parapet.positions),
            indices: new Uint32Array(parapet.indices),
            material: { type: 'solid', color: '#e2e8f0' },
            layerId: 'transit_deck'
          });
        }
      }
    }

    // 6. Generate bridge concrete pillars if needed
    if (isBridge) {
      const pierSpacing = 30; // 30m spacing
      const pillars = this.generatePillarsAlongCenterline(
        roadCoords,
        undefined,
        0, // Coords already contain the deck elevation (Z = 6.0)
        pierSpacing,
        'transit_pillars'
      );
      meshes.push(...pillars);
    }

    return meshes;
  }

  /** The pieces of a road's centre line between the places other roads meet or cross it. */
  private junctionPieces(path: [number, number, number][], road: RoadObject, allObjects?: GeometryContext): number[][][] {
    if (!allObjects || path.length < 2) return [path];
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const p of path) {
      minLng = Math.min(minLng, p[0]); maxLng = Math.max(maxLng, p[0]);
      minLat = Math.min(minLat, p[1]); maxLat = Math.max(maxLat, p[1]);
    }
    const pad = 0.0003; // about 30 m: widest roads plus the T-junction reach
    const gaps: Gap[] = [];
    for (const other of allObjects.drivablesNear(minLng - pad, minLat - pad, maxLng + pad, maxLat + pad)) {
      if (other.id === road.id) continue;
      // The other road's surface, as drawn: its class lift on top of its points
      const lift = other.type === 'road' && !isOsmBridge(other.osmProvenance) && elevatedLayer(other) === 0 && depressedLevel(other) === 0 ? ROAD_CLASS_LIFT_M[other.roadClass] ?? 0 : 0;
      const coordinates = lift ? other.coordinates.map(c => [c[0], c[1], (c[2] || 0) + lift]) : other.coordinates;
      gaps.push(...crossingGaps(path, { coordinates, width: other.width || 10 }));
    }
    return gaps.length > 0 ? piecesBetween(path, gaps) : [path];
  }

  private synthesizeDefaultSectionsForGenerator(road: RoadObject): any[] {
    const laneWidth = road.laneWidth || 3.5;
    const laneCount = road.laneCount || 2;
    const dividerWidth = road.dividerWidth || 0;
    const hasDivider = road.hasDivider || (dividerWidth > 0);
    const hasFootpath = road.hasFootpath || false;
    const footpathWidth = road.footpathWidth || 1.5;

    let lanesA = laneCount;
    let lanesB = 0;
    if (hasDivider) {
      lanesA = Math.ceil(laneCount / 2);
      lanesB = Math.floor(laneCount / 2);
    } else if (!road.isOneWay) {
      lanesA = Math.ceil(laneCount / 2);
      lanesB = Math.floor(laneCount / 2);
    }

    const leftRoadside = {
      footpathWidth: hasFootpath ? footpathWidth : 0,
      cycleTrackWidth: 0,
      vergeWidth: 0,
      parkingWidth: 0,
      drainageWidth: 0
    };

    const rightRoadside = {
      footpathWidth: (hasFootpath && !hasDivider && lanesB > 0) || (hasFootpath && hasDivider) ? footpathWidth : 0,
      cycleTrackWidth: 0,
      vergeWidth: 0,
      parkingWidth: 0,
      drainageWidth: 0
    };

    const carriagewayA = {
      direction: road.isOneWay ? 'forward' : 'both',
      lanes: lanesA,
      laneWidth,
      leftRoadside: leftRoadside,
      rightRoadside: { footpathWidth: 0, cycleTrackWidth: 0, vergeWidth: 0, parkingWidth: 0, drainageWidth: 0 }
    };

    let carriagewayB = undefined;
    if (lanesB > 0) {
      carriagewayB = {
        direction: 'backward',
        lanes: lanesB,
        laneWidth,
        leftRoadside: { footpathWidth: 0, cycleTrackWidth: 0, vergeWidth: 0, parkingWidth: 0, drainageWidth: 0 },
        rightRoadside: rightRoadside
      };
    } else if (!hasDivider && !road.isOneWay) {
      carriagewayA.rightRoadside = rightRoadside;
    } else if (road.isOneWay) {
      carriagewayA.rightRoadside = rightRoadside;
    }

    return [{
      startNodeIndex: 0,
      endNodeIndex: Math.max(0, road.coordinates.length - 1),
      totalRowWidth: road.width || (laneCount * laneWidth + dividerWidth + (hasFootpath ? footpathWidth * 2 : 0)),
      wideningPossible: true,
      hasMedian: hasDivider,
      medianWidth: dividerWidth,
      carriagewayA,
      carriagewayB,
      reservedSpaces: [],
      provenance: {
        originalSource: 'OSM',
        originalConfidence: 'estimated',
        geometryModified: false,
        profileModified: false,
        lastModifiedBy: 'importer',
        verificationStatus: 'unverified'
      }
    }];
  }

  /**
   * Generates procedural meshes for flyovers, including concrete pillars
   */
  private generateFlyoverMeshes(flyover: FlyoverObject): MeshData[] {
    const meshes: MeshData[] = [];
    const coords = flyover.coordinates;
    if (coords.length < 2) return meshes;

    const laneWidth = flyover.laneWidth || 3.5;
    const laneCount = flyover.laneCount || 2;
    const dividerWidth = flyover.hasDivider ? (flyover.dividerWidth || 2.0) : 0;
    const asphaltWidth = laneCount * laneWidth + dividerWidth;
    const slabWidth = asphaltWidth + 1.2;

    // ─── Legend colours (Schematic); Realistic draws the materialId ─────────────
    const COLOR_SLAB       = '#94a3b8'; // light concrete — clearly lighter than asphalt
    const COLOR_ASPHALT    = flyover.roadClass === 'highway' ? '#0a0f1a' : '#111827'; // near-black
    const COLOR_BARRIER    = '#94a3b8'; // same as slab — continuous parapet appearance
    const COLOR_DIVIDER    = '#e2e8f0'; // near-white — divider stands out strongly

    // 1. Asphalt driving surface first: traffic tint colours the first deck instance of an object
    const asphalt = this.generateRibbon(coords, -asphaltWidth / 2, asphaltWidth / 2, 0.02, 0);
    meshes.push({
      positions: new Float64Array(asphalt.positions),
      indices: new Uint32Array(asphalt.indices),
      material: { type: 'solid', color: COLOR_ASPHALT, materialId: 'asphalt_deck' },
      layerId: 'transit_deck'
    });

    // 2. Box-girder deck (single cell, cantilever wings): depth 2.0 m, soffit half the deck width — both ASSUMED
    // (no sourced figure; visualDims). Replaces the 0.3 m slab and the two "girder" strips.
    const girderDepth = dim('flyoverGirderDepth');
    const soffit = slabWidth * dim('flyoverSoffitRatio');
    const girder = extrudeProfile(coords, boxGirderProfile(slabWidth, girderDepth, soffit), wgs84ToCartesian, 0);
    meshes.push({
      positions: new Float64Array(girder.positions),
      indices: new Uint32Array(girder.indices),
      material: { type: 'solid', color: COLOR_SLAB, materialId: 'concrete_deck' },
      layerId: 'transit_deck'
    });

    // 3. Crash barriers / parapets: Jersey safety shape, 1.0 m (height ASSUMED; IRC:5 not read)
    for (const side of [-1, 1] as const) {
      const parapet = extrudeProfile(coords, jerseyParapetProfile(side * slabWidth / 2, side), wgs84ToCartesian, 0);
      meshes.push({
        positions: new Float64Array(parapet.positions),
        indices: new Uint32Array(parapet.indices),
        material: { type: 'solid', color: COLOR_BARRIER, materialId: 'concrete_barrier' },
        layerId: 'transit_deck_details'
      });
    }

    // 4. Central divider: Jersey median barrier (no amber stripe: it is not an IRC:35 marking)
    if (flyover.hasDivider && dividerWidth > 0.1) {
      const divider = extrudeProfile(coords, jerseyMedianProfile(), wgs84ToCartesian, 0.02);
      meshes.push({
        positions: new Float64Array(divider.positions),
        indices: new Uint32Array(divider.indices),
        material: { type: 'solid', color: COLOR_DIVIDER, materialId: 'concrete_barrier' },
        layerId: 'transit_deck_details'
      });
    } else if (!flyover.isOneWay) {
      // Undivided: IRC:35-2015 §4.6.1 white broken centre line (was a US-style double yellow)
      meshes.push(this.markingLine([coords], 0, dim('centreLineWidth'), '#e2e8f0', 'marking_white', 'transit_deck',
        { mark: dim('centreLineMark'), gap: dim('centreLineGap') }, 0.03));
    }

    // 5. White lane separator markings
    const lanesA = Math.ceil(laneCount / (flyover.isOneWay ? 1 : 2));
    const lanesB = flyover.isOneWay ? 0 : Math.floor(laneCount / 2);

    if (lanesA > 1) {
      const startOffset = -asphaltWidth / 2;
      for (let i = 1; i < lanesA; i++) {
        const offset = startOffset + i * laneWidth;
        // IRC:35-2015 lane line, 150 mm, 3 m / 6 m
        meshes.push(this.markingLine([coords], offset, dim('laneLineWidth'), '#e2e8f0', 'marking_white', 'transit_deck',
          { mark: dim('laneLineMark'), gap: dim('laneLineGap') }, 0.03));
      }
    }
    if (lanesB > 1) {
      const startOffset = flyover.hasDivider ? dividerWidth / 2 : 0;
      for (let i = 1; i < lanesB; i++) {
        const offset = startOffset + i * laneWidth;
        // IRC:35-2015 lane line, 150 mm, 3 m / 6 m
        meshes.push(this.markingLine([coords], offset, dim('laneLineWidth'), '#e2e8f0', 'marking_white', 'transit_deck',
          { mark: dim('laneLineMark'), gap: dim('laneLineGap') }, 0.03));
      }
    }

    // 7. Piers and pier caps under the girder soffit; span 30 m ASSUMED when the object has none
    const pierSpacing = flyover.pierSpacing || dim('flyoverSpan');
    const pillarMeshes = this.generateFlyoverPillars(flyover, slabWidth, pierSpacing, girderDepth, soffit);
    meshes.push(...pillarMeshes);

    // 8. Ramp side walls (abutments) — solid concrete side walls down to ground
    const abutments = this.generateFlyoverRampAbutments(flyover, slabWidth);
    meshes.push(...abutments);

    // 9. Ramp nose wedges — tapered solid fill at ramp feet to look like real abutments
    const noseWedges = this.generateRampNoseWedges(flyover, slabWidth);
    meshes.push(...noseWedges);

    return meshes;
  }

  private generateFlyoverPillars(
    flyover: FlyoverObject,
    deckSlabWidth: number,
    spacing: number,
    girderDepth = dim('flyoverGirderDepth'),
    soffitWidth = deckSlabWidth * dim('flyoverSoffitRatio')
  ): MeshData[] {
    const pillars: MeshData[] = [];
    const coords = flyover.coordinates;
    if (coords.length < 2) return pillars;

    const groundCoords = flyover.groundCoordinates;

    // Subsample positions along path based on spacing
    const distanceList: number[] = [0];
    let totalDist = 0;
    for (let i = 1; i < coords.length; i++) {
      const p1 = wgs84ToCartesian(coords[i - 1][0], coords[i - 1][1], 0);
      const p2 = wgs84ToCartesian(coords[i][0], coords[i][1], 0);
      const dist = Math.sqrt(
        (p2[0] - p1[0]) ** 2 +
        (p2[1] - p1[1]) ** 2 +
        (p2[2] - p1[2]) ** 2
      );
      totalDist += dist;
      distanceList.push(totalDist);
    }

    let currentMarker = spacing / 2; // Offset first column from ramp start
    while (currentMarker < totalDist) {
      // Find segment matching the cumulative distance
      let idx = 0;
      while (idx < distanceList.length - 1 && distanceList[idx + 1] < currentMarker) {
        idx++;
      }

      // Interpolate along the matched segment
      const segmentStartDist = distanceList[idx];
      const segmentEndDist = distanceList[idx + 1];
      const t = (currentMarker - segmentStartDist) / (segmentEndDist - segmentStartDist);

      const pStart = coords[idx];
      const pEnd = coords[idx + 1];
      const interpLng = pStart[0] + (pEnd[0] - pStart[0]) * t;
      const interpLat = pStart[1] + (pEnd[1] - pStart[1]) * t;

      // Interpolate deck Z height
      const startZ = pStart[2] || 0;
      const endZ = pEnd[2] || 0;
      const deckZ = startZ + (endZ - startZ) * t;

      // Interpolate ground Z height
      let groundZ = 0;
      if (groundCoords && groundCoords[idx] && groundCoords[idx + 1]) {
        const gStart = groundCoords[idx][2] || 0;
        const gEnd = groundCoords[idx + 1][2] || 0;
        groundZ = gStart + (gEnd - gStart) * t;
      }

      // Elevation height check: Ramps ascend from 0 to target elevation.
      // Do not render pillars where the deck is close to the ground (height < 3.0 meters)
      const deckHeight = deckZ - groundZ;
      if (deckHeight >= 3.0) {
        // Calculate tangent vector at this segment for alignment
        const tangentECEF = ecefTangent(pStart, pEnd); // ECEF direction (was lng/lat degrees, which mis-rotated piers and caps)

        // --- 2. Tapered Rectangular Pier (Pillar) ---
        // Scale pillar width relative to deck width to look structurally sound (like metro)
        const topWidth = Math.max(2.0, deckSlabWidth * 0.4);
        const topLength = 1.4; // longitudinal length
        const botWidth = topWidth * 0.8;
        const botLength = 1.2;

        // Column up to the pier cap, which sits under the girder soffit (deck top − girder depth − cap depth)
        const capDepth = dim('pierCapDepth');
        const capTop = deckZ - girderDepth;
        const pillarHeight = deckHeight - girderDepth - capDepth;

        if (pillarHeight > 0.5) {
          const pillar = this.generateTaperedRectangularPier(
            interpLng,
            interpLat,
            pillarHeight,
            topWidth,
            topLength,
            botWidth,
            botLength,
            groundZ,
            tangentECEF,
            'transit_pillars'
          );
          pillars.push(pillar);

          // --- 3. Pier cap (LOD details): 0.5 m wider than the soffit each side, depth/length ASSUMED (visualDims)
          const cap = this.generateRectangularBox(
            interpLng,
            interpLat,
            capTop - capDepth,
            capDepth,
            Math.max(topWidth + 0.6, soffitWidth + 1.0),
            dim('pierCapLength'),
            tangentECEF,
            '#64748b', // Concrete cap grey
            'transit_pillars_details'
          );
          pillars.push(cap);
        }
      }

      currentMarker += spacing;
    }

    return pillars;
  }

  private generateTaperedRectangularPier(
    lng: number,
    lat: number,
    height: number,
    topW: number,
    topL: number,
    botW: number,
    botL: number,
    baseElevation: number,
    tangent: [number, number, number],
    layerId?: any
  ): MeshData {
    const base = wgs84ToCartesian(lng, lat, baseElevation);
    const u = normalize(base);
    const r = normalize(cross(tangent, u));
    const f = normalize(cross(u, r));

    const positionsList: number[] = [];
    const indicesList: number[] = [];

    // Bottom 4 vertices
    const halfBotW = botW / 2;
    const halfBotL = botL / 2;
    const botOffsets = [
      [-halfBotW, -halfBotL],
      [halfBotW, -halfBotL],
      [halfBotW, halfBotL],
      [-halfBotW, halfBotL]
    ];

    botOffsets.forEach(off => {
      const pt = [
        base[0] + r[0] * off[0] + f[0] * off[1],
        base[1] + r[1] * off[0] + f[1] * off[1],
        base[2] + r[2] * off[0] + f[2] * off[1]
      ];
      positionsList.push(...pt);
    });

    // Top 4 vertices
    const topBase = wgs84ToCartesian(lng, lat, baseElevation + height);
    const halfTopW = topW / 2;
    const halfTopL = topL / 2;
    const topOffsets = [
      [-halfTopW, -halfTopL],
      [halfTopW, -halfTopL],
      [halfTopW, halfTopL],
      [-halfTopW, halfTopL]
    ];

    topOffsets.forEach(off => {
      const pt = [
        topBase[0] + r[0] * off[0] + f[0] * off[1],
        topBase[1] + r[1] * off[0] + f[1] * off[1],
        topBase[2] + r[2] * off[0] + f[2] * off[1]
      ];
      positionsList.push(...pt);
    });

    // Side faces indices
    indicesList.push(0, 1, 5, 0, 5, 4);
    indicesList.push(1, 2, 6, 1, 6, 5);
    indicesList.push(2, 3, 7, 2, 7, 6);
    indicesList.push(3, 0, 4, 3, 4, 7);

    return {
      positions: new Float64Array(positionsList),
      indices: new Uint32Array(indicesList),
      material: { type: 'solid', color: '#64748b' },
      layerId
    };
  }

  private generateRectangularBox(
    lng: number,
    lat: number,
    baseElevation: number,
    boxHeight: number,
    boxWidth: number,
    boxLength: number,
    tangent: [number, number, number],
    color = '#64748b',
    layerId?: any
  ): MeshData {
    const base = wgs84ToCartesian(lng, lat, baseElevation);
    const u = normalize(base);
    const r = normalize(cross(tangent, u));
    const f = normalize(cross(u, r));

    const positionsList: number[] = [];
    const indicesList: number[] = [];

    const halfW = boxWidth / 2;
    const halfL = boxLength / 2;

    const offsets = [
      [-halfW, -halfL],
      [halfW, -halfL],
      [halfW, halfL],
      [-halfW, halfL]
    ];

    // Bottom 4 vertices
    offsets.forEach(off => {
      const pt = [
        base[0] + r[0] * off[0] + f[0] * off[1],
        base[1] + r[1] * off[0] + f[1] * off[1],
        base[2] + r[2] * off[0] + f[2] * off[1]
      ];
      positionsList.push(...pt);
    });

    // Top 4 vertices
    const topBase = wgs84ToCartesian(lng, lat, baseElevation + boxHeight);
    offsets.forEach(off => {
      const pt = [
        topBase[0] + r[0] * off[0] + f[0] * off[1],
        topBase[1] + r[1] * off[0] + f[1] * off[1],
        topBase[2] + r[2] * off[0] + f[2] * off[1]
      ];
      positionsList.push(...pt);
    });

    // Side faces indices
    indicesList.push(0, 1, 5, 0, 5, 4);
    indicesList.push(1, 2, 6, 1, 6, 5);
    indicesList.push(2, 3, 7, 2, 7, 6);
    indicesList.push(3, 0, 4, 3, 4, 7);

    // Top face
    indicesList.push(4, 5, 6, 4, 6, 7);

    return {
      positions: new Float64Array(positionsList),
      indices: new Uint32Array(indicesList),
      material: { type: 'solid', color },
      layerId
    };
  }

  private generateFlyoverRampAbutments(flyover: FlyoverObject, deckSlabWidth: number): MeshData[] {
    const meshes: MeshData[] = [];
    const coords = flyover.coordinates;
    const groundCoords = flyover.groundCoordinates;
    if (!groundCoords || coords.length < 2) return meshes;

    const positionsList: number[] = [];
    const indicesList: number[] = [];
    let indexOffset = 0;

    // Half width of the slab
    const halfW = deckSlabWidth / 2;

    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const g1 = groundCoords[i];
      const g2 = groundCoords[i + 1];

      // Calculate heights
      const h1 = (p1[2] || 0) - (g1[2] || 0);
      const h2 = (p2[2] || 0) - (g2[2] || 0);

      // Solid ramp walls where the deck is too low for a pier under the box girder and its cap
      // (girder depth + cap depth + 0.5 m; all ASSUMED, visualDims) — the RE-wall part of a ramp (IRC:SP:90 §7.2)
      const wallMax = dim('flyoverGirderDepth') + dim('pierCapDepth') + 0.5;
      if (h1 >= wallMax && h2 >= wallMax) continue;

      // Calculate tangent to get perpendicular left/right vectors
      const c1 = wgs84ToCartesian(p1[0], p1[1], 0);
      const c2 = wgs84ToCartesian(p2[0], p2[1], 0);

      // Normalizing vectors (length)
      const dx = c2[0] - c1[0];
      const dy = c2[1] - c1[1];
      const dz = c2[2] - c1[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const tangent = [dx / len, dy / len, dz / len] as [number, number, number];

      const up1 = normalize(wgs84ToCartesian(p1[0], p1[1], p1[2] || 0));
      const right1 = normalize(cross(tangent, up1));

      const up2 = normalize(wgs84ToCartesian(p2[0], p2[1], p2[2] || 0));
      const right2 = normalize(cross(tangent, up2));

      // 4 points for Left Wall
      const deckLeft1 = wgs84ToCartesian(p1[0], p1[1], p1[2]);
      deckLeft1[0] -= right1[0] * halfW;
      deckLeft1[1] -= right1[1] * halfW;
      deckLeft1[2] -= right1[2] * halfW;

      const groundLeft1 = wgs84ToCartesian(g1[0], g1[1], g1[2]);
      groundLeft1[0] -= right1[0] * halfW;
      groundLeft1[1] -= right1[1] * halfW;
      groundLeft1[2] -= right1[2] * halfW;

      const deckLeft2 = wgs84ToCartesian(p2[0], p2[1], p2[2]);
      deckLeft2[0] -= right2[0] * halfW;
      deckLeft2[1] -= right2[1] * halfW;
      deckLeft2[2] -= right2[2] * halfW;

      const groundLeft2 = wgs84ToCartesian(g2[0], g2[1], g2[2]);
      groundLeft2[0] -= right2[0] * halfW;
      groundLeft2[1] -= right2[1] * halfW;
      groundLeft2[2] -= right2[2] * halfW;

      // Left Wall Quads (counter-clockwise)
      positionsList.push(...deckLeft1, ...groundLeft1, ...groundLeft2, ...deckLeft2);
      indicesList.push(
        indexOffset, indexOffset + 1, indexOffset + 2,
        indexOffset, indexOffset + 2, indexOffset + 3
      );
      indexOffset += 4;

      // 4 points for Right Wall
      const deckRight1 = wgs84ToCartesian(p1[0], p1[1], p1[2]);
      deckRight1[0] += right1[0] * halfW;
      deckRight1[1] += right1[1] * halfW;
      deckRight1[2] += right1[2] * halfW;

      const groundRight1 = wgs84ToCartesian(g1[0], g1[1], g1[2]);
      groundRight1[0] += right1[0] * halfW;
      groundRight1[1] += right1[1] * halfW;
      groundRight1[2] += right1[2] * halfW;

      const deckRight2 = wgs84ToCartesian(p2[0], p2[1], p2[2]);
      deckRight2[0] += right2[0] * halfW;
      deckRight2[1] += right2[1] * halfW;
      deckRight2[2] += right2[2] * halfW;

      const groundRight2 = wgs84ToCartesian(g2[0], g2[1], g2[2]);
      groundRight2[0] += right2[0] * halfW;
      groundRight2[1] += right2[1] * halfW;
      groundRight2[2] += right2[2] * halfW;

      // Right Wall Quads (reverse winding)
      positionsList.push(...deckRight1, ...deckRight2, ...groundRight2, ...groundRight1);
      indicesList.push(
        indexOffset, indexOffset + 1, indexOffset + 2,
        indexOffset, indexOffset + 2, indexOffset + 3
      );
      indexOffset += 4;
    }

    if (positionsList.length > 0) {
      meshes.push({
        positions: new Float64Array(positionsList),
        indices: new Uint32Array(indicesList),
        material: { type: 'solid', color: '#64748b' }, // Mid concrete grey for abutment walls
        layerId: 'transit_deck_details'
      });
    }

    return meshes;
  }

  /**
   * Generates solid tapered wedge geometry at both ramp feet — the visual transition
   * from deck to ground that makes a flyover look like a real bridge abutment.
   * Only renders where deckHeight is between 0 and 3.5m (the ramp zone).
   */
  private generateRampNoseWedges(flyover: FlyoverObject, deckSlabWidth: number): MeshData[] {
    const meshes: MeshData[] = [];
    const coords = flyover.coordinates;
    const groundCoords = flyover.groundCoordinates;
    if (!groundCoords || coords.length < 2) return meshes;

    const halfW = deckSlabWidth / 2;
    const positionsList: number[] = [];
    const indicesList: number[] = [];
    let idxOffset = 0;

    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const g1 = groundCoords[i];
      const g2 = groundCoords[i + 1];

      const h1 = (p1[2] || 0) - (g1[2] || 0);
      const h2 = (p2[2] || 0) - (g2[2] || 0);

      // Only at the very ramp feet (height between 0 and 2m)
      if (h1 > 2.0 && h2 > 2.0) continue;
      if (h1 <= 0 && h2 <= 0) continue;

      // Build tangent / right vectors at this segment
      const c1 = wgs84ToCartesian(p1[0], p1[1], 0);
      const c2 = wgs84ToCartesian(p2[0], p2[1], 0);
      const dx = c2[0] - c1[0], dy = c2[1] - c1[1], dz = c2[2] - c1[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const tangent = [dx / len, dy / len, dz / len] as [number, number, number];

      const deckPt1 = wgs84ToCartesian(p1[0], p1[1], p1[2] || 0);
      const up1 = normalize(deckPt1);
      const right1 = normalize(cross(tangent, up1));
      const deckPt2 = wgs84ToCartesian(p2[0], p2[1], p2[2] || 0);
      const up2 = normalize(deckPt2);
      const right2 = normalize(cross(tangent, up2));

      // Front face of the wedge: a quad from left-deck-bottom to right-deck-bottom,
      // down to ground level. This fills the triangular gap at the ramp nose.
      const deckBotL1 = [deckPt1[0] - up1[0] * 0.3 - right1[0] * halfW,
                         deckPt1[1] - up1[1] * 0.3 - right1[1] * halfW,
                         deckPt1[2] - up1[2] * 0.3 - right1[2] * halfW];
      const deckBotR1 = [deckPt1[0] - up1[0] * 0.3 + right1[0] * halfW,
                         deckPt1[1] - up1[1] * 0.3 + right1[1] * halfW,
                         deckPt1[2] - up1[2] * 0.3 + right1[2] * halfW];
      const gndL1 = wgs84ToCartesian(g1[0], g1[1], g1[2] || 0);
      gndL1[0] -= right1[0] * halfW; gndL1[1] -= right1[1] * halfW; gndL1[2] -= right1[2] * halfW;
      const gndR1 = wgs84ToCartesian(g1[0], g1[1], g1[2] || 0);
      gndR1[0] += right1[0] * halfW; gndR1[1] += right1[1] * halfW; gndR1[2] += right1[2] * halfW;

      const deckBotL2 = [deckPt2[0] - up2[0] * 0.3 - right2[0] * halfW,
                         deckPt2[1] - up2[1] * 0.3 - right2[1] * halfW,
                         deckPt2[2] - up2[2] * 0.3 - right2[2] * halfW];
      const deckBotR2 = [deckPt2[0] - up2[0] * 0.3 + right2[0] * halfW,
                         deckPt2[1] - up2[1] * 0.3 + right2[1] * halfW,
                         deckPt2[2] - up2[2] * 0.3 + right2[2] * halfW];
      const gndL2 = wgs84ToCartesian(g2[0], g2[1], g2[2] || 0);
      gndL2[0] -= right2[0] * halfW; gndL2[1] -= right2[1] * halfW; gndL2[2] -= right2[2] * halfW;
      const gndR2 = wgs84ToCartesian(g2[0], g2[1], g2[2] || 0);
      gndR2[0] += right2[0] * halfW; gndR2[1] += right2[1] * halfW; gndR2[2] += right2[2] * halfW;

      // Left wedge face: deckBotL1 → gndL1 → gndL2 → deckBotL2
      positionsList.push(...deckBotL1, ...gndL1, ...gndL2, ...deckBotL2);
      indicesList.push(idxOffset, idxOffset+1, idxOffset+2, idxOffset, idxOffset+2, idxOffset+3);
      idxOffset += 4;

      // Right wedge face: deckBotR1 → deckBotR2 → gndR2 → gndR1
      positionsList.push(...deckBotR1, ...deckBotR2, ...gndR2, ...gndR1);
      indicesList.push(idxOffset, idxOffset+1, idxOffset+2, idxOffset, idxOffset+2, idxOffset+3);
      idxOffset += 4;

      // Bottom fill: gndL1 → gndR1 → gndR2 → gndL2
      positionsList.push(...gndL1, ...gndR1, ...gndR2, ...gndL2);
      indicesList.push(idxOffset, idxOffset+1, idxOffset+2, idxOffset, idxOffset+2, idxOffset+3);
      idxOffset += 4;
    }

    if (positionsList.length > 0) {
      meshes.push({
        positions: new Float64Array(positionsList),
        indices: new Uint32Array(indicesList),
        material: { type: 'solid', color: '#78909c' }, // Blue-grey concrete — visible ramp abutment
        layerId: 'transit_deck'
      });
    }

    return meshes;
  }

  private generateMetroFlyoverMeshes(mf: MetroFlyoverObject): MeshData[] {
    const meshes: MeshData[] = [];
    const coords = mf.coordinates;
    if (coords.length < 2) return meshes;

    const groundCoords = mf.groundCoordinates || coords.map(c => [c[0], c[1], 0]);
    const metroElevation = mf.metroElevation || 12.0;
    const metroCoords = groundCoords.map(c => [c[0], c[1], c[2] + metroElevation] as [number, number, number]);

    const laneWidth = mf.laneWidth || 3.5;
    const laneCount = mf.laneCount || 4;
    const dividerWidth = mf.hasDivider ? (mf.dividerWidth || 2.0) : 0;
    const roadAsphaltWidth = laneCount * laneWidth + dividerWidth;
    const roadSlabWidth = roadAsphaltWidth + 1.2;

    // ─── Legend colours (Schematic: road deck grey, metro deck blue); Realistic draws the materialId ─────────
    const RD_SLAB      = '#94a3b8'; // light concrete
    const RD_ASPHALT   = mf.roadClass === 'highway' ? '#0a0f1a' : '#111827';
    const RD_BARRIER   = '#94a3b8';
    const RD_DIVIDER   = '#e2e8f0';
    const MT_BEAM      = '#1e3a5f'; // dark navy blue concrete beam
    const MT_SURFACE   = '#0f172a'; // near-black track bed
    const MT_BARRIER   = '#1d4ed8'; // bright blue parapet
    const MT_RAIL      = '#bae6fd'; // steel blue rail

    // ==========================================
    // 1. MIDDLE LEVEL: ROAD DECK (box girder, as the road flyover)
    // ==========================================
    const roadAsphalt = this.generateRibbon(coords, -roadAsphaltWidth / 2, roadAsphaltWidth / 2, 0.02, 0);
    meshes.push({
      positions: new Float64Array(roadAsphalt.positions),
      indices: new Uint32Array(roadAsphalt.indices),
      material: { type: 'solid', color: RD_ASPHALT, materialId: 'asphalt_deck' },
      layerId: 'transit_deck'
    });
    const roadGirderDepth = dim('flyoverGirderDepth');
    const roadSoffit = roadSlabWidth * dim('flyoverSoffitRatio');
    const roadGirder = extrudeProfile(coords, boxGirderProfile(roadSlabWidth, roadGirderDepth, roadSoffit), wgs84ToCartesian, 0);
    meshes.push({
      positions: new Float64Array(roadGirder.positions),
      indices: new Uint32Array(roadGirder.indices),
      material: { type: 'solid', color: RD_SLAB, materialId: 'concrete_deck' },
      layerId: 'transit_deck'
    });
    for (const side of [-1, 1] as const) {
      const parapet = extrudeProfile(coords, jerseyParapetProfile(side * roadSlabWidth / 2, side), wgs84ToCartesian, 0);
      meshes.push({
        positions: new Float64Array(parapet.positions),
        indices: new Uint32Array(parapet.indices),
        material: { type: 'solid', color: RD_BARRIER, materialId: 'concrete_barrier' },
        layerId: 'transit_deck_details'
      });
    }
    if (mf.hasDivider && dividerWidth > 0.1) {
      const divider = extrudeProfile(coords, jerseyMedianProfile(), wgs84ToCartesian, 0.02);
      meshes.push({
        positions: new Float64Array(divider.positions),
        indices: new Uint32Array(divider.indices),
        material: { type: 'solid', color: RD_DIVIDER, materialId: 'concrete_barrier' },
        layerId: 'transit_deck_details'
      });
    } else if (!mf.isOneWay) {
      // Undivided: IRC:35-2015 §4.6.1 white broken centre line (was a US-style double yellow)
      meshes.push(this.markingLine([coords], 0, dim('centreLineWidth'), '#e2e8f0', 'marking_white', 'transit_deck',
        { mark: dim('centreLineMark'), gap: dim('centreLineGap') }, 0.03));
    }

    // E. Lane Dividers
    const lanesA = Math.ceil(laneCount / (mf.isOneWay ? 1 : 2));
    const lanesB = mf.isOneWay ? 0 : Math.floor(laneCount / 2);

    if (lanesA > 1) {
      const startOffset = -roadAsphaltWidth / 2;
      for (let i = 1; i < lanesA; i++) {
        const offset = startOffset + i * laneWidth;
        // IRC:35-2015 lane line, 150 mm, 3 m / 6 m
        meshes.push(this.markingLine([coords], offset, dim('laneLineWidth'), '#e2e8f0', 'marking_white', 'transit_deck',
          { mark: dim('laneLineMark'), gap: dim('laneLineGap') }, 0.03));
      }
    }
    if (lanesB > 1) {
      const startOffset = mf.hasDivider ? dividerWidth / 2 : 0;
      for (let i = 1; i < lanesB; i++) {
        const offset = startOffset + i * laneWidth;
        // IRC:35-2015 lane line, 150 mm, 3 m / 6 m
        meshes.push(this.markingLine([coords], offset, dim('laneLineWidth'), '#e2e8f0', 'marking_white', 'transit_deck',
          { mark: dim('laneLineMark'), gap: dim('laneLineGap') }, 0.03));
      }
    }

    // ==========================================
    // 2. TOP LEVEL: METRO VIADUCT
    // ==========================================
    // Pune viaduct ~8.5 m edge to edge, track centres 4.1 m (Phase-2 DPR, official); was a 5.0 m slab
    const metroParts = this.metroViaductMeshes(metroCoords, dim('metroDeckWidth'), dim('standardGauge'),
      mf.superstructure ?? 'box_girder',
      { beam: MT_BEAM, surface: MT_SURFACE, barrier: MT_BARRIER, rail: MT_RAIL });
    meshes.push(...metroParts);

    // ==========================================
    // 3. PILLARS & PIER CAPS (DOUBLE-DECKER SYSTEM)
    // ==========================================
    const pierSpacing = mf.pierSpacing || dim('flyoverSpan');

    // Subsample positions along path based on spacing
    const distanceList: number[] = [0];
    let totalDist = 0;
    for (let i = 1; i < coords.length; i++) {
      const p1 = wgs84ToCartesian(coords[i - 1][0], coords[i - 1][1], 0);
      const p2 = wgs84ToCartesian(coords[i][0], coords[i][1], 0);
      const dist = Math.sqrt(
        (p2[0] - p1[0]) ** 2 +
        (p2[1] - p1[1]) ** 2 +
        (p2[2] - p1[2]) ** 2
      );
      totalDist += dist;
      distanceList.push(totalDist);
    }

    let currentMarker = pierSpacing / 2;
    while (currentMarker < totalDist) {
      let idx = 0;
      while (idx < distanceList.length - 1 && distanceList[idx + 1] < currentMarker) {
        idx++;
      }

      const segmentStartDist = distanceList[idx];
      const segmentEndDist = distanceList[idx + 1];
      const t = (currentMarker - segmentStartDist) / (segmentEndDist - segmentStartDist);

      const pStart = coords[idx];
      const pEnd = coords[idx + 1];
      const interpLng = pStart[0] + (pEnd[0] - pStart[0]) * t;
      const interpLat = pStart[1] + (pEnd[1] - pStart[1]) * t;

      const deckZ = pStart[2] + (pEnd[2] - pStart[2]) * t;

      let groundZ = 0;
      if (groundCoords && groundCoords[idx] && groundCoords[idx + 1]) {
        const gStart = groundCoords[idx][2] || 0;
        const gEnd = groundCoords[idx + 1][2] || 0;
        groundZ = gStart + (gEnd - gStart) * t;
      }

      const metroZ = groundZ + metroElevation;

      const tangentECEF = ecefTangent(pStart, pEnd); // ECEF direction (was lng/lat degrees, which mis-rotated piers and caps)

      // --- 2. Central pier up to the metro pier cap (cap under the metro girder soffit) ---
      const capDepth = dim('pierCapDepth');
      const metroCapTop = metroZ - dim('metroGirderDepth');
      const topWidth = 2.0;
      const topLength = 1.4;
      const botWidth = 1.6;
      const botLength = 1.2;
      const pillarHeight = metroCapTop - capDepth - groundZ;

      if (pillarHeight > 0.5) {
        const pillar = this.generateTaperedRectangularPier(
          interpLng,
          interpLat,
          pillarHeight,
          topWidth,
          topLength,
          botWidth,
          botLength,
          groundZ,
          tangentECEF,
          'transit_pillars'
        );
        meshes.push(pillar);

        // --- 3. Upper pier cap under the metro box girder (LOD details; depth/length ASSUMED) ---
        meshes.push(this.generateRectangularBox(interpLng, interpLat, metroCapTop - capDepth, capDepth,
          dim('metroGirderSoffit') + 1.0, dim('pierCapLength'), tangentECEF, '#64748b', 'transit_pillars_details'));

        // --- 4. Lower cap (cross-head) under the road deck soffit ---
        const roadDeckHeight = deckZ - groundZ;
        if (roadDeckHeight >= roadGirderDepth + capDepth + 0.5) {
          meshes.push(this.generateRectangularBox(interpLng, interpLat, deckZ - roadGirderDepth - capDepth, capDepth,
            Math.max(roadSoffit + 1.0, topWidth + 0.6), dim('pierCapLength'), tangentECEF, '#64748b', 'transit_pillars_details'));
        }
      }

      currentMarker += pierSpacing;
    }

    return meshes;
  }

  /**
   * Generates procedural elevated metro tracks and pillars
   */
  private generateMetroLineMeshes(metro: MetroLineObject): MeshData[] {
    const meshes: MeshData[] = [];
    // The plan line is on the ground; the deck height is the line's `elevation` alone. Imported OSM tracks store
    // their level in each vertex too (12 bridge, -6 tunnel), drawn ones 0: flattening keeps both at `elevation` and
    // makes the inspector's elevation edit move every line (it used to be ignored when vertices carried a height).
    const coords = metro.coordinates.map(c => [c[0], c[1], 0] as [number, number, number]);
    const elevation = Number.isFinite(metro.elevation) ? metro.elevation : 12;
    const deckWidth = Math.max(3, metro.deckWidth || dim('metroDeckWidth'));
    const gauge = metro.trackGauge || 1.435;
    const tracks = metro.trackCount === 1 ? 1 : 2;
    const superstructure = metro.superstructure ?? 'box_girder';
    const deckCoords = coords.map(c => [c[0], c[1], elevation] as [number, number, number]);

    // 1. Viaduct: box girder (Pune Metro precast segmental box girder, official) or the U-girder option (type not confirmed)
    meshes.push(...this.metroViaductMeshes(deckCoords, deckWidth, gauge, superstructure,
      { beam: '#1e293b', surface: '#1e293b', barrier: '#1e293b', rail: '#a5f3fc' }, tracks));

    // 2. Piers (only for an elevated line; an underground one has none): single circular pier, flared head, pier cap
    // and a 1.0 m Jersey ring (Phase-2 DPR §5.7.1.2); spans 28 m default (DPR range 13–34 m) unless the line sets one
    if (elevation > 1.5) {
      const span = metro.pierSpacing || dim('metroSpan');
      meshes.push(...this.metroPiers(coords, elevation, span, superstructure === 'u_girder' ? 1.9 : dim('metroGirderDepth')));
    }

    return meshes;
  }

  /**
   * Metro viaduct superstructure along `deckCoords` (z = top of deck): girder(s), parapets, track plinths and rails.
   * Track centres 4.1 m (official) capped by the deck width; parapet height, girder depth and soffit ASSUMED (visualDims).
   */
  private metroViaductMeshes(
    deckCoords: [number, number, number][],
    width: number,
    gauge: number,
    type: 'box_girder' | 'u_girder',
    colors: { beam: string; surface: string; barrier: string; rail: string },
    tracks = 2
  ): MeshData[] {
    const meshes: MeshData[] = [];
    const half = Math.min(dim('metroTrackCentres') / 2, Math.max(0, width / 2 - 1.3));
    const centres = tracks === 1 ? [0] : [-half, half];
    const push = (r: { positions: number[]; indices: number[] }, color: string, materialId: MaterialConfig['materialId'], layerId: MeshData['layerId']) =>
      meshes.push({ positions: new Float64Array(r.positions), indices: new Uint32Array(r.indices), material: { type: 'solid', color, materialId }, layerId });

    if (type === 'u_girder') {
      // Generic trough per track: Pune U-girder dimensions are UNKNOWN (inspector: "type not confirmed")
      for (const c of centres) for (const part of uGirderParts(c)) push(extrudeProfile(deckCoords, part, wgs84ToCartesian, 0), colors.beam, 'concrete_deck', 'transit_deck');
    } else {
      push(extrudeProfile(deckCoords, boxGirderProfile(width, dim('metroGirderDepth'), dim('metroGirderSoffit')), wgs84ToCartesian, 0),
        colors.beam, 'concrete_deck', 'transit_deck');
      const ph = dim('metroParapetHeight');
      for (const side of [-1, 1]) {
        const x0 = side * (width / 2 - 0.2), x1 = side * width / 2;
        push(extrudeProfile(deckCoords, rectProfile(Math.min(x0, x1), Math.max(x0, x1), 0, ph), wgs84ToCartesian, 0),
          colors.barrier, 'concrete_barrier', 'transit_deck_details');
      }
    }
    // Ballastless track: a plinth under each rail (0.6 × 0.25 m, assumed) and the rail (0.1 × 0.15 m) at the gauge
    const floor = type === 'u_girder' ? -1.6 : 0;
    for (const c of centres) {
      for (const sgn of [-1, 1]) {
        const r = c + sgn * gauge / 2;
        push(extrudeProfile(deckCoords, rectProfile(r - 0.3, r + 0.3, floor, floor + 0.25), wgs84ToCartesian, 0, false),
          colors.surface, 'track_plinth', 'transit_deck_details');
        push(extrudeProfile(deckCoords, rectProfile(r - 0.05, r + 0.05, floor + 0.25, floor + 0.4), wgs84ToCartesian, 0, false),
          colors.rail, 'steel_rail', 'transit_rails');
      }
    }
    return meshes;
  }

  /** Circular metro piers with flared heads, pier caps and Jersey rings at `span` spacing along a ground path. */
  private metroPiers(coords: [number, number, number][], deckZ: number, span: number, girderDepth: number): MeshData[] {
    const out: MeshData[] = [];
    const cum = cumulativeLengths(coords);
    const r = dim('metroPierDiameter') / 2;
    const capDepth = dim('pierCapDepth');
    const flare = 1.5; // flared head height (assumed); widens to the cap
    const capTop = deckZ - girderDepth;
    const shaftTop = capTop - capDepth - flare;
    if (shaftTop < 0.5) return out;
    for (const s of pierStations(cum[cum.length - 1], span)) {
      const { pt, seg } = pointAt(coords, cum, s);
      const t = ecefTangent(coords[seg], coords[seg + 1] ?? coords[seg]);
      out.push(this.generateFrustum(pt[0], pt[1], 0, shaftTop, r, r, 'transit_pillars', '#64748b', 'concrete_pier', false));
      out.push(this.generateFrustum(pt[0], pt[1], shaftTop, flare, r, r * 1.6, 'transit_pillars', '#64748b', 'concrete_pier', true));
      out.push(this.generateRectangularBox(pt[0], pt[1], capTop - capDepth, capDepth, dim('metroGirderSoffit') + 0.6, dim('pierCapLength'), t, '#64748b', 'transit_pillars_details'));
      const ring = r + dim('metroPierBarrierGap');
      out.push(this.generateFrustum(pt[0], pt[1], 0, dim('metroPierBarrierHeight'), ring + 0.4, ring + 0.15, 'transit_pillars_details', '#94a3b8', 'concrete_barrier', true));
    }
    return out;
  }

  /** Closed-top frustum (r0 at the base, r1 at the top), 16 sides, for piers, flared heads and barrier rings. */
  private generateFrustum(
    lng: number, lat: number, base: number, height: number, r0: number, r1: number,
    layerId: MeshData['layerId'], color: string, materialId: MaterialConfig['materialId'], capTop: boolean
  ): MeshData {
    const seg = 16;
    const positions: number[] = [];
    const indices: number[] = [];
    const b = wgs84ToCartesian(lng, lat, base);
    const up = normalize(b);
    let arb: [number, number, number] = [0, 0, 1];
    if (Math.abs(up[2]) > 0.9) arb = [1, 0, 0];
    const e1 = normalize(cross(up, arb));
    const e2 = normalize(cross(up, e1));
    for (const [h, rr] of [[0, r0], [height, r1]] as const) {
      for (let i = 0; i < seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        const x = Math.cos(th) * rr, y = Math.sin(th) * rr;
        positions.push(b[0] + e1[0] * x + e2[0] * y + up[0] * h, b[1] + e1[1] * x + e2[1] * y + up[1] * h, b[2] + e1[2] * x + e2[2] * y + up[2] * h);
      }
    }
    for (let i = 0; i < seg; i++) {
      const n = (i + 1) % seg;
      indices.push(i, n, n + seg, i, n + seg, i + seg);
    }
    if (capTop) {
      const c = positions.length / 3;
      positions.push(b[0] + up[0] * height, b[1] + up[1] * height, b[2] + up[2] * height);
      for (let i = 0; i < seg; i++) indices.push(c, seg + i, seg + ((i + 1) % seg));
    }
    return { positions: new Float64Array(positions), indices: new Uint32Array(indices), material: { type: 'solid', color, materialId }, layerId };
  }

  /**
   * Generates concrete support pillars at regular metric intervals along a coordinate path
   */
  private generatePillarsAlongCenterline(
    coords: [number, number, number][],
    groundCoords: [number, number, number][] | undefined,
    height: number,
    spacing: number,
    layerId?: any
  ): MeshData[] {
    const pillars: MeshData[] = [];
    if (coords.length < 2) return pillars;

    // 1. Subsample positions along path based on spacing
    // We compute cumulative metric distance along coordinates
    const distanceList: number[] = [0];
    let totalDist = 0;
    for (let i = 1; i < coords.length; i++) {
      const p1 = wgs84ToCartesian(coords[i - 1][0], coords[i - 1][1], 0);
      const p2 = wgs84ToCartesian(coords[i][0], coords[i][1], 0);
      const dist = Math.sqrt(
        (p2[0] - p1[0]) ** 2 +
        (p2[1] - p1[1]) ** 2 +
        (p2[2] - p1[2]) ** 2
      );
      totalDist += dist;
      distanceList.push(totalDist);
    }

    // Place columns at regular spacing intervals
    const radius = 1.0; // 1m column radius
    let currentMarker = spacing / 2; // offset first column
    while (currentMarker < totalDist) {
      // Find segment matching the cumulative distance
      let idx = 0;
      while (idx < distanceList.length - 1 && distanceList[idx + 1] < currentMarker) {
        idx++;
      }

      // Interpolate along the matched segment
      const segmentStartDist = distanceList[idx];
      const segmentEndDist = distanceList[idx + 1];
      const t = (currentMarker - segmentStartDist) / (segmentEndDist - segmentStartDist);

      const pStart = coords[idx];
      const pEnd = coords[idx + 1];
      const interpLng = pStart[0] + (pEnd[0] - pStart[0]) * t;
      const interpLat = pStart[1] + (pEnd[1] - pStart[1]) * t;

      // Interpolate Z coordinate and add height offset
      const startZ = pStart[2] || 0;
      const endZ = pEnd[2] || 0;
      const deckZ = startZ + (endZ - startZ) * t;

      let groundZ = 0;
      if (groundCoords && groundCoords[idx] && groundCoords[idx + 1]) {
        const gStart = groundCoords[idx][2] || 0;
        const gEnd = groundCoords[idx + 1][2] || 0;
        groundZ = gStart + (gEnd - gStart) * t;
      }

      const pillarHeight = deckZ - groundZ + height;

      // Skip columns near ramps where deck height is too low (height < 1.5m)
      if (pillarHeight >= 1.5) {
        const columnMesh = this.generateCylinder(
          interpLng,
          interpLat,
          pillarHeight,
          radius,
          layerId,
          '#64748b',
          groundZ
        );
        pillars.push(columnMesh);
      }

      currentMarker += spacing;
    }

    return pillars;
  }

  /**
   * Generates a cylinder pier geometry representing a support column
   */
  private generateCylinder(
    lng: number,
    lat: number,
    height: number,
    radius: number,
    layerId?: any,
    color = '#64748b',
    baseElevation = 0
  ): MeshData {
    const positionsList: number[] = [];
    const indicesList: number[] = [];
    const segments = 12;

    // 1. Generate cylinder vertices
    // Top circle and bottom circle
    for (let hOffset = 0; hOffset <= height; hOffset += height) {
      const base = wgs84ToCartesian(lng, lat, baseElevation + hOffset);
      const up = normalize(base);

      // Calculate right/forward vectors orthogonal to local up
      let arbitrary = [1, 0, 0] as [number, number, number];
      if (Math.abs(up[0]) > 0.9) arbitrary = [0, 1, 0];
      const right = normalize(cross(up, arbitrary));
      const forward = normalize(cross(up, right));

      for (let i = 0; i < segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const xOffset = Math.cos(theta) * radius;
        const yOffset = Math.sin(theta) * radius;

        const pt = [
          base[0] + right[0] * xOffset + forward[0] * yOffset,
          base[1] + right[1] * xOffset + forward[1] * yOffset,
          base[2] + right[2] * xOffset + forward[2] * yOffset
        ];
        positionsList.push(...pt);
      }
    }

    // 2. Generate side indices
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const botCurr = i;
      const botNext = next;
      const topCurr = i + segments;
      const topNext = next + segments;

      indicesList.push(botCurr, botNext, topNext);
      indicesList.push(botCurr, topNext, topCurr);
    }

    return {
      positions: new Float64Array(positionsList),
      indices: new Uint32Array(indicesList),
      material: { type: 'solid', color },
      layerId
    };
  }

  private generateJunctionMeshes(j: JunctionObject, scene?: GeometryContext): MeshData[] {
    if (!scene) return [];
    const [lng, lat] = j.coordinates;
    const nearby = scene.drivablesNear(lng - 0.0003, lat - 0.0003, lng + 0.0003, lat + 0.0003);
    const layout = junctionLayout(j.coordinates, nearby);
    if (!layout.valid) return [];
    // Above the overlapping approaches, without cutting their asphalt away.
    const z = layout.elevation + 0.18;
    const positions = layout.boundary.flatMap(p => wgs84ToCartesian(p[0], p[1], z));
    const indices: number[] = [];
    for (let i = 1; i < layout.boundary.length - 1; i++) indices.push(0, i, i + 1);
    const meshes: MeshData[] = [{ positions: new Float64Array(positions), indices: new Uint32Array(indices), material: { type: 'solid', color: '#30363f' }, layerId: 'asphalt' }];
    const kx = 111320 * Math.cos(lat * Math.PI / 180);
    const box = (x: number, y: number, dx: number, dy: number, length: number, width: number) => {
      const ps = [[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([a, b]) => {
        const px = x + dx * length / 2 * a - dy * width / 2 * b;
        const py = y + dy * length / 2 * a + dx * width / 2 * b;
        return wgs84ToCartesian(lng + px / kx, lat + py / 111320, z + 0.025);
      });
      return { positions: new Float64Array(ps), indices: new Uint32Array([0, 1, 2, 0, 2, 3]), material: { type: 'solid' as const, color: '#e2e8f0' }, layerId: 'marking' as const };
    };
    for (const arm of layout.arms) {
      const { dx, dy, width, reach } = arm;
      // Stop bar covers the approaching half of an Indian left-hand-traffic road.
      if (j.hasSignals) {
        const side = width / 4;
        meshes.push(box(dx * (reach + 1.3) + dy * side, dy * (reach + 1.3) - dx * side, -dy, dx, width / 2 - 0.3, 0.4));
      }
      if (j.hasPedestrianCrossing) {
        const stripes = Math.floor((width - 0.6) / 1.2);
        for (let i = 0; i < stripes; i++) {
          const side = (i - (stripes - 1) / 2) * 1.2;
          meshes.push(box(dx * reach - dy * side, dy * reach + dx * side, dx, dy, 2, 0.55));
        }
      }
    }
    return meshes;
  }

  private dot(a: [number, number, number], b: [number, number, number]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  private generateLocalBox(
    center: [number, number, number],
    up: [number, number, number],
    right: [number, number, number],
    forward: [number, number, number],
    length: number,
    width: number,
    height: number,
    color: string,
    layerId: any
  ): MeshData {
    const dx = [right[0] * width / 2, right[1] * width / 2, right[2] * width / 2];
    const dy = [forward[0] * length / 2, forward[1] * length / 2, forward[2] * length / 2];
    const dz = [up[0] * height / 2, up[1] * height / 2, up[2] * height / 2];

    const corners = [
      // Bottom 4 points
      [center[0] - dx[0] - dy[0] - dz[0], center[1] - dx[1] - dy[1] - dz[1], center[2] - dx[2] - dy[2] - dz[2]],
      [center[0] + dx[0] - dy[0] - dz[0], center[1] + dx[1] - dy[1] - dz[1], center[2] + dx[2] - dy[2] - dz[2]],
      [center[0] + dx[0] + dy[0] - dz[0], center[1] + dx[1] + dy[1] - dz[1], center[2] + dx[2] + dy[2] - dz[2]],
      [center[0] - dx[0] + dy[0] - dz[0], center[1] - dx[1] + dy[1] - dz[1], center[2] - dx[2] + dy[2] - dz[2]],
      // Top 4 points
      [center[0] - dx[0] - dy[0] + dz[0], center[1] - dx[1] - dy[1] + dz[1], center[2] - dx[2] - dy[2] + dz[2]],
      [center[0] + dx[0] - dy[0] + dz[0], center[1] + dx[1] - dy[1] + dz[1], center[2] + dx[2] - dy[2] + dz[2]],
      [center[0] + dx[0] + dy[0] + dz[0], center[1] + dx[1] + dy[1] + dz[1], center[2] + dx[2] + dy[2] + dz[2]],
      [center[0] - dx[0] + dy[0] + dz[0], center[1] - dx[1] + dy[1] + dz[1], center[2] - dx[2] + dy[2] + dz[2]]
    ];

    const positions = new Float64Array(corners.flat());
    const indices = new Uint32Array([
      // Front
      0, 1, 5, 0, 5, 4,
      // Right
      1, 2, 6, 1, 6, 5,
      // Back
      2, 3, 7, 2, 7, 6,
      // Left
      3, 0, 4, 3, 4, 7,
      // Top
      4, 5, 6, 4, 6, 7,
      // Bottom
      3, 2, 1, 3, 1, 0
    ]);

    return {
      positions,
      indices,
      material: { type: 'solid', color },
      layerId
    };
  }

  private generateLocalArch(
    center: [number, number, number],
    up: [number, number, number],
    right: [number, number, number],
    forward: [number, number, number],
    length: number,
    spanWidth: number,
    archHeight: number,
    color: string,
    layerId: any
  ): MeshData {
    const positionsList: number[] = [];
    const indicesList: number[] = [];

    const stepsX = 16;
    const stepsY = 10;

    for (let y = 0; y <= stepsY; y++) {
      const tY = y / stepsY;
      const yOffset = (tY - 0.5) * length;

      for (let x = 0; x <= stepsX; x++) {
        const tX = x / stepsX;
        const theta = -Math.PI / 2 + tX * Math.PI;

        const rightOffset = Math.sin(theta) * (spanWidth / 2);
        const upOffset = Math.cos(theta) * archHeight;

        const pt = [
          center[0] + right[0] * rightOffset + forward[0] * yOffset + up[0] * upOffset,
          center[1] + right[1] * rightOffset + forward[1] * yOffset + up[1] * upOffset,
          center[2] + right[2] * rightOffset + forward[2] * yOffset + up[2] * upOffset
        ];
        positionsList.push(...pt);
      }
    }

    const verticesPerRow = stepsX + 1;
    for (let y = 0; y < stepsY; y++) {
      for (let x = 0; x < stepsX; x++) {
        const r0c0 = y * verticesPerRow + x;
        const r0c1 = r0c0 + 1;
        const r1c0 = (y + 1) * verticesPerRow + x;
        const r1c1 = r1c0 + 1;

        indicesList.push(r0c0, r0c1, r1c1);
        indicesList.push(r0c0, r1c1, r1c0);
      }
    }

    return {
      positions: new Float64Array(positionsList),
      indices: new Uint32Array(indicesList),
      material: { type: 'solid', color },
      layerId
    };
  }

  private generateMetroStationMeshes(station: MetroStationObject, allObjects?: GeometryContext): MeshData[] {
    const meshes: MeshData[] = [];
    const position = station.coordinates;
    const length = station.length || 140;
    const width = station.width || 20;
    const height = station.height || 8;
    const elevation = station.elevation || 12;

    const center = wgs84ToCartesian(position[0], position[1], elevation);
    const up = normalize(center);

    // Long axis follows the nearest track (default) or the user-set heading.
    const tracks = allObjects ? [...allObjects.ofType('metro_line'), ...allObjects.ofType('metro_flyover')] : [];
    const { heading } = resolveStationHeading(station, tracks);
    const lonR = (position[0] * Math.PI) / 180;
    const latR = (position[1] * Math.PI) / 180;
    const hR = (heading * Math.PI) / 180;
    const east = [-Math.sin(lonR), Math.cos(lonR), 0];
    const north = [-Math.sin(latR) * Math.cos(lonR), -Math.sin(latR) * Math.sin(lonR), Math.cos(latR)];
    const dir = [0, 1, 2].map(i => north[i] * Math.cos(hR) + east[i] * Math.sin(hR)) as [number, number, number];
    // Remove any component along our (geocentric) up so the box stays level
    const dirUp = this.dot(dir, up);
    const forward = normalize([dir[0] - up[0] * dirUp, dir[1] - up[1] * dirUp, dir[2] - up[2] * dirUp]);
    const right = normalize(cross(forward, up));

    // A. Concrete Pillars (4 rectangular support columns from ground level to concourse deck)
    const pillarHeight = elevation - 2.0;

    const ox = (width - 2) / 3;
    const oy = (length - 20) / 3;
    const pillarOffsets = [
      [-ox, -oy],
      [ox, -oy],
      [-ox, oy],
      [ox, oy]
    ];

    for (const [oxVal, oyVal] of pillarOffsets) {
      const centerGround = wgs84ToCartesian(position[0], position[1], 0);
      const pillarBase = [
        centerGround[0] + right[0] * oxVal + forward[0] * oyVal,
        centerGround[1] + right[1] * oxVal + forward[1] * oyVal,
        centerGround[2] + right[2] * oxVal + forward[2] * oyVal
      ] as [number, number, number];

      // Shift the box center vertically by half of the pillar height
      const pillarBoxCenter = [
        pillarBase[0] + up[0] * (pillarHeight / 2),
        pillarBase[1] + up[1] * (pillarHeight / 2),
        pillarBase[2] + up[2] * (pillarHeight / 2)
      ] as [number, number, number];

      const pillarMesh = this.generateLocalBox(
        pillarBoxCenter,
        up,
        right,
        forward,
        2.0, // length (along track)
        2.0, // width (transverse)
        pillarHeight,
        '#64748b', // Concrete grey
        'transit_pillars'
      );
      meshes.push(pillarMesh);
    }

    // A2. Concrete Crossbeams connecting the pillars
    const beamWidth = ox * 2;
    const beamOffsets = [-oy, oy];
    for (const oyVal of beamOffsets) {
      const beamCenter = [
        center[0] - up[0] * 2.5 + forward[0] * oyVal,
        center[1] - up[1] * 2.5 + forward[1] * oyVal,
        center[2] - up[2] * 2.5 + forward[2] * oyVal
      ] as [number, number, number];

      const beamMesh = this.generateLocalBox(
        beamCenter,
        up,
        right,
        forward,
        2.4,
        beamWidth,
        1.2,
        '#475569',
        'transit_pillars'
      );
      meshes.push(beamMesh);
    }

    // B. Concourse Deck (Lower deck)
    const concourseCenter = [
      center[0] - up[0] * 1.5,
      center[1] - up[1] * 1.5,
      center[2] - up[2] * 1.5
    ] as [number, number, number];

    const concourseDeck = this.generateLocalBox(
      concourseCenter,
      up,
      right,
      forward,
      length - 20,
      width - 4,
      1.5,
      '#334155',
      'transit_deck'
    );
    meshes.push(concourseDeck);

    // C. Platform Deck (Upper deck)
    const platformCenter = [
      center[0] + up[0] * 1.5,
      center[1] + up[1] * 1.5,
      center[2] + up[2] * 1.5
    ] as [number, number, number];

    const platformDeck = this.generateLocalBox(
      platformCenter,
      up,
      right,
      forward,
      length,
      width,
      0.8,
      '#475569',
      'transit_deck'
    );
    meshes.push(platformDeck);



    // D. Open Air Safety Railings
    const railLength = length - 6;
    const railWidth = 0.1;
    const railHeight = 1.2;
    const railCenterZOffset = 2.5;
    const railHalfWidth = width / 2;
    const railOffsets = [-railHalfWidth, railHalfWidth];

    for (const offset of railOffsets) {
      const railCenter = [
        center[0] + right[0] * offset + up[0] * railCenterZOffset,
        center[1] + right[1] * offset + up[1] * railCenterZOffset,
        center[2] + right[2] * offset + up[2] * railCenterZOffset
      ] as [number, number, number];

      const railing = this.generateLocalBox(
        railCenter,
        up,
        right,
        forward,
        railLength,
        railWidth,
        railHeight,
        'rgba(56, 189, 248, 0.55)',
        'transit_station'
      );
      meshes.push(railing);
    }

    // E. Structural Steel Arch Ribs (5 skeleton girders spaced along length)
    const ribSpanWidth = width + 2.0;
    const ribArchHeight = height - 2.8 > 3.0 ? height - 2.8 : 3.5;
    const ribOffsets = [-oy, -oy / 2, 0, oy / 2, oy];

    for (const oyVal of ribOffsets) {
      const ribCenter = [
        center[0] + up[0] * 4.5 + forward[0] * oyVal,
        center[1] + up[1] * 4.5 + forward[1] * oyVal,
        center[2] + up[2] * 4.5 + forward[2] * oyVal
      ] as [number, number, number];

      const steelRib = this.generateLocalArch(
        ribCenter,
        up,
        right,
        forward,
        1.5,
        ribSpanWidth,
        ribArchHeight,
        '#1e293b',
        'transit_station'
      );
      meshes.push(steelRib);
    }

    // F. Translucent Canopy Roof Cover (slightly lower/narrower than ribs)
    const roofCenter = [
      center[0] + up[0] * 4.4,
      center[1] + up[1] * 4.4,
      center[2] + up[2] * 4.4
    ] as [number, number, number];

    const canopy = this.generateLocalArch(
      roofCenter,
      up,
      right,
      forward,
      length + 2.0,
      width + 1.8,
      ribArchHeight - 0.2,
      'rgba(56, 189, 248, 0.35)',
      'transit_station'
    );
    meshes.push(canopy);

    return meshes;
  }

  /**
   * A drawn utility to scale: one ribbon per run of vertices whose top-of-pipe depth is known (utilityModel: per-vertex
   * depth to its zRef, legacy objects migrated on read), its top at that depth and as tall as the diameter (0.5 m
   * placeholder thickness when the diameter is unknown). Vertices with an UNKNOWN depth are not placed below ground: the
   * Underground renderer draws them dashed on the surface. A minimum-pixel-width line and a surface trace are added by
   * the Underground renderer, so a 150 mm pipe stays findable from above.
   */
  private generateUtilityMesh(utility: UtilityObject): MeshData[] {
    const z = utilityZ(utility);
    const thickness = z.diameterM !== null ? Math.max(0.05, z.diameterM) : 0.5;
    // Same colours as the Underground legend / records (UndergroundRenderer UTILITY_COLOR)
    const color = ({ water: '#3b82f6', sewage: '#22c55e', electricity: '#ef4444', gas: '#eab308', fiber: '#f97316' } as Record<string, string>)[utility.utilityType] ?? '#38bdf8';
    const out: MeshData[] = [];
    let run: [number, number, number][] = [];
    const flush = () => {
      if (run.length >= 2) {
        const ribbon = this.generateRibbon(run, -thickness / 2, thickness / 2, 0, thickness);
        out.push({ positions: new Float64Array(ribbon.positions), indices: new Uint32Array(ribbon.indices), material: { type: 'solid', color }, layerId: 'transit_utility' });
      }
      run = [];
    };
    utility.coordinates.forEach((c, i) => {
      const top = z.depths[i]?.topDepthM;
      if (typeof top === 'number' && Number.isFinite(top)) run.push([c[0], c[1], -top]);
      else flush();
    });
    flush();
    return out;
  }
}
