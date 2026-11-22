import { useEffect, useRef } from 'react';
import { engineInstance } from '../engine/TwinCityEngine';
import { toolByHotkey } from '../components/tools';
import { DRAW_HEIGHT_FINE_STEP_M, DRAW_HEIGHT_STEP_M } from '../engine/editing/drawConstraints';

interface ShortcutHandlers {
  /** Ask the UI to confirm deleting the object with this id. */
  onRequestDelete: (id: string) => void;
  onToggleHelp: () => void;
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

const READ_ONLY_MESSAGE = 'Roads cannot be changed while simulating. Open Design (Alt+2) to edit.';

/**
 * Simulation mode keys. Esc clears the study area, then leaves the mode; editing
 * shortcuts explain why they do nothing. Returns true when the key was handled.
 */
function handleSimulationKey(e: KeyboardEvent): boolean {
  const { simMode } = engineInstance;
  const ctrl = e.ctrlKey || e.metaKey;
  const lower = e.key.toLowerCase();

  if (e.key === 'Escape') {
    if (simMode.getState().seedRoadIds.length > 0) simMode.clearSeeds();
    else engineInstance.setAppMode('view');
    e.preventDefault();
    return true;
  }
  const tool = toolByHotkey(e.key);
  const isEdit =
    (ctrl && !e.altKey && (lower === 'z' || lower === 'y')) ||
    (!ctrl && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace' || lower === 'r' || e.key === 'Enter' || (!!tool && tool.mode !== 'select')));
  if (isEdit) {
    (window as any).showToast?.(READ_ONLY_MESSAGE, 'info');
    e.preventDefault();
    return true;
  }
  return false;
}

/**
 * All global keyboard shortcuts, registered in one place so cleanup is
 * centralised. Mounted once from App.
 *
 *   Esc            clear typed input, else cancel drawing / clear selection
 *   Enter          apply typed input, else finish the current line or polygon
 *
 * While drawing a line (road, flyover, metro, tunnel, utility) with at least one point:
 *   0-9 .          type the length of the current segment (Tab → bearing, Tab again → length)
 *   R              then a number: radius at the last point (Enter applies)
 *   Backspace      edit the typed number, else remove the last point
 *   Ctrl+Z         remove the last point (the global undo stack is untouched until finish)
 *   Shift / Alt+Shift (held)   snap direction to 15° / to 15° relative to the previous segment
 *   PageUp / PageDown  Road tool: raise / lower the next point 1 m (Shift: 0.5 m); Flyover / double-deck: the deck height
 *   Ctrl+Z         undo
 *   Ctrl+Y         redo (also Ctrl+Shift+Z)
 *   Delete         delete selected object (with confirmation)
 *   1-9            pick a tool
 *   R / Shift+R    rotate selected metro station 15° clockwise / anticlockwise
 *   ?              show shortcut list
 *
 * In Simulation mode Esc clears the study area (then leaves the mode) and the
 * editing shortcuts are disabled.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  // Keep latest handlers without re-registering the listener every render
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Modal dialogs own the keyboard while open (they handle Esc/Enter themselves)
      if (document.querySelector('[aria-modal="true"]')) return;
      if (isTypingTarget(e.target)) return;

      const { editing, history, selection } = engineInstance;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key;

      if (engineInstance.isSimulationModeActive() && handleSimulationKey(e)) return;

      // Elevation while drawing (road point height / flyover deck height); before the first point too
      if ((key === 'PageUp' || key === 'PageDown') && !ctrl && !e.altKey && editing.drawHeightKind()) {
        const step = e.shiftKey ? DRAW_HEIGHT_FINE_STEP_M : DRAW_HEIGHT_STEP_M;
        const r = editing.stepDrawHeight(key === 'PageUp' ? step : -step);
        if (r && editing.getDrawingPoints().length === 0) {
          (window as any).showToast?.(`${r.kind === 'road' ? 'Next point' : 'Deck'} ${r.heightM.toFixed(1)} m above ground`, 'info');
        }
        e.preventDefault();
        return;
      }

      // Line drawing in progress: typed length / bearing / radius and drawing-local undo come first
      const lineDrawing = editing.isAlignableDrawing() && editing.getDrawingPoints().length > 0;
      if (lineDrawing) {
        if (key === 'Escape' && editing.clearTypedInput()) { e.preventDefault(); return; }
        if (ctrl && !e.altKey && !e.shiftKey && key.toLowerCase() === 'z') {
          editing.removeLastDrawingPoint();
          e.preventDefault();
          return;
        }
        if (!ctrl && !e.altKey) {
          if (key === 'Enter') {
            if (!editing.commitTypedInput()) engineInstance.finishDrawing();
            e.preventDefault();
            return;
          }
          if (key === 'Backspace' || key === 'Delete') {
            if (!(key === 'Backspace' && editing.typeKey('Backspace'))) editing.removeLastDrawingPoint();
            e.preventDefault();
            return;
          }
          if (key === 'Tab' || key === 'r' || key === 'R' || /^[0-9.]$/.test(key) || (key === '-' && editing.getTypedInput().field === 'bearing')) {
            if (editing.typeKey(key)) { e.preventDefault(); return; }
          }
        }
      }

      if (key === 'Escape') {
        if (editing.getMode() !== 'select') {
          editing.cancelDrawing();
          engineInstance.clearSnapPreview();
        } else {
          selection.clearSelection();
        }
        e.preventDefault();
        return;
      }

      if (ctrl && !e.altKey) {
        const lower = key.toLowerCase();
        if (lower === 'z' && !e.shiftKey) {
          if (history.canUndo()) history.undo();
          e.preventDefault();
        } else if (lower === 'y' || (lower === 'z' && e.shiftKey)) {
          if (history.canRedo()) history.redo();
          e.preventDefault();
        }
        return;
      }

      if (e.altKey) return;

      if (key === 'Enter') {
        engineInstance.finishDrawing();
        e.preventDefault();
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        const id = selection.getSelection()[0];
        if (id && engineInstance.objects.getById(id)) {
          handlersRef.current.onRequestDelete(id);
          e.preventDefault();
        }
        return;
      }

      if (key === 'r' || key === 'R') {
        const id = selection.getSelection()[0];
        if (id && engineInstance.rotateStation(id, e.shiftKey ? -15 : 15)) {
          e.preventDefault();
        }
        return;
      }

      if (key === '?') {
        handlersRef.current.onToggleHelp();
        e.preventDefault();
        return;
      }

      const tool = toolByHotkey(key);
      if (tool) {
        if (tool.mode !== 'select' && !engineInstance.isPlanningModeActive()) {
          (window as any).showToast?.(`"${tool.label}" is a Design tool. Open Design (Alt+2) to use it.`, 'info');
          return;
        }
        editing.setMode(tool.mode);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
