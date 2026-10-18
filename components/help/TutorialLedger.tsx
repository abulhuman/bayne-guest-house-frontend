import { Play } from '@phosphor-icons/react';
import type { Tutorial, TutorialGroup } from '@/lib/tutorials';
import Panel from '@/components/Panel';
import { IconButton } from '@/components/Button';

function Row({ tutorial, onOpen }: { tutorial: Tutorial; onOpen: (tutorial: Tutorial) => void }) {
  return <li className="flex items-center gap-3 border-t border-line-soft px-4 py-3 first:border-t-0 md:px-5">
    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(tutorial)}>
      <span className="block truncate font-semibold">{tutorial.title}</span><span className="mt-1 block text-sm text-muted">{tutorial.summary}</span>
    </button>
    <span className="hidden shrink-0 font-mono text-xs text-muted sm:inline">{Math.round(tutorial.durationSec)}s</span>
    <IconButton icon={Play} aria-label={`Play ${tutorial.title}`} onClick={() => onOpen(tutorial)} variant="quiet" />
  </li>;
}

export default function TutorialLedger({ groups, onOpen }: { groups: TutorialGroup[]; onOpen: (tutorial: Tutorial) => void }) {
  return <div className="space-y-4">{groups.map((group) => <Panel key={group.name} className="overflow-hidden"><div className="border-b border-line-soft px-4 py-4 md:px-5"><h2 className="text-lg font-bold capitalize">{group.name}</h2><p className="mt-1 text-sm text-muted">{group.tutorials.length} guide{group.tutorials.length === 1 ? '' : 's'}</p></div><ul>{group.tutorials.map((tutorial) => <Row key={tutorial.name} tutorial={tutorial} onOpen={onOpen} />)}</ul></Panel>)}</div>;
}
