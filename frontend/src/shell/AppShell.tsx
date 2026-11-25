import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Viewport3D } from '../components/Viewport3D';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { JunctionPanel } from '../components/JunctionPanel';
import { InfoPanel } from '../components/InfoPanel';
import { SimulationPanel } from '../components/SimulationPanel';
import { SimulationHud } from '../components/SimulationHud';
import { MapCompass } from '../components/MapCompass';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ShortcutsOverlay } from '../components/ui/ShortcutsOverlay';
import { CoachMarks } from '../components/ui/CoachMarks';
import { Drawer, type DrawerTab } from '../components/ui/Drawer';
import { IconButton } from '../components/ui/IconButton';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useAppMode, useSelectedId } from '../hooks/useAppMode';
import { engineInstance } from '../engine/TwinCityEngine';
import { TopBar } from './TopBar';
import { WorkspaceRail } from './WorkspaceRail';
import { CommandPalette } from './CommandPalette';
import { dualOverlay, useShellStore, viewportFor } from './useShellStore';
import { WORKSPACES, workspaceById, workspaceForMode, type WorkspaceId } from './workspaces';
import { ExploreContext } from './contexts/ExploreContext';
import { DesignContext } from './contexts/DesignContext';
import { UndergroundContext } from './contexts/UndergroundContext';
import { UNDERGROUND_DRAWER_TABS } from './contexts/UndergroundContext.tabs';
import { EnvironmentContext } from './contexts/EnvironmentContext';
import { SimulateContext } from './contexts/SimulateContext';
import { SIMULATE_DRAWER_TABS } from './contexts/SimulateDrawer';
import { ProjectsContext } from './contexts/ProjectsContext';
import { ReportsContext } from './contexts/ReportsContext';
import { DataCatalogueOverlay } from '../components/data/DataCatalogueView';
import { ErrorNotice } from '../components/ui/ErrorNotice';
import { isFriendlyErrorText, type ErrorContext } from '../lib/errorCatalogue';
import { ERROR_TOAST_EVENT, type ErrorToastDetail } from '../lib/errorToast';

// 'notice': a failed request, shown neutrally with its reference (components/ui/ErrorNotice.tsx, lib/errorCatalogue.ts)
type Toast = { message: string; type: 'success' | 'error' | 'info' | 'notice'; error?: unknown; context?: ErrorContext; retry?: () => void };

const CONTEXTS: Record<WorkspaceId, React.FC> = {
  explore: ExploreContext,
  design: DesignContext,
  underground: UndergroundContext,
  environment: EnvironmentContext,
  simulate: SimulateContext,
  projects: ProjectsContext,
  reports: ReportsContext,
};

/** Bottom-drawer tabs per workspace. Only real content; a workspace without tabs shows no drawer at all. */
const DRAWER_TABS: Partial<Record<WorkspaceId, DrawerTab[]>> = {
  underground: UNDERGROUND_DRAWER_TABS,
  simulate: SIMULATE_DRAWER_TABS,
};

/** Workspaces whose context panel hosts a full existing side panel and needs the wider column. */
const WIDE_CONTEXT: WorkspaceId[] = ['projects'];

/**
 * UrbanOS application shell (docs/urbanos/UX_ARCHITECTURE.md §2): top bar, 7-workspace rail, context panel, map
 * (never unmounts), right inspector, bottom drawer. Existing panels are mounted unchanged.
 */
