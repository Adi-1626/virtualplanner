import { describe, expect, it } from 'vitest';
import { baselineSaveLabel, baselineScenarioWarning } from '../../components/simulate/baselineScenario';

describe('Simulate baseline button says which network it saves (QA 2026-11-22)', () => {
  it('in Base: the existing city, no warning', () => {
    expect(baselineSaveLabel({ isProposal: false, name: 'Current City (Base)' }, false)).toBe('Save existing city');
    expect(baselineScenarioWarning({ isProposal: false, name: 'Current City (Base)' }, false)).toBeNull();
  });
  it('in a proposal: never labelled "existing city", and warns before the first save', () => {
    const s = { isProposal: true, name: 'QA Link Road' };
    expect(baselineSaveLabel(s, false)).not.toMatch(/existing city/);
    expect(baselineScenarioWarning(s, false)).toContain('“QA Link Road”');
    expect(baselineScenarioWarning(s, false)).toContain('Switch to Current City (Base)');
    expect(baselineScenarioWarning(s, true)).toBeNull();
  });
});
