import { describe, expect, it, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelTrustPill } from '../../components/ui/badges/ModelTrustPill';
import { trustPillState, simulateNoteState, CITY_MODEL_LABEL } from '../../components/ui/badges/demoStates';
import { TrustBadge } from '../../components/ui/badges/TrustBadge';
import { TRUST_COLOR } from '../../components/ui/badges/honesty';
import { SimulateContext } from '../../shell/contexts/SimulateContext';
import { demoModeStore, readPersistedDemoMode, persistDemoMode } from '../simulation/demoMode';
import { engineInstance } from '../TwinCityEngine';
import { setDemoMode } from '../../shell/demoModeToggle';

/** p15 (docs/urbanos/DEMO_P15.md): what the main screens show about the traffic model, with and without demo mode. */

describe('p15 banner states', () => {
  it('top bar: no chip in demo mode; an amber "known limitation" chip otherwise, never red, never a pass', () => {
    expect(trustPillState(true)).toBe('hidden');
    expect(trustPillState(false)).toBe('limitation');
    expect(renderToStaticMarkup(createElement(ModelTrustPill, { demo: true }))).toBe('');
    const html = renderToStaticMarkup(createElement(ModelTrustPill, { demo: false }));
    expect(html).toContain('data-state="limitation"');
    expect(html).toContain('Traffic model fails validation');
    expect(html).not.toContain('var(--fail');
    expect(html).toContain('var(--warn');
    expect(html).not.toMatch(/\bValidated\b|passes|Matches estimated data/);
  });
  it('inspector badges: hidden in demo mode (stale badges stay); amber otherwise', () => {
    expect(renderToStaticMarkup(createElement(TrustBadge, { trust: 'fails_validation', demo: true }))).toBe('');
    expect(renderToStaticMarkup(createElement(TrustBadge, { trust: 'not_validated', demo: true }))).toBe('');
    expect(renderToStaticMarkup(createElement(TrustBadge, { trust: 'stale', demo: true }))).toContain('data-trust="stale"');
    const html = renderToStaticMarkup(createElement(TrustBadge, { trust: 'fails_validation', demo: false }));
    expect(html).toContain('Fails validation (TAG M3.1)');
    expect(TRUST_COLOR.fails_validation).toContain('--warn');
  });
  it('Simulate panel: in demo mode no banner, no "synthetic", no validation words in the models list', () => {
    expect(simulateNoteState(true)).toBe('none');
    expect(simulateNoteState(false)).toBe('limitation');
    const demo = renderToStaticMarkup(createElement(SimulateContext, { demo: true }));
    expect(demo).not.toContain('simulate-validation-banner');
    expect(demo).not.toMatch(/synthetic|Not validated|Fails validation|About these numbers/i);
    expect(demo).toContain(CITY_MODEL_LABEL);
    expect(demo).toContain('demo-mode-toggle');
    const off = renderToStaticMarkup(createElement(SimulateContext, { demo: false }));
    expect(off).toContain('data-testid="simulate-validation-banner"');
    expect(off).toContain('uos-banner-warn');
    expect(off).not.toContain('uos-banner-fail'); // red only for app errors
    expect(off).toContain('About these numbers');
    expect(off).toContain('Not validated');
    expect(off).not.toMatch(/\bValidated\b|passes the project check|Matches estimated data/);
  });
});

describe('p15 demo mode switch', () => {
  beforeEach(() => { localStorage.clear(); });
  it('one switch: the land-use demand and the p14 road supply; persisted; the store follows the engine', () => {
    expect(readPersistedDemoMode()).toBe(false);
    setDemoMode(true);
    expect(readPersistedDemoMode()).toBe(true);
    expect(demoModeStore.get()).toBe(true);
    expect(engineInstance.simMode.useSyntheticDemand).toBe(true);
    expect(engineInstance.simMode.supplyModel).toBe('p14');
    setDemoMode(false);
    expect(readPersistedDemoMode()).toBe(false);
    expect(demoModeStore.get()).toBe(false);
    expect(engineInstance.simMode.useSyntheticDemand).toBe(false);
    persistDemoMode(true);
    expect(readPersistedDemoMode()).toBe(true);
  });
});
