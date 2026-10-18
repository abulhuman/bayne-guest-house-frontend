import type { Tutorial } from '@/lib/tutorials';
import Panel from '@/components/Panel';

export default function WhatsNew({ tutorials, onOpen }: { tutorials: Tutorial[]; onOpen: (tutorial: Tutorial) => void }) {
  if (!tutorials.length) return null;
  return <Panel className="mb-6 border border-line p-5"><p className="text-sm font-semibold uppercase tracking-[0.12em] text-accent">What&apos;s new</p><h2 className="mt-1 text-xl font-bold">New guides</h2><div className="mt-3 flex flex-wrap gap-2">{tutorials.map((tutorial) => <button type="button" key={tutorial.name} onClick={() => onOpen(tutorial)} className="rounded-full bg-accent-tint px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-tint">{tutorial.title}</button>)}</div></Panel>;
}
