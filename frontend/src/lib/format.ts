/** 850 → "850 m", 1250 → "1.25 km". */
export function formatDistanceM(meters: number): string {
  return meters >= 1000 ? `${+(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

/** An error text as one sentence: exactly one full stop at the end ("…try again.." read as a typo). */
export const sentence = (t: string | null | undefined) => { const s = (t ?? '').trim().replace(/[.\s]+$/, ''); return s ? `${s}.` : ''; };
