import { afterEach, describe, expect, it, vi } from 'vitest';
import { CROSS_SECTION_TEMPLATES, elementsTotalM, templateById, templateForRow, SOURCES, type XsElement } from '../crossSection/templates';
import { commitCrossSectionTemplate, profileElements, sectionView, templateRoadUpdates, templateSection, templateStillMatches, upgradeBlockReason, type SectionWithTemplate } from '../crossSection/apply';
import { checkCrossSection } from '../crossSection/checks';
import { hasCompleteSectionCoverage } from '../objects/roadSections';
import { EditingEngine } from '../editing/EditingEngine';
import { loadNetwork, canon, type DbRow } from './editHarness';
import type { RoadObject } from '../objects/types';

/**
 * Street cross-section templates, screening checks and the template upgrade (docs/urbanos/CROSS_SECTIONS.md).
 * SYNTHETIC roads at 18.5°N, 73.85°E.
 */
const LAT = 18.5, LNG = 73.85, dLat = (m: number) => m / 111320, dLng = (m: number) => m / (111320 * Math.cos(LAT * Math.PI / 180));
const row = (id: string, pts: [number, number][], props: Record<string, unknown> = {}): DbRow => ({
  id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base',
  coordinates: pts.map(([x, y]) => [LNG + dLng(x), LAT + dLat(y), 0]),
  properties: {
    roadClass: 'collector', width: 10, laneCount: 2, laneWidth: 3.5, hasDivider: false, dividerWidth: 0, hasFootpath: true, footpathWidth: 1.5,
    speedLimit: 40, isOneWay: false, trafficCapacity: 2000, connectedJunctions: [], ...props,
  },
});
const osm = { osmProvenance: { osmId: 7, originalTags: { highway: 'secondary' }, layer: 0, bridge: false, tunnel: false, roundabout: false } };

function setup(rows: DbRow[]) {
  vi.spyOn(EditingEngine.prototype, 'fetchSavedAreas').mockResolvedValue();
  const { om, history } = loadNetwork(rows, true); // frozen: an in-place write into a base object throws
  vi.spyOn(om, 'syncChanges').mockResolvedValue(undefined as any);
  vi.spyOn(om, 'syncPost').mockResolvedValue(undefined as any);
  vi.spyOn(om, 'syncPostMultiple').mockResolvedValue(undefined as any);
  const baseKey = () => canon(om.viewOf('base').map(o => ({ ...o, updatedAt: undefined })).sort((a, b) => a.id.localeCompare(b.id)));
  return { om, history, baseKey };
}

describe('cross-section templates (Pune USDG 2016)', () => {
  it('every template adds up to its RoW and carries a source with section and pages', () => {
    expect(CROSS_SECTION_TEMPLATES.map(t => t.rowM)).toEqual([12, 18, 24, 30, 36]);
    for (const t of CROSS_SECTION_TEMPLATES) {
      expect(elementsTotalM(t.elements)).toBe(t.rowM);
      expect(t.source.key).toBe('USDG');
      expect(t.source.pdfPage - t.source.printedPage).toBe(21);
      expect(t.source.section).toContain(t.code);
      expect(t.widthsRead).toMatch(/OCR/);
      expect(t.elements.filter(e => e.kind === 'footpath')).toHaveLength(2);
    }
    expect(SOURCES.USDG.status).toBe('official (PMC)');
    expect(SOURCES.IRC86.status).toMatch(/unconfirmed/);
  });

  it('USDG in-between rule: a RoW between templates takes the next smaller one', () => {
    expect(templateForRow(20)?.code).toBe('18A');
    expect(templateForRow(24)?.code).toBe('24A');
    expect(templateForRow(40)?.code).toBe('36A');
    expect(templateForRow(10)).toBeUndefined();
  });

  it('maps a divided template onto carriageways, median and roadsides, and reads the same strips back', () => {
    const t = templateById('usdg-24a')!;
    const s = templateSection(t, 0, 3, { originalSource: 'manual', originalConfidence: 'estimated', geometryModified: false, profileModified: true, lastModifiedBy: 'manual', verificationStatus: 'unverified' });
    expect(s.hasMedian).toBe(true);
    expect(s.medianWidth).toBe(1);
    expect(s.carriagewayA).toMatchObject({ lanes: 2, laneWidth: 2.75 });
    expect(s.carriagewayB).toMatchObject({ lanes: 2, laneWidth: 2.75 });
    expect(s.carriagewayA.leftRoadside).toMatchObject({ footpathWidth: 2.5, cycleTrackWidth: 2, vergeWidth: 1.5, parkingWidth: 0 });
    expect(s.carriagewayB!.rightRoadside).toMatchObject({ footpathWidth: 2.5, cycleTrackWidth: 2, vergeWidth: 1.5 });
    expect(s.totalRowWidth).toBe(24);
    expect(templateStillMatches(s)).toBe(true);
    expect(elementsTotalM(profileElements(s))).toBe(24);
    expect(sectionView(s).template?.code).toBe('24A');
  });

  it('an edit after applying is detected: the strips are then read from the profile', () => {
    const s = templateSection(templateById('usdg-12a')!, 0, 1, { originalSource: 'manual', originalConfidence: 'estimated', geometryModified: false, profileModified: true, lastModifiedBy: 'manual', verificationStatus: 'unverified' });
    expect(s.carriagewayA).toMatchObject({ direction: 'both', lanes: 1, laneWidth: 3 });
    const edited = structuredClone(s) as SectionWithTemplate;
    edited.carriagewayA.leftRoadside.footpathWidth = 1.2;
    const v = sectionView(edited);
    expect(v.templateEdited).toBe(true);
    expect(v.template).toBeUndefined();
    expect(v.elements.find(e => e.kind === 'footpath')!.widthM).toBe(1.2);
  });
});

