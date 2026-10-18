import dynamic from 'next/dynamic';
import axios from '@/utils/axiosInstance';
import { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '@/components/Layout';
import RequireAuth from '@/components/RequireAuth';
import ListState from '@/components/ListState';
import Panel from '@/components/Panel';
import HelpHero from '@/components/help/HelpHero';
import StartHere from '@/components/help/StartHere';
import TutorialLedger from '@/components/help/TutorialLedger';
import WhatsNew from '@/components/help/WhatsNew';
import { fetchTutorials, filterTutorials, groupTutorials, newTutorials, tutorialForPlayback, type Tutorial } from '@/lib/tutorials';
import { useList } from '@/lib/useList';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/lib/permissions';

const PlayerModal = dynamic(() => import('@/components/help/PlayerModal'), { ssr: false });

function HelpInner() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Tutorial | null>(null);
  const [playError, setPlayError] = useState(false);
  const playbackRequest = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const tutorials = useList<Tutorial>('tutorials', () => fetchTutorials(axios), user?.role ?? '');
  const role = (user?.role ?? 'reception') as Role;

  useEffect(() => {
    const stored = window.localStorage.getItem('helpLastSeen');
    setLastSeen(stored);
    const onKey = (event: KeyboardEvent) => {
      const active = document.activeElement;
      const editing = active instanceof HTMLElement && (active.matches('input, textarea, select') || active.isContentEditable);
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !editing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (tutorials.state.kind !== 'ready' || !tutorials.rows.length) return;
    const newest = tutorials.rows.map((row) => row.recordedAt).sort().at(-1);
    if (newest) window.localStorage.setItem('helpLastSeen', newest);
  }, [tutorials.state.kind, tutorials.rows]);

  const filtered = useMemo(() => filterTutorials(tutorials.rows, query), [tutorials.rows, query]);
  const splitRoles = role === 'admin' || role === 'manager';
  const groups = useMemo(() => groupTutorials(filtered.filter((tutorial) => !splitRoles || tutorial.primaryRole === role || tutorial.group === 'sign-in'), role), [filtered, role, splitRoles]);
  const fresh = useMemo(() => newTutorials(tutorials.rows, lastSeen), [tutorials.rows, lastSeen]);
  const other = filtered.filter((tutorial) => tutorial.primaryRole !== role && tutorial.group !== 'sign-in');
  const openTutorial = async (tutorial: Tutorial) => {
    const request = ++playbackRequest.current;
    setPlayError(false);
    try {
      const ready = await tutorialForPlayback(axios, tutorial);
      if (request === playbackRequest.current) setSelected(ready);
    } catch {
      if (request === playbackRequest.current) setPlayError(true);
    }
  };

  if (!user) return null;
  return <Layout>
    <div className="mx-auto w-full max-w-6xl">
      <HelpHero name={user.name} role={role} />
      <StartHere role={role} tutorials={tutorials.rows} onOpen={openTutorial} />
      <WhatsNew tutorials={fresh} onOpen={openTutorial} />
      <Panel className="mb-6 p-4 md:p-5">
        <label htmlFor="help-search" className="text-sm font-semibold">Search guides</label>
        <div className="mt-2 flex items-center gap-3">
          <input ref={searchRef} id="help-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title or summary" className="min-h-11 min-w-0 flex-1 rounded-input border border-line bg-surface px-4 outline-none focus:border-accent" />
          <kbd className="hidden rounded-input border border-line px-2 py-1 font-mono text-xs text-muted sm:inline">/</kbd>
        </div>
      </Panel>
      {playError && <p role="alert" className="mb-4 text-danger">Couldn&apos;t open this guide. Please try again.</p>}
      <ListState list={tutorials} empty={query ? 'No guides match your search.' : 'No guides are available yet.'}>
        {tutorials.rows.length > 0 && filtered.length === 0 && <p className="p-6 text-muted">No guides match your search.</p>}
        <TutorialLedger groups={groups} onOpen={openTutorial} />
        {splitRoles && other.length > 0 && <details className="mt-6 rounded-panel border border-line bg-surface p-5"><summary className="cursor-pointer text-lg font-bold">Other roles</summary><div className="mt-4"><TutorialLedger groups={groupTutorials(other, role)} onOpen={openTutorial} /></div></details>}
      </ListState>
      <PlayerModal tutorial={selected} onClose={() => { playbackRequest.current += 1; setSelected(null); }} />
    </div>
  </Layout>;
}

export default function HelpPage() {
  return <RequireAuth><HelpInner /></RequireAuth>;
}
