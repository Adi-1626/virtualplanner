import { create } from 'zustand';
import type { Suggestion } from '../engine/simulation/improvements';
import type { SimulationModeState, TrafficRunSnapshot } from '../engine/simulation/SimulationMode';
import { seedKeyOf } from '../engine/simulation/SimulationMode';
import {
  afterReload, changedSince, decideBeforeReturn, decideInSimulate, figuresOf, IMPROVABLE, parseTrip, proposalSnapshot, summariseChanges,
  NOTHING_CHANGED_TEXT, SAME_AS_BASELINE_TEXT, SAME_AS_LAST_TEXT, ROUND_TRIP_VERSION, verdictWord,
  type ChangeSummary, type RoundTripState, type TripObject, type TripStorage, type TripStudy, type TripTarget, type TripTest,
} from '../engine/simulation/roundTrip';
import type { StudyDirection } from '../engine/simulation/StudyAreaExplorer';
import type { DayType } from '../engine/simulation/timeOfDay';

/**
 * The round trip from a Simulate study to Design and back (docs/urbanos/SIM_FLOW_P12.md §3). One controller for the
 * app; the engine and the shell are reached through `RoundTripDeps` so the flow can be tested without Cesium.
 *
 * Rules it keeps:
 * - The existing city (Base) is never edited by the flow: a change goes into a proposal (the active one, or a new one
 *   the flow names), and while a test is open Base is read-only in Design.
 * - The comparison is always against the baseline saved from the existing city for this study (same roads, range,
 *   direction, trips, hour and seeds); when there is none, the flow saves it first and says so.
 * - Nothing is left half-done: every step ends with the leg either finished (a result or a plain reason) or back to
 *   editing with the reason on the bar, never a stuck progress line.
 */

const BASE = 'base';
/** A message as part of a sentence: no trailing full stop (it is added after). */
const reasonOf = (x: string | null | undefined, fallback: string) => (x ?? fallback).trim().replace(/[.\s]+$/, '');

export interface RoundTripDeps {
  sim: {
    getState(): SimulationModeState;
    subscribe(cb: () => void): () => void;
    captureBaseline(): Promise<TrafficRunSnapshot | null>;
    runComparison(): Promise<TrafficRunSnapshot | null>;
    whenSettled(timeoutMs?: number): Promise<boolean>;
    networkKeyNow(): string;
    baselineInfo(): { networkKey: string; scenarioId: string; forThisStudy: boolean } | null;
    restoreStudy(o: { seedRoadIds: readonly string[]; rangeMeters: number; direction: StudyDirection }): void;
    setHour(h: number): void;
    setDayType(d: DayType): void;
    setOverlay(o: 'comparison' | 'none'): void;
  };
  scenarios: {
    getActiveScenarioId(): string;
    get(id: string): { id: string; name: string; isBase?: boolean } | undefined;
    setActiveScenario(id: string): void;
    onChange(cb: () => void): () => void;
  };
  objects: {
    getByScenario(sid: string): TripObject[];
    overlayOf(sid: string): ReadonlyMap<string, TripObject | null>;
    getAllStored(): TripObject[];
    onChange(cb: () => void): () => void;
  };
  history: { getUndoStackCount(): number; canUndo(): boolean; undo(): unknown };
  createProposal(name: string, description: string): Promise<{ id: string; name: string }>;
  deleteProposal(id: string): Promise<void>;
  /** Switches workspace the way the rail does (and so the engine mode). */
  goTo(ws: 'design' | 'simulate'): void;
  workspace(): string;
  /** The engine mode ('build' while in Design or Underground). */
  appMode(): string;
  onAppMode(cb: () => void): () => void;
  setSimulateTab(t: 'improve'): void;
  focusInDesign(target: TripTarget | null, studyRoadIds: readonly string[]): void;
  /** Locks or unlocks drawing and Undo in Design (the engine's own lock, as Simulate uses). */
  setEditingLocked(locked: boolean): void;
  storage: TripStorage;
  now(): string;
  /** Waits (ms); tests pass a fast one. */
  sleep(ms: number): Promise<void>;
}