describe('cross-section checks (screening)', () => {
  const els = (over: Partial<Record<string, number>> = {}): XsElement[] => [
    { kind: 'footpath', widthM: over.leftFp ?? 2, label: 'fp' },
    { kind: 'carriageway', widthM: over.cw ?? 7, lanes: 2, direction: 'both', label: 'cw' },
    ...(over.rightFp === 0 ? [] : [{ kind: 'footpath' as const, widthM: over.rightFp ?? 2, label: 'fp' }]),
  ];
  const byId = (c: ReturnType<typeof checkCrossSection>, id: string) => c.find(x => x.id === id)!;

  it('footpath: below 1.8 m fails (IRC:86), 1.8–2.0 m warns (USDG), 2.0 m no flag; every result is screening with a source', () => {
    const c = checkCrossSection(els({ leftFp: 1.5, rightFp: 1.9 }), { roadClass: 'collector' });
    expect(byId(c, 'footpath-width-left').status).toBe('fail');
    expect(byId(c, 'footpath-width-right').status).toBe('warn');
    expect(byId(checkCrossSection(els(), { roadClass: 'collector' }), 'footpath-width-left').status).toBe('pass');
    for (const x of c) {
      expect(x.screening).toBe(true);
      expect(x.message).toMatch(/Screening only/);
      expect(x.basis.length).toBeGreaterThan(5);
    }
    expect(byId(c, 'footpath-width-left').basis).toMatch(/IRC:86-2018 §5\.1 Table 5\.1.*unconfirmed/);
    expect(byId(c, 'footpath-width-left').basis).toMatch(/USDG 2016 §3\.1.*official \(PMC\)/);
    expect(byId(c, 'footpath-land-use').status).toBe('unknown');
  });

  it('lane width: < 3.0 m fails, 3.0–3.5 m warns (info on a local road), 3.5 m no flag, wider is info', () => {
    expect(byId(checkCrossSection(els({ cw: 5.5 }), { roadClass: 'arterial' }), 'lane-width-1').status).toBe('fail');
    expect(byId(checkCrossSection(els({ cw: 6 }), { roadClass: 'arterial' }), 'lane-width-1').status).toBe('warn');
    expect(byId(checkCrossSection(els({ cw: 6 }), { roadClass: 'local' }), 'lane-width-1').status).toBe('info');
    expect(byId(checkCrossSection(els({ cw: 7 }), { roadClass: 'arterial' }), 'lane-width-1').status).toBe('pass');
    expect(byId(checkCrossSection(els({ cw: 8 }), { roadClass: 'arterial' }), 'lane-width-1').status).toBe('info');
  });

  it('right-of-way: unknown stays unknown; wider than a known RoW fails; within it passes', () => {
    expect(byId(checkCrossSection(els(), { roadClass: 'collector' }), 'row-fit').status).toBe('unknown');
    expect(byId(checkCrossSection(els(), { roadClass: 'collector', availableRowM: null }), 'row-fit').status).toBe('unknown');
    const over = byId(checkCrossSection(els(), { roadClass: 'collector', availableRowM: 10, availableRowSource: 'DP sheet' }), 'row-fit');
    expect(over.status).toBe('fail');
    expect(over.basis).toContain('DP sheet');
    expect(byId(checkCrossSection(els(), { roadClass: 'collector', availableRowM: 12 }), 'row-fit').status).toBe('pass');
  });

  it('missing footpath fails on arterial / collector, is info on local, and is not checked on a highway', () => {
    expect(byId(checkCrossSection(els({ rightFp: 0 }), { roadClass: 'arterial' }), 'footpath-missing-right').status).toBe('fail');
    expect(byId(checkCrossSection(els({ rightFp: 0 }), { roadClass: 'collector' }), 'footpath-missing-right').status).toBe('fail');
    expect(byId(checkCrossSection(els({ rightFp: 0 }), { roadClass: 'local' }), 'footpath-missing-right').status).toBe('info');
    expect(checkCrossSection(els({ rightFp: 0 }), { roadClass: 'highway' }).find(x => x.id === 'footpath-missing-right')).toBeUndefined();
  });

  it('the USDG templates themselves are screened honestly (e.g. 24A has 2.75 m lanes, below IRC:86 3.0 m)', () => {
    const c = checkCrossSection(templateById('usdg-24a')!.elements, { roadClass: 'arterial' });
    expect(c.filter(x => x.id.startsWith('lane-width')).map(x => x.status)).toEqual(['fail', 'fail']);
    expect(c.filter(x => x.id.startsWith('footpath-width')).map(x => x.status)).toEqual(['pass', 'pass']);
  });
});

