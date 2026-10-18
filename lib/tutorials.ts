import { PAGES, pagesFor, type Role } from './permissions';

export type Tutorial = {
  name: string;
  title: string;
  summary: string;
  group: string;
  primaryRole: string;
  audience: Role[];
  pages: string[];
  durationSec: number;
  video: string;
  poster: string;
  videoUrl: string;
  posterUrl: string;
  sha256: string;
  recordedAt: string;
  sourceCommit: string;
};

export type TutorialGroup = { name: string; tutorials: Tutorial[] };

export function resolveMediaUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const configured = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001';
  const base = new URL(configured, typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin);
  const apiPrefix = base.pathname.replace(/\/$/, '');
  const target = path.startsWith('/') && apiPrefix ? `${apiPrefix}${path}` : path;
  return new URL(target, `${base.origin}${apiPrefix || '/'}`).toString();
}

type TutorialsClient = { get: (path: string) => Promise<{ data: Tutorial[] }> };

export async function fetchTutorials(client: TutorialsClient): Promise<Tutorial[]> {
  const response = await client.get('/tutorials');
  return response.data.map((tutorial) => ({
    ...tutorial,
    videoUrl: resolveMediaUrl(tutorial.videoUrl),
    posterUrl: resolveMediaUrl(tutorial.posterUrl),
  }));
}

export async function tutorialForPlayback(client: TutorialsClient, tutorial: Tutorial, nowSec = Date.now() / 1000): Promise<Tutorial> {
  const expires = new URL(tutorial.videoUrl).searchParams.get('exp');
  if (expires && Number(expires) > nowSec + 60) return tutorial;
  const refreshed = (await fetchTutorials(client)).find((row) => row.name === tutorial.name);
  if (!refreshed) throw new Error('Guide is no longer available');
  return refreshed;
}

export function filterTutorials(tutorials: Tutorial[], query: string): Tutorial[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return tutorials;
  return tutorials.filter((tutorial) => `${tutorial.title} ${tutorial.summary}`.toLocaleLowerCase().includes(needle));
}

export function newTutorials(tutorials: Tutorial[], lastSeen: string | null): Tutorial[] {
  if (!lastSeen) return tutorials;
  const timestamp = Date.parse(lastSeen);
  if (!Number.isFinite(timestamp)) return tutorials;
  return tutorials.filter((tutorial) => Date.parse(tutorial.recordedAt) > timestamp);
}

export function groupTutorials(tutorials: Tutorial[], role: Role): TutorialGroup[] {
  const orderedPages = [...pagesFor(role), ...PAGES];
  const byGroup = new Map<string, Tutorial[]>();
  for (const tutorial of tutorials) {
    const name = tutorial.group === 'sign-in' || tutorial.name.endsWith('-tour')
      ? 'Sign in'
      : orderedPages.find((page) => tutorial.pages.includes(page.path))?.label ?? 'Getting started';
    const rows = byGroup.get(name) ?? [];
    rows.push(tutorial);
    byGroup.set(name, rows);
  }
  const labels = ['Sign in', ...orderedPages.map((page) => page.label), 'Getting started'];
  return [...byGroup].map(([name, rows]) => ({ name, tutorials: rows.sort((a, b) => a.title.localeCompare(b.title)) }))
    .sort((a, b) => labels.indexOf(a.name) - labels.indexOf(b.name));
}

export function tourFor(tutorials: Tutorial[], role: Role): Tutorial | undefined {
  return tutorials.find((tutorial) => tutorial.primaryRole === role && tutorial.name === `${role}-tour`);
}

