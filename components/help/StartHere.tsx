import type { Role } from '@/lib/permissions';
import { tourFor, type Tutorial } from '@/lib/tutorials';
import Panel from '@/components/Panel';
import Button from '@/components/Button';

export default function StartHere({ role, tutorials, onOpen }: { role: Role; tutorials: Tutorial[]; onOpen: (tutorial: Tutorial) => void }) {
  const tour = tourFor(tutorials, role);
  const tasks = tutorials.filter((tutorial) => tutorial.primaryRole === role && tutorial !== tour).slice(0, 3);
  return (
    <Panel className="mb-6 border border-accent/20 p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-semibold uppercase tracking-[0.12em] text-accent">Start here</p><h2 className="mt-1 text-2xl font-bold">Your first steps</h2></div>
        {tour && <Button variant="primary" size="sm" onClick={() => onOpen(tour)}>Play tour</Button>}
      </div>
      <p className="mt-2 max-w-2xl text-muted">A quick tour and the next tasks for your role.</p>
      {tasks.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-3">{tasks.map((task, index) => <div key={task.name} className="rounded-input bg-accent-tint p-3 text-sm"><span className="font-mono text-accent">0{index + 1}</span><div className="mt-1 font-semibold">{task.title}</div></div>)}</div>}
    </Panel>
  );
}
