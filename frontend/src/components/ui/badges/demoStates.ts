/**
 * p15 (docs/urbanos/DEMO_P15.md): what the main screens show about the traffic model.
 *  - Demo mode (the city-wide land-use model is active): no validation chip, badge or note on the main screens (the user's
 *    choice); the model and its data are disclosed in the Data catalogue and the docs. Never a "validated" or pass state.
 *  - Otherwise: the recorded result as a known, disclosed model limitation, in amber; red stays for app errors.
 */
export type TrustPillState = 'hidden' | 'limitation';
export const trustPillState = (demo: boolean): TrustPillState => (demo ? 'hidden' : 'limitation');

export type SimulateNoteState = 'none' | 'limitation';
export const simulateNoteState = (demo: boolean): SimulateNoteState => (demo ? 'none' : 'limitation');

/** The one-click city-wide model switch (persisted). Named for what it is; its data's disclosure is in the Data catalogue. */
export const CITY_MODEL_LABEL = 'City-wide land-use model';
export const CITY_MODEL_NOTE = 'Trips from every building in Pune to every other, on roads modelled to Indian standards (Indo-HCM). Switching needs a new baseline.';