export const AppShell: React.FC<{ trust?: React.ReactNode }> = ({ trust }) => {
  const mode = useAppMode();
  const selectedId = useSelectedId();
  const workspace = useShellStore(s => s.workspace);
  const contextOpen = useShellStore(s => s.contextOpen);
  const inspectorOpen = useShellStore(s => s.inspectorOpen);
  const drawerOpen = useShellStore(s => s.drawerOpen);
  const drawerTab = useShellStore(s => s.drawerTab);
  const viewport = useShellStore(s => s.viewport);
  const width = useShellStore(s => s.width);
  const { setContextOpen, setInspectorOpen, setDrawerOpen, setDrawerTab, setViewport, syncWorkspace, revealSelection } = useShellStore.getState();

  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Global toast helper, as before (components call window.showToast)
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const show = (t: Toast) => {
      setToast(t);
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => setToast(null), t.type === 'notice' ? 10000 : 5000);  // time to copy the reference
    };
    // a request failure that reached a string-only toast call is still shown the neutral way, with its reference
    (window as any).showToast = (message: string, type: Toast['type'] = 'info') =>
      show({ message, type: type === 'error' && isFriendlyErrorText(message) ? 'notice' : type });
    const onErrorToast = (e: Event) => {
      const d = (e as CustomEvent<ErrorToastDetail>).detail;
      show({ message: '', type: 'notice', error: d.error, context: d.context, retry: d.retry });
    };
    window.addEventListener(ERROR_TOAST_EVENT, onErrorToast);
    return () => { if (timeoutId) clearTimeout(timeoutId); delete (window as any).showToast; window.removeEventListener(ERROR_TOAST_EVENT, onErrorToast); };
  }, []);

  // Viewport class (phone / tablet / laptop / desktop)
  useEffect(() => {
    const on = () => setViewport(viewportFor(window.innerWidth), window.innerWidth);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [setViewport]);

  // Engine-initiated mode changes (Simulate's close, Esc in Simulate, "Edit in Build") move the shell along
  useEffect(() => {
    const next = workspaceForMode(mode, useShellStore.getState().workspace);
    if (next) syncWorkspace(next);
    if (mode === 'simulate') setInspectorOpen(true);
  }, [mode, syncWorkspace, setInspectorOpen]);

  // A new selection opens the inspector (on one-overlay sizes Explore/Environment keep their panel, which shows it)
  useEffect(() => { if (selectedId) revealSelection(); }, [selectedId, revealSelection]);

  const openHelp = useCallback(() => setIsHelpOpen(true), []);
  useKeyboardShortcuts({ onRequestDelete: setPendingDeleteId, onToggleHelp: () => setIsHelpOpen(o => !o) });

  // Ctrl/⌘K palette; Alt+1…7 workspaces
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        const st = useShellStore.getState();
        st.setPaletteOpen(!st.paletteOpen);
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-7]$/.test(e.code)) {
        if (document.querySelector('[aria-modal="true"]')) return;
        const w = WORKSPACES[Number(e.code.slice(5)) - 1];
        if (w) { e.preventDefault(); useShellStore.getState().setWorkspace(w.id); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const cancelDelete = useCallback(() => setPendingDeleteId(null), []);
  const confirmDelete = useCallback(() => {
    if (pendingDeleteId && engineInstance.deleteObjectWithHistory(pendingDeleteId)) {
      (window as any).showToast?.('Deleted. Ctrl+Z to undo.', 'info');
    }
    setPendingDeleteId(null);
  }, [pendingDeleteId]);
  const pendingDeleteObj = pendingDeleteId ? engineInstance.objects.getById(pendingDeleteId) : undefined;

  // Inspector content: same precedence as the old right-hand panel (simulate > junction editor > properties > info)
  const isDebugSelection = !!selectedId && selectedId.startsWith('debug_');
  // A selected saved study area is not a city object: the properties panel would be an empty "Back" box over the
  // map. Its summary and actions are in the Study area panel instead.
  const isAreaSelection = !!selectedId && !engineInstance.objects?.getById(selectedId)
    && !!engineInstance.editing?.getSavedAreas().some(a => a.id === selectedId);
  const inspectorContent =
    mode === 'simulate' ? <SimulationPanel />
    : mode === 'build' && selectedId?.startsWith('ljunction:') ? <JunctionPanel />
    : mode === 'build' || isDebugSelection ? (selectedId && !isAreaSelection ? <PropertiesPanel key={selectedId} /> : null)
    : <InfoPanel onClose={() => setInspectorOpen(false)} />;
  const showInspector = !!inspectorContent && inspectorOpen;
  const dual = dualOverlay(viewport, width, workspace);
  const showContext = contextOpen && !(!dual && showInspector);

  const ws = workspaceById(workspace);
  const Context = CONTEXTS[workspace];
  const drawerTabs = DRAWER_TABS[workspace];
  const activeDrawerTab = drawerTabs?.find(t => t.id === drawerTab)?.id ?? drawerTabs?.[0]?.id;

  return (
    <div
      className="uos-shell"
      data-viewport={viewport}
      data-workspace={workspace}
      data-mode={mode}
      data-context={showContext ? 'open' : 'closed'}
      data-inspector={showInspector ? 'open' : 'closed'}
      data-dual={dual && (viewport === 'tablet') ? 'true' : undefined}
      data-context-wide={WIDE_CONTEXT.includes(workspace) ? 'true' : undefined}
    >
      <TopBar onHelp={openHelp} trust={trust} />
      <WorkspaceRail />

      {showContext && (
        <section className="uos-context" aria-label={`${ws.label} panel`} data-testid="context-panel">
          <header className="uos-context-header">
            <h2 className="text-heading font-semibold text-text-1 break-words leading-tight min-w-0">{ws.title}</h2>
            <IconButton icon={X} label="Collapse panel" onClick={() => setContextOpen(false)} size="sm" tooltip="left" />
          </header>
          <div className={`uos-context-body ${WIDE_CONTEXT.includes(workspace) ? 'is-flush' : ''}`}>
            <Context />
          </div>
        </section>
      )}

      <main className="uos-stage" aria-label="Map">
        <div className="uos-map"><Viewport3D /></div>
        {mode === 'simulate' && <SimulationHud />}
        <DataCatalogueOverlay />
        <div className="uos-compass"><MapCompass /></div>
        {!showContext && (
          <button type="button" className="uos-reopen" onClick={() => setContextOpen(true)} aria-label={`Show ${ws.label} panel`} data-testid="reopen-context">
            <ws.icon size={16} aria-hidden /> {ws.label}
          </button>
        )}
        {toast && (
          <div className="uos-toast" role="status" aria-live="polite" data-type={toast.type}>
            {toast.type === 'notice'
              ? <ErrorNotice bare error={toast.error} message={toast.message} context={toast.context}
                  onRetry={toast.retry ? () => { const r = toast.retry!; setToast(null); r(); } : undefined} />
              : <span>{toast.message}</span>}
            <button onClick={() => setToast(null)} aria-label="Dismiss notification" className="uos-toast-close"><X size={16} /></button>
          </div>
        )}
        {drawerTabs && activeDrawerTab && (
          <Drawer label={`${ws.label} drawer`} tabs={drawerTabs} active={activeDrawerTab} onTab={setDrawerTab} open={drawerOpen} onToggle={() => setDrawerOpen(!drawerOpen)} />
        )}
      </main>

      {showInspector && (
        <div className="uos-inspector" role="region" aria-label="Inspector" data-testid="inspector">
          {inspectorContent}
        </div>
      )}

      <CommandPalette onHelp={openHelp} />
      <ConfirmDialog
        isOpen={!!pendingDeleteObj}
        title="Delete"
        message={`Delete "${pendingDeleteObj?.name || pendingDeleteObj?.type || 'this object'}"? You can undo this with Ctrl+Z.`}
        confirmText="Delete"
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
      <ShortcutsOverlay isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      <CoachMarks />
    </div>
  );
};
