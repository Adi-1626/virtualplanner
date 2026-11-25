/**
 * p15 red-error sweep (docs/urbanos/DEMO_P15.md): app and API failures in these panels are shown through the neutral
 * ErrorNotice with userErrorText, never as a red Notice or a raw `error` string in brackets. Red stays only for traffic
 * conditions and results (congestion, GEH fails, worse-than-before), which these checks do not touch.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { userErrorText } from '../../lib/errorCatalogue';
import { ErrorNotice } from '../../components/ui/ErrorNotice';

const SRC = path.resolve(__dirname, '../..');
const SWEPT = [
  'components/CalibrationPanel.tsx', 'components/FeasibilityPanel.tsx', 'components/PlanningPanel.tsx',
  'components/ScenarioGeneratorPanel.tsx', 'components/ScenarioVersions.tsx', 'components/TrafficDataPanel.tsx',
  'components/data/DataCatalogueSection.tsx', 'components/data/DataCatalogueView.tsx', 'components/data/FactUpdatesPane.tsx',
  'components/environment/EnvDataPanels.tsx', 'components/projects/AlternativesTab.tsx', 'components/projects/OverviewTab.tsx',
  'components/projects/ProjectPage.tsx', 'shell/contexts/ReportsContext.tsx',
];

describe('p15 red-error sweep', () => {
  it.each(SWEPT)('%s shows failures through ErrorNotice', f => {
    const s = fs.readFileSync(path.join(SRC, f), 'utf8');
    expect(s).toContain('ErrorNotice');
    expect(s).toContain('userErrorText');
    expect(s).not.toMatch(/<Notice tone="bad"/);
    expect(s).not.toMatch(/\(\{err(or)?\}\)/);           // "… ({error})." raw text in brackets
    expect(s).not.toMatch(/text-rose-300">\{(err|error)\}/);
  });

  it('error toasts and the crash screen are neutral', () => {
    const shell = fs.readFileSync(path.join(SRC, 'shell/AppShell.tsx'), 'utf8');
    expect(shell).toMatch(/type === 'error' \? \{ message: userErrorText\(message, 'load'\), type: 'notice' \}/);
    const eb = fs.readFileSync(path.join(SRC, 'components/ui/ErrorBoundary.tsx'), 'utf8');
    expect(eb).not.toMatch(/rose-/);
    expect(eb).toContain('userErrorText(this.state.error?.message');
    const badge = fs.readFileSync(path.join(SRC, 'components/ui/ConnectionBadge.tsx'), 'utf8');
    expect(badge).not.toMatch(/rose-/);
  });

  it('a raw runtime fault in a load error renders as the neutral catalogue text', () => {
    const html = renderToStaticMarkup(createElement(ErrorNotice, { prefix: 'The project could not be loaded.', message: userErrorText("Cannot read properties of undefined (reading 'id')", 'load') }));
    expect(html).toContain('data-testid="error-notice"');
    expect(html).toContain('The project could not be loaded.');
    expect(html).not.toMatch(/Cannot read|undefined|rose-|red-/);
  });
});
