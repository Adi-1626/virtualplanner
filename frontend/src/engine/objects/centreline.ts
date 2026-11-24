/**
 * Length of a centreline (m), measured horizontally in the shape editor's local plan projection: the app's one length
 * definition (Design's drawnWorks.centrelineLengthM via underground/alignmentGeometry.chainages; same projector:
 * 111,320 m × cos(mean latitude) per degree of longitude, 110,574 m per degree of latitude). Kept dependency-free so the
 * simulation workers can use it.
 */
export function centrelineLength(coords: readonly (readonly number[])[]): number {
  if (coords.length < 2) return 0;
  const lat0 = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  let acc = 0;
  for (let i = 1; i < coords.length; i++) acc += Math.hypot((coords[i][0] - coords[i - 1][0]) * kx, (coords[i][1] - coords[i - 1][1]) * ky);
  return acc;
}