/** What the bar and the panel show. */
export interface RoundTripView {
  trip: RoundTripState | null;
  /** The leg's changes so far (recomputed shortly after each edit). */
  changes: ChangeSummary | null;
  /** A question the bar is asking before it goes back (outside the area, underground only, discard changes). */
  ask: null | { kind: 'outside'; names: string[] } | { kind: 'underground' } | { kind: 'cancel' };
  /** Base is active in Design during a leg (editing locked). */
  baseActive: boolean;
}

export const useRoundTrip = create<RoundTripView>(() => ({ trip: null, changes: null, ask: null, baseActive: false }));

const EMPTY_CHANGES: ChangeSummary = { total: 0, network: 0, inArea: 0, underground: 0, demand: 0, other: 0, outsideNames: [] };

export class RoundTripController {
  private runToken = 0;
  private lockedByUs = false;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private unsub: (() => void)[] = [];

  private readonly d: RoundTripDeps;

  constructor(d: RoundTripDeps) {
    this.d = d;
    const stored = parseTrip(d.storage.get());
    if (stored) this.set({ trip: afterReload(stored) });
    this.unsub.push(d.scenarios.onChange(() => this.onScenarioChange()));
    this.unsub.push(d.objects.onChange(() => this.scheduleChangeCount()));
    this.unsub.push(d.onAppMode(() => this.syncBaseGuard()));
    this.syncBaseGuard();
  }

  dispose() { this.unsub.forEach(u => u()); this.unsub = []; if (this.changeTimer) clearTimeout(this.changeTimer); }

  get view(): RoundTripView { return useRoundTrip.getState(); }
  private get trip(): RoundTripState | null { return this.view.trip; }

  private set(patch: Partial<RoundTripView>) {
    useRoundTrip.setState(patch);
    if ('trip' in patch) this.d.storage.set(patch.trip ? JSON.stringify(patch.trip) : null);
  }
  private patchTrip(patch: Partial<RoundTripState>) {
    const t = this.trip;
    if (t) this.set({ trip: { ...t, ...patch } });
  }
  private status(tone: 'info' | 'warn' | 'bad' | 'good', text: string, retry = false) { this.patchTrip({ status: { tone, text, ...(retry ? { retry } : {}) } }); }

  // ── Start ────────────────────────────────────────────────────────────────

  /** The study on show, as the trip keeps it. Null without a mapped study. */
  private studyNow(): TripStudy | null {
    const s = this.d.sim.getState();
    if (!s.seedRoadIds.length || !s.area) return null;
    const label = s.closedRoads.length ? s.closedRoads.map(c => c.name || 'the studied road').join(' + ') : (s.section?.name ?? 'the studied road');
    return { seedRoadIds: [...s.seedRoadIds], label, rangeMeters: s.rangeMeters, direction: s.direction, hour: s.timeOfDay.hour, day: s.timeOfDay.day, bounds: s.area.bounds };
  }

  /** The target in Design for a suggestion (a diversion targets the parallel road it names). */
  targetOf(s: Suggestion): TripTarget | null {
    if (!IMPROVABLE.has(s.kind)) return null;
    const st = this.d.sim.getState();
    if (s.kind === 'divert') {
      const out = st.analysis.output?.result;
      const spare = out?.nearby.find(n => s.title.includes(n.roadName));
      const keys = new Set(spare?.segmentKeys ?? []);
      const ids = [...new Set((st.area?.segments ?? []).filter(x => keys.has(x.key)).map(x => x.roadId))];
      return { kind: s.kind, title: s.title, roadIds: ids.length ? ids : st.seedRoadIds, at: null };
    }
    return { kind: s.kind, title: s.title, roadIds: s.action?.roadIds ?? st.section?.roadIds ?? st.seedRoadIds, at: s.action?.at ?? null, junction: s.action?.junction };
  }

