import React, { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ValidationSummary } from './ValidationSummary';
import { AnchoredPopover } from '../AnchoredPopover';
import { useDemoMode } from '../../../hooks/useDemoMode';
import { trustPillState } from './demoStates';

/** Top-bar pill (UX_ARCHITECTURE §2): opens the recorded validation results; hidden in demo mode. */
export const ModelTrustPill: React.FC<{ className?: string; demo?: boolean }> = ({ className = '', demo }) => {
  const live = useDemoMode();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  if (trustPillState(demo ?? live) === 'hidden') return null;
  return (
    <>
      <button type="button" ref={setAnchor} data-testid="model-trust-pill" data-state="limitation" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(o => !o)} title="Known model limitation: use it to compare options on the same inputs. Click for the recorded results."
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 h-7 text-[12px] font-medium whitespace-nowrap cursor-pointer ${className}`}
        style={{ color: 'var(--warn, #E8833A)', borderColor: 'color-mix(in srgb, var(--warn, #E8833A) 55%, transparent)', background: 'color-mix(in srgb, var(--warn, #E8833A) 10%, transparent)' }}>
        <TriangleAlert size={13} aria-hidden="true" />
        Traffic model fails validation · details
      </button>
      <AnchoredPopover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="below" width={360} label="Traffic model validation summary" testId="model-trust-popover">
        <ValidationSummary />
      </AnchoredPopover>
    </>
  );
};
