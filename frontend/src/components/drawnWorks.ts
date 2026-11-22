import type { CityObject } from '../engine/objects/types';
import { chainages } from '../engine/underground/alignmentGeometry';

/**
 * The one length the app shows for a line object: its **centreline as stored** (the line the map draws and the traffic
 * model uses), measured horizontally in the same local projection as the shape editor's chainage (an earlier
 * helper used 111,320 m per degree of latitude, 0.7 % long north–south). The shape editor's design chainage (PIs with fillet arcs) can be a few metres
 * shorter, because the stored line also carries the short pieces that join its ends to the roads it meets; it is shown
 * as a note, never as a second "length" (p5 QA: 438 m in one place, 431 m in another).
 */
export const LENGTH_DEFINITION = 'Centreline length as drawn on the map (horizontal), the same everywhere in the app';

/** Stored centreline length, measured with the same local projection as the shape editor's chainage (alignmentGeometry). */
export function centrelineLengthM(coords: readonly (readonly number[])[]): number {
  const ch = chainages(coords);
  return ch.length ? ch[ch.length - 1] : 0;
}

/** A note when the design chainage differs from the stored centreline by 1 m or more; null otherwise. */
export function chainageNote(centrelineM: number | null, chainageM: number | null | undefined): string | null {
  if (centrelineM === null || chainageM === null || chainageM === undefined || !Number.isFinite(chainageM)) return null;
  const diff = centrelineM - chainageM;
  if (Math.abs(diff) < 1) return null;
  return diff > 0
    ? `Design chainage runs 0–${Math.round(chainageM)} m; the other ${Math.round(diff)} m join the ends to the roads they meet.`
    : `Design chainage runs 0–${Math.round(chainageM)} m, ${Math.round(-diff)} m more than the stored line (it is redrawn at the next change).`;
}

/** Length of a drawn line; null for areas and for single-point objects (a gateway read "Traffic gateway · 0 m", Final QA 2026-11-21). */
export const lineLength = (o: CityObject): number | null =>
  Array.isArray(o.coordinates[0]) && o.coordinates.length >= 2 && o.type !== 'building' && o.type !== 'zone' ? centrelineLengthM(o.coordinates as number[][]) : null;
