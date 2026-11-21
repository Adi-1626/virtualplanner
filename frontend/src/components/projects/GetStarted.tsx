import React from 'react';
import { CheckCircle2, Circle, FolderPlus } from 'lucide-react';
import { Button } from '../ui/kit';
import { startSteps, type StartStep } from '../../lib/planningProjects';

/** The first-use path in plain words (shown until the planner has a project of their own, and on a project until its first check). */
export const StepList: React.FC<{ steps: StartStep[]; onStep?: (id: StartStep['id']) => void }> = ({ steps, onStep }) => {
  const next = steps.find(s => !s.done)?.id;
  return (
    <ol className="space-y-1" data-testid="start-steps">
      {steps.map((s, k) => (
        <li key={s.id} data-step={s.id} data-done={s.done ? 'yes' : 'no'} className={`flex items-start gap-2 text-sm ${s.done ? 'text-slate-400' : s.id === next ? 'text-white' : 'text-slate-300'}`}>
          {s.done ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-300" aria-label="done" /> : <Circle size={15} className="mt-0.5 shrink-0 text-slate-500" aria-label="to do" />}
          <span className="flex-1">{k + 1}. {s.label}</span>
          {s.id === next && onStep && s.id !== 'name' && (
            <button type="button" className="uos-link text-xs whitespace-nowrap" onClick={() => onStep(s.id)} data-testid={`start-go-${s.id}`}>Go</button>
          )}
        </li>
      ))}
    </ol>
  );
};

export const GetStarted: React.FC<{ user: string; onCreate: () => void; others?: number; onHide?: () => void }> = ({ user, onCreate, others = 0, onHide }) => (
  <section className="rounded-xl border border-cyan-400/30 bg-cyan-500/[0.06] px-3 py-2.5 space-y-2" data-testid="get-started">
    <div className="flex items-center gap-2">
      <div className="flex-1 text-sm font-semibold text-white">Get started</div>
      {onHide && <button type="button" className="uos-link text-xs" onClick={onHide} data-testid="start-hide">Hide</button>}
    </div>
    <p className="text-xs text-slate-300">A project collects one planning activity: the alternative you drew, its elements, the conflict check against other
      agencies’ projects and the city data, and the decisions made. Nothing here approves anything.</p>
    {others > 0 && <p className="text-xs text-slate-400" data-testid="start-others">{others === 1 ? 'The project listed below was' : `The ${others.toLocaleString('en-IN')} projects listed below were`} created
      {user.trim() ? ' under other names' : ''}; you can open {others === 1 ? 'it' : 'them'}, but your own work goes in a project of your own.</p>}
    <StepList steps={startSteps({ user, project: null })} />
    <Button size="sm" variant="primary" icon={FolderPlus} onClick={onCreate} disabled={!user.trim()} data-testid="start-create">Create your first project</Button>
    {!user.trim() && <p className="text-xs text-amber-300">Enter your name above first.</p>}
  </section>
);
