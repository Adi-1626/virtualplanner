/** Cross-component focus of the Environment workspace: a station clicked on the map opens its readings in Records. */
import { create } from 'zustand';

interface Focus { station: string | null; nonce: number; focusStation: (id: string) => void }
export const useEnvFocus = create<Focus>(set => ({
  station: null, nonce: 0,
  focusStation: id => set(s => ({ station: id, nonce: s.nonce + 1 })),
}));