  /**
   * "Improve this" (a suggestion) or "Make my own change" (null): saves the existing city as the baseline first when
   * there is none for this study and Base is on show, opens a proposal, and goes to Design with the target in view.
   */
  async start(s: Suggestion | null): Promise<boolean> {
    const token = ++this.runToken;
    const study = this.studyNow();
    if (!study) return false;
    const target = s ? this.targetOf(s) : null;
    const prev = this.trip;
    const sameStudy = !!prev && seedKeyOf(prev.study.seedRoadIds) === seedKeyOf(study.seedRoadIds) && prev.study.rangeMeters === study.rangeMeters && prev.study.direction === study.direction;
    this.set({ trip: { v: ROUND_TRIP_VERSION, study, leg: null, tests: sameStudy ? prev!.tests : [], status: null, baselineSavedByFlow: sameStudy ? prev!.baselineSavedByFlow : false }, ask: null, changes: null });

    // The baseline: saved from the existing city for this study. On Base it is usually the analysis on show (no run).
    const b = this.d.sim.baselineInfo();
    const active = this.d.scenarios.getActiveScenarioId();
    if ((!b || !b.forThisStudy || b.scenarioId !== BASE) && active === BASE) {
      this.status('info', 'Saving the existing city as the baseline first: every test of this study is compared with it.');
      const snap = await this.d.sim.captureBaseline();
      if (token !== this.runToken) return false;
      if (!snap) { this.status('bad', `The baseline could not be saved: ${reasonOf(this.d.sim.getState().comparison.staleReason, 'the run stopped')}. Nothing was changed.`, true); return false; }
      this.patchTrip({ baselineSavedByFlow: true, status: null });
    }

    // Leave Simulate first (it stops its runs; a scenario switch while it is open would re-run the study)
    this.d.goTo('design');
    let proposalId = this.d.scenarios.getActiveScenarioId(), createdProposal = false;
    if (proposalId === BASE) {
      const name = `${study.label}: ${target ? target.title : 'my change'}`.slice(0, 110);
      try {
        const p = await this.d.createProposal(name, `Made from the Simulate study of ${study.label} (${String(study.hour).padStart(2, '0')}:00, ${study.rangeMeters >= 1000 ? `${study.rangeMeters / 1000} km` : `${study.rangeMeters} m`} area) to test: ${target?.title ?? 'a change of my own'}. The existing city is not changed.`);
        if (token !== this.runToken) return false;
        proposalId = p.id; createdProposal = true;
      } catch (e) {
        this.status('bad', `A proposal could not be created (${e instanceof Error ? e.message : String(e)}). The existing city was not changed. Pick or create a proposal with the switcher at the top, then use “Make my own change”.`);
        return false;
      }
    }
    const pname = this.d.scenarios.get(proposalId)?.name ?? proposalId;
    this.patchTrip({
      leg: { id: `leg_${Date.now().toString(36)}`, startedAt: this.d.now(), target, proposalId, proposalName: pname, createdProposal,
        startSnapshot: this.snapshot(proposalId), undoCountAtStart: this.d.history.getUndoStackCount(), phase: 'editing' },
      status: null,
    });
    this.set({ changes: EMPTY_CHANGES, ask: null });
    this.syncBaseGuard();
    this.d.focusInDesign(target, study.seedRoadIds);
    return true;
  }

  // ── Changes ──────────────────────────────────────────────────────────────

  private snapshot(pid: string) { return proposalSnapshot(this.d.objects.getByScenario(pid), this.d.objects.overlayOf(pid)); }

  /** The leg's changes now: added, changed or removed objects in its proposal since it started. */
  currentChanges(): ChangeSummary {
    const t = this.trip, leg = t?.leg;
    if (!t || !leg) return EMPTY_CHANGES;
    const now = this.snapshot(leg.proposalId);
    const ids = changedSince(leg.startSnapshot, now);
    if (!ids.length) return EMPTY_CHANGES;
    const want = new Set(ids);
    const found = new Map<string, TripObject>();
    for (const o of this.d.objects.getByScenario(leg.proposalId)) if (want.has(o.id)) found.set(o.id, o);
    const overlay = this.d.objects.overlayOf(leg.proposalId);
    for (const id of ids) { const v = overlay.get(id); if (v) found.set(id, v); }
    // A removed base object (or one whose change was undone) is looked up as stored
    if (found.size < ids.length) for (const o of this.d.objects.getAllStored()) if (want.has(o.id) && !found.has(o.id)) found.set(o.id, o);
    return summariseChanges(ids, id => found.get(id), t.study.bounds);
  }