describe('upgrade an existing road to a template', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a drawn road: one section over the whole line, legacy fields derived, one Undo step restores it exactly', () => {
    const t = setup([row('drawn_1', [[0, 0], [60, 0], [120, 10]])]);
    const road = t.om.getById('drawn_1') as RoadObject;
    const before = canon({ ...road, updatedAt: undefined });
    const depth = (t.history as any).undoStack.length;
    const res = commitCrossSectionTemplate(t.om, t.history, road, templateById('usdg-30a')!, 'base');
    expect(res.ok).toBe(true);
    const after = t.om.getById('drawn_1') as RoadObject;
    expect(after.coordinates).toEqual(road.coordinates); // plan geometry and crossings unchanged
    expect(hasCompleteSectionCoverage(after.sections!, after.coordinates.length)).toBe(true);
    expect(after.sections).toHaveLength(1);
    expect((after.sections![0] as SectionWithTemplate).crossSection?.code).toBe('30A');
    expect((after.sections![0] as SectionWithTemplate).crossSection?.replaced?.length).toBeGreaterThan(0);
    expect(after).toMatchObject({ laneCount: 4, laneWidth: 3, hasDivider: true, dividerWidth: 1, footpathWidth: 4 });
    expect(after.sections![0].provenance).toMatchObject({ profileModified: true, lastModifiedBy: 'manual' });
    expect((t.history as any).undoStack.length).toBe(depth + 1);
    t.history.undo();
    expect(canon({ ...(t.om.getById('drawn_1') as RoadObject), updatedAt: undefined })).toBe(before);
  });

  it('an OSM road: refused in the baseline; in a proposal it becomes the proposal\'s copy and the baseline row is untouched', () => {
    const t = setup([row('osm_7', [[0, 0], [80, 0]], osm)]);
    const base0 = t.baseKey();
    const road = t.om.getById('osm_7') as RoadObject;
    expect(upgradeBlockReason(road, { activeScenarioId: 'base', baseScenarioId: 'base' })).toMatch(/never edited/);
    const refused = commitCrossSectionTemplate(t.om, t.history, road, templateById('usdg-18a')!, 'base');
    expect(refused.ok).toBe(false);
    expect(t.baseKey()).toBe(base0);

    t.om.setActiveScenario('P');
    const inP = t.om.getById('osm_7') as RoadObject;
    const res = commitCrossSectionTemplate(t.om, t.history, inP, templateById('usdg-18a')!, 'base');
    expect(res.ok).toBe(true);
    expect(t.baseKey()).toBe(base0);
    expect(t.om.overlayOf('P').get('osm_7')).toBeTruthy();
    const copy = t.om.getById('osm_7') as RoadObject;
    expect((copy.sections![0] as SectionWithTemplate).crossSection?.code).toBe('18A');
    expect(copy.osmProvenance?.osmId).toBe(7);
    expect(copy.sections![0].provenance.originalSource).toBe('OSM');
    t.history.undo();
    expect(t.om.overlayOf('P').get('osm_7')).toBeFalsy();
    expect(t.baseKey()).toBe(base0);
  });

  it('templateRoadUpdates keeps a flyover ramp capacity cut', () => {
    const r = { ...(row('x', [[0, 0], [10, 0]]).properties as any), id: 'x', type: 'road', coordinates: [[0, 0, 0], [1, 0, 0]], flyoverImpact: { capacityReductionPercent: 25 } } as RoadObject;
    expect(templateRoadUpdates(r, templateById('usdg-24a')!).trafficCapacity).toBe(3000);
  });
});

