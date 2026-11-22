/**
 * "Save existing city" runs the network as it is now, and the network includes the active alternative's objects.
 * QA 2026-11-22: saved while a proposal was active, the baseline already held the proposal's drawn road, so Compare
 * could only show "no change". This says what the button would really save, and how to save the existing city.
 */
export interface BaselineScenarioInfo { isProposal: boolean; name: string }

export function baselineSaveLabel(s: BaselineScenarioInfo, hasBaseline: boolean): string {
  if (!s.isProposal) return hasBaseline ? 'Save again' : 'Save existing city';
  return hasBaseline ? 'Save again (this proposal)' : 'Save this proposal as baseline';
}

export function baselineScenarioWarning(s: BaselineScenarioInfo, hasBaseline: boolean): string | null {
  if (!s.isProposal || hasBaseline) return null;
  return `You are in the proposal “${s.name}”: saving now would take its network, with its changes, as the baseline, `
    + 'so Compare could not show what the changes do. Switch to Current City (Base) to save the existing city, then come back to this proposal and Compare.';
}
