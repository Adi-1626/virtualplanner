import type { DirectionFlow } from './RoadAnalysis';

/**
 * Plain words for the stop line that limits a direction: "the signal at its end" when the run's own signal (or the
 * assignment's stop line at the end of its geometry) sets it, else where it really stands ("a signal part-way along
 * it"), and whether its green is the run's own plan or the assignment's assumed split. P12: the lane-change insight said
 * "the signal at its end" for an assignment stop line in the middle of a carriageway.
 */
export function stopLineWords(d: Pick<DirectionFlow, 'stopLine' | 'paths'>): string {
  const sl = d.stopLine;
  if (!sl) return 'the signal at its end';
  const end = d.paths?.at(-1)?.at(-1);
  const M = 111320;
  const atEnd = sl.source === 'run' || (!!end && Math.hypot((end[0] - sl.at[0]) * M * Math.cos(sl.at[1] * Math.PI / 180), (end[1] - sl.at[1]) * M) < 40);
  const what = sl.kind === 'roundabout' ? 'the roundabout entry' : sl.kind === 'crossing' ? 'the signalised crossing' : 'the signal';
  const where = sl.kind === 'crossing' ? 'on it' : atEnd ? 'at its end' : 'part-way along it';
  const timing = sl.kind === 'roundabout' ? '' : sl.source === 'run' ? '' : ', assumed green split';
  return `${what} ${where}${timing ? ` (${timing.slice(2)})` : ''}`;
}