  private scheduleChangeCount() {
    if (!this.trip?.leg) return;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => { this.changeTimer = null; if (this.trip?.leg) this.set({ changes: this.currentChanges() }); }, 300);
  }

  // ── Proposals and the existing city during a leg ────────────────────────

  private onScenarioChange() {
    const t = this.trip, leg = t?.leg;
    if (t && leg && leg.phase === 'editing') {
      const active = this.d.scenarios.getActiveScenarioId();
      if (active !== BASE && active !== leg.proposalId && this.d.scenarios.get(active)) {
        // Another proposal: the changes go there now; what was changed in the first one stays in it
        this.patchTrip({ leg: { ...leg, proposalId: active, proposalName: this.d.scenarios.get(active)!.name, createdProposal: false,
          startSnapshot: this.snapshot(active), undoCountAtStart: this.d.history.getUndoStackCount() } });
        this.set({ changes: EMPTY_CHANGES });
      } else if (active === leg.proposalId && t.resumed) {
        this.scheduleChangeCount();
      }
    }
    // After a reload the scenarios arrive late: put the leg's proposal back on show
    if (t?.leg && t.resumed && this.d.scenarios.getActiveScenarioId() === BASE && this.d.scenarios.get(t.leg.proposalId)) {
      this.d.scenarios.setActiveScenario(t.leg.proposalId);
      return;
    }
    this.syncBaseGuard();
  }

  /** While a leg is open, Base is read-only in Design and Underground (the engine's lock); unlocked otherwise. */
  private syncBaseGuard() {
    const leg = this.trip?.leg;
    const baseActive = !!leg && this.d.scenarios.getActiveScenarioId() === BASE;
    if (this.view.baseActive !== baseActive) this.set({ baseActive });
    const mode = this.d.appMode();
    if (mode === 'simulate') { this.lockedByUs = false; return; } // Simulate owns the lock while it is open
    const want = baseActive && mode === 'build';
    if (want && !this.lockedByUs) { this.d.setEditingLocked(true); this.lockedByUs = true; }
    else if (!want && this.lockedByUs) { this.d.setEditingLocked(false); this.lockedByUs = false; }
  }

  switchBackToProposal() {
    const leg = this.trip?.leg;
    if (leg && this.d.scenarios.get(leg.proposalId)) this.d.scenarios.setActiveScenario(leg.proposalId);
  }

  // ── Done – re-test ───────────────────────────────────────────────────────

  /**
   * "Done – re-test". `outsideAccepted`: re-test although the changes lie outside the study area; `widenTo`: re-test on a
   * larger area (a new baseline is saved for it). `noRetest`: go back without running (underground changes only).
   */
  async finish(o: { outsideAccepted?: boolean; widenTo?: number; noRetest?: boolean } = {}): Promise<void> {
    const t = this.trip, leg = t?.leg;
    if (!t || !leg || leg.phase === 'retesting') return;
    const changes = this.currentChanges();
    this.set({ changes });
    if (!o.noRetest && o.widenTo === undefined) {
      const dec = decideBeforeReturn(changes, { outsideAccepted: o.outsideAccepted });
      if (dec.action === 'outside-area') { this.set({ ask: { kind: 'outside', names: dec.names } }); return; }
      if (dec.action === 'underground-only') { this.set({ ask: { kind: 'underground' } }); return; }
    }
    this.set({ ask: null });
    await this.returnAndRetest({ widenTo: o.widenTo, retest: !o.noRetest, nothingChanged: changes.total === 0 });
  }

  /** "Return to study" without a re-test (Cancel → keep, or underground only), or with one. */
  private async returnAndRetest(o: { widenTo?: number; retest: boolean; nothingChanged?: boolean; cancelled?: string }) {
    const token = ++this.runToken;
    let t = this.trip!;
    const leg = t.leg;
    const study = o.widenTo !== undefined ? { ...t.study, rangeMeters: o.widenTo } : t.study;
    this.patchTrip({ study, leg: leg && o.retest ? { ...leg, phase: 'retesting' } : leg, status: { tone: 'info', text: o.retest ? 'Back in the study: mapping its roads…' : (o.cancelled ?? 'Back in the study.') }, resumed: false });
    if (!o.retest) this.patchTrip({ leg: null });
    this.syncBaseGuard();
    this.d.setSimulateTab('improve');
    this.d.goTo('simulate');
    // After a page reload the leg's proposal may still be loading
    if (leg && o.retest) {
      for (let i = 0; i < 50 && !this.d.scenarios.get(leg.proposalId); i++) await this.d.sleep(200);
      if (token !== this.runToken) return;
      if (!this.d.scenarios.get(leg.proposalId)) return this.fail(`The proposal “${leg.proposalName}” no longer exists, so there is nothing to re-test. The existing city was not changed.`, true);
      if (this.d.scenarios.getActiveScenarioId() !== leg.proposalId) this.d.scenarios.setActiveScenario(leg.proposalId);
    }
    this.d.sim.restoreStudy(study);
    const s0 = this.d.sim.getState();
    if (s0.timeOfDay.day !== study.day) this.d.sim.setDayType(study.day);
    if (s0.timeOfDay.hour !== study.hour) this.d.sim.setHour(study.hour);
    if (!o.retest) return;

    const settled = await this.d.sim.whenSettled();
    if (token !== this.runToken) return;
    if (!settled) return this.fail(this.notSettledText());

    // The baseline: from the existing city, for this study
    const b = this.d.sim.baselineInfo();
    const pid = leg!.proposalId;
    let savedNow = false;
    if (!b || !b.forThisStudy || b.scenarioId !== BASE) {
      const why = !b ? 'No baseline was saved for this study yet' : !b.forThisStudy ? 'The study area changed since the baseline' : 'The saved baseline was taken from a proposal, not the existing city';
      this.status('info', `${why}: step 1 of 2, saving the existing city (Base) as the baseline. It is not changed.`);
      this.d.scenarios.setActiveScenario(BASE);
      if (!(await this.d.sim.whenSettled()) || token !== this.runToken) return token === this.runToken ? this.fail(this.notSettledText()) : undefined;
      const snap = await this.d.sim.captureBaseline();
      if (token !== this.runToken) return;
      this.d.scenarios.setActiveScenario(pid);
      if (!snap) return this.fail(`The baseline could not be saved: ${reasonOf(this.d.sim.getState().comparison.staleReason, 'the run stopped')}.`);
      this.patchTrip({ baselineSavedByFlow: true });
      savedNow = true;
      if (!(await this.d.sim.whenSettled()) || token !== this.runToken) return token === this.runToken ? this.fail(this.notSettledText()) : undefined;
    }

    t = this.trip!;
    const last = t.tests.at(-1) ?? null;
    const st = this.d.sim.getState();
    const dec = decideInSimulate({ isProposal: this.d.scenarios.getActiveScenarioId() !== BASE, networkKey: this.d.sim.networkKeyNow(),
      baselineNetworkKey: this.d.sim.baselineInfo()?.networkKey ?? null, lastTestedNetworkKey: last?.networkKey ?? null, lastResultShown: !!st.comparison.result && !!st.comparison.current });
    if (dec.action === 'need-proposal') return this.fail(`The proposal “${leg!.proposalName}” is not on show.`, true);
    if (dec.action === 'same-as-baseline') { this.patchTrip({ leg: null, status: { tone: 'warn', text: (o.nothingChanged ? NOTHING_CHANGED_TEXT + ' ' : '') + SAME_AS_BASELINE_TEXT } }); return; }
    if (dec.action === 'same-as-last-test') { this.patchTrip({ leg: null, status: { tone: 'info', text: (o.nothingChanged ? NOTHING_CHANGED_TEXT + ' ' : '') + SAME_AS_LAST_TEXT } }); return; }

    const steps = savedNow ? 'step 2 of 2, ' : '';
    this.status('info', `${o.nothingChanged ? NOTHING_CHANGED_TEXT + ' The proposal differs from the last test, so it is re-tested: ' : ''}${steps}running “${leg!.proposalName}” on the baseline's trips, hour and seeds…`);
    const netKey = this.d.sim.networkKeyNow();
    const current = await this.d.sim.runComparison();
    if (token !== this.runToken) return;
    const c = this.d.sim.getState().comparison;
    if (!current || !c.result) return this.fail(`The re-test did not finish: ${reasonOf(c.staleReason, 'it was stopped')}.`);
    const test: TripTest = {
      iteration: (this.trip!.tests.at(-1)?.iteration ?? 0) + 1, proposalId: pid, proposalName: this.d.scenarios.get(pid)?.name ?? leg!.proposalName,
      target: leg!.target ? { kind: leg!.target.kind, title: leg!.target.title } : null, verdict: c.result.verdict.overall, confidence: c.result.confidence.level,
      summary: c.result.verdict.summary, networkKey: netKey, at: this.d.now(), figures: figuresOf(c.result),
    };
    this.patchTrip({ tests: [...this.trip!.tests, test], leg: null,
      status: { tone: 'good', text: `Re-tested “${test.proposalName}” against the existing city: ${verdictWord(test.verdict)} (confidence ${test.confidence}). The suggestions below are from this run.` } });
    this.d.sim.setOverlay('comparison');
  }

  private notSettledText() {
    const s = this.d.sim.getState();
    if (s.error) return `The study area could not be mapped: ${s.error}`;
    if (s.osmRoads.status === 'error') return `The roads around the study could not be loaded: ${s.osmRoads.error ?? 'the server could not be reached'}.`;
    if (!s.active) return 'The re-test stopped because Simulate was closed.';
    return 'The study area did not finish loading.';
  }

  /** A step that could not finish: the leg goes back to editing (the bar offers Done again), with the reason shown. */
  private fail(text: string, endLeg = false) {
    const t = this.trip;
    if (!t) return;
    this.patchTrip({ leg: t.leg && !endLeg ? { ...t.leg, phase: 'editing' } : endLeg ? null : t.leg, status: { tone: 'bad', text, retry: !!t.leg && !endLeg } });
    this.syncBaseGuard();
  }

  /** Re-test again after a failed step (the panel's Retry). */
  retry() { void this.finish({ outsideAccepted: true }); }

  // ── Cancel / end ─────────────────────────────────────────────────────────

  /** "Cancel": asks first when the leg changed something. */
  cancel() {
    const leg = this.trip?.leg;
    if (!leg) return;
    const changes = this.currentChanges();
    if (changes.total > 0) { this.set({ ask: { kind: 'cancel' }, changes }); return; }
    void this.returnAndRetest({ retest: false, cancelled: 'Cancelled: nothing was changed.' });
  }

  /** Cancel with changes: undo them (delete the proposal the flow made, or undo back to where the leg started) or keep them. */
  async cancelWith(mode: 'undo' | 'keep') {
    const leg = this.trip?.leg;
    if (!leg) return;
    this.set({ ask: null });
    if (mode === 'keep') { await this.returnAndRetest({ retest: false, cancelled: `Cancelled without a re-test. Your changes stay in “${leg.proposalName}”; the existing city was not changed.` }); return; }
    let note: string;
    if (leg.createdProposal) {
      try {
        this.d.scenarios.setActiveScenario(BASE);
        await this.d.deleteProposal(leg.proposalId);
        note = `Cancelled: the proposal “${leg.proposalName}” made for this test was deleted. The existing city was not changed.`;
      } catch (e) {
        note = `Cancelled, but the proposal “${leg.proposalName}” could not be deleted (${e instanceof Error ? e.message : String(e)}); its changes stay in it. The existing city was not changed.`;
      }
    } else {
      if (this.d.scenarios.getActiveScenarioId() !== leg.proposalId) this.d.scenarios.setActiveScenario(leg.proposalId);
      let guard = 500;
      while (this.d.history.getUndoStackCount() > leg.undoCountAtStart && this.d.history.canUndo() && guard-- > 0) this.d.history.undo();
      const left = changedSince(leg.startSnapshot, this.snapshot(leg.proposalId)).length;
      note = left === 0 ? `Cancelled: your changes to “${leg.proposalName}” were undone.` : `Cancelled: ${left} change${left === 1 ? '' : 's'} could not be undone automatically and stay in “${leg.proposalName}” (Undo in Design). The existing city was not changed.`;
    }
    await this.returnAndRetest({ retest: false, cancelled: note });
  }

  /** "Keep editing" after a question. */
  dismissAsk() { this.set({ ask: null }); }

  /** Ends the whole round trip (the bar and the tests list go). */
  end() {
    this.runToken++;
    this.set({ trip: null, changes: null, ask: null });
    this.syncBaseGuard();
  }

  /** Clears the message under the study (the tests stay). */
  dismissStatus() { this.patchTrip({ status: null }); }
}