describe('Road tool: drawing with a template', () => {
  afterEach(() => vi.restoreAllMocks());
  it('a road drawn with a template gets its section; without one the class defaults stay', () => {
    const t = setup([]);
    const ed = new EditingEngine(t.om, t.history, undefined, {} as any);
    const draw = (pts: [number, number][]) => {
      ed.setMode('draw_road');
      for (const [x, y] of pts) ed.addDrawingPoint([LNG + dLng(x), LAT + dLat(y), 0]);
      const before = new Set(t.om.getAll().map(o => o.id));
      ed.finalizeDrawing('base');
      ed.setMode('select');
      return t.om.getAll().find(o => !before.has(o.id)) as RoadObject;
    };
    ed.roadClass = 'arterial';
    ed.roadTemplateId = 'usdg-36a';
    const a = draw([[0, 0], [100, 0]]);
    expect((a.sections![0] as SectionWithTemplate).crossSection?.code).toBe('36A');
    expect(a.sections![0].totalRowWidth).toBe(36);
    expect(a.roadClass).toBe('arterial');
    expect(hasCompleteSectionCoverage(a.sections!, a.coordinates.length)).toBe(true);
    ed.roadTemplateId = null;
    const b = draw([[0, 200], [100, 200]]);
    expect((b.sections?.[0] as SectionWithTemplate | undefined)?.crossSection).toBeUndefined();
    expect(b.laneWidth).toBe(3.5);
  });
});

describe('cross-section UI (static render)', () => {
  it('Road tool settings offer the templates with a diagram and the source; the panel shows checks labelled screening', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { engineInstance } = await import('../TwinCityEngine');
    const { ToolSettings } = await import('../../components/design/ToolSettings');
    const { CrossSectionPanel } = await import('../../components/design/CrossSectionPanel');
    const plain = renderToStaticMarkup(createElement(ToolSettings, { mode: 'draw_road' }));
    expect(plain).toContain('Class default (no template)');
    expect(plain).toContain('USDG 18A');
    engineInstance.editing.roadTemplateId = 'usdg-18a';
    const withT = renderToStaticMarkup(createElement(ToolSettings, { mode: 'draw_road' }));
    expect(withT).toContain('tool-setting-template-diagram');
    expect(withT).toMatch(/Pune USDG 2016 ch\. 8 template 18A.*p\. 64 \(PDF p\. 85\)/);
    engineInstance.editing.roadTemplateId = null;

    const r = { ...(row('ui', [[0, 0], [50, 0]]).properties as any), id: 'ui', type: 'road', name: 'UI road', scenarioId: 'base', coordinates: [[73.85, 18.5, 0], [73.851, 18.5, 0]] } as RoadObject;
    r.sections = templateRoadUpdates(r, templateById('usdg-24a')!).sections;
    const html = renderToStaticMarkup(createElement(CrossSectionPanel, { road: r }));
    expect(html).toContain('data-testid="xs-checks"');
    expect(html).toContain('>screening<');
    expect(html).toContain('Template 24A');
    expect(html).toMatch(/data-testid="xs-check-row-fit" data-status="unknown"/);
    // After an upgrade the panel keeps the before / after diagrams
    const up = { ...r, ...templateRoadUpdates(r, templateById('usdg-30a')!) } as RoadObject;
    const html2 = renderToStaticMarkup(createElement(CrossSectionPanel, { road: up }));
    expect(html2).toContain('data-testid="xs-before-after"');
    expect(html2).toContain('After — template 30A');
  });
});
