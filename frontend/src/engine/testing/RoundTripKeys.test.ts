import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RoundTripBar } from '../../components/simulate/RoundTripBar';
import { useRoundTrip } from '../../shell/roundTripController';
import { ROUND_TRIP_VERSION, type RoundTripState } from '../simulation/roundTrip';

/**
 * Esc on the "Return to study" bar's question (docs/urbanos/SIM_FLOW_P12.md §5): it closes the question only. The key is
 * marked handled, so the global shortcuts (cancel drawing, clear selection, clear the study) leave everything else alone.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trip: RoundTripState = {
  v: ROUND_TRIP_VERSION,
  study: { seedRoadIds: ['r1'], label: 'Satara Road', rangeMeters: 700, direction: 'both' as never, hour: 9, day: 'weekday' as never, bounds: null },
  leg: { id: 'leg1', startedAt: 't', target: null, proposalId: 'p1', proposalName: 'Flyover', createdProposal: true, startSnapshot: {}, undoCountAtStart: 0, phase: 'editing' },
  tests: [], status: null, baselineSavedByFlow: false,
} as RoundTripState;

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; useRoundTrip.setState({ trip: null, changes: null, ask: null, baseActive: false }); });

const escape = () => {
  const seen: boolean[] = [];
  const global = (e: KeyboardEvent) => seen.push(e.defaultPrevented);   // what the global shortcuts would see
  window.addEventListener('keydown', global);
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  window.removeEventListener('keydown', global);
  return seen[0];
};

describe('Esc on the round trip bar', () => {
  it('closes an open question only, and leaves Esc to the map when no question is open', () => {
    useRoundTrip.setState({ trip, changes: { total: 1, network: 1, inArea: 1, underground: 0, demand: 0, other: 0, outsideNames: [] }, ask: { kind: 'cancel' }, baseActive: false });
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(RoundTripBar)));
    expect(host.querySelector('[data-testid="roundtrip-ask-cancel"]')).not.toBeNull();
    expect(escape()).toBe(true);
    expect(useRoundTrip.getState().ask).toBeNull();
    expect(useRoundTrip.getState().trip!.leg!.id).toBe('leg1');
    expect(host.querySelector('[data-testid="roundtrip-ask-cancel"]')).toBeNull();
    expect(host.querySelector('[data-testid="roundtrip-bar"]')).not.toBeNull();
    // No question open: the bar does not take Esc (the map cancels a drawing or clears the selection)
    expect(escape()).toBe(false);
    expect(useRoundTrip.getState().trip!.leg).not.toBeNull();
  });
});
