export type Role = 'admin' | 'manager' | 'reception' | 'housekeeping' | 'barista' | 'security' | 'finance' | 'store';

const PAGE_ORDER: Record<Role, string[]> = {
  admin: ['/dashboard', '/bookings', '/laundry', '/attendance', '/payments', '/inventory', '/rooms', '/staff', '/guests'],
  manager: ['/dashboard', '/bookings', '/laundry', '/attendance', '/payments', '/inventory', '/rooms', '/staff', '/guests'],
  reception: ['/dashboard', '/bookings', '/laundry', '/attendance', '/payments', '/inventory', '/rooms', '/guests'],
  housekeeping: ['/laundry'], barista: ['/inventory'], security: ['/help'], finance: ['/dashboard', '/payments'], store: ['/inventory'],
};

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

export async function fetchTutorials(client: { get: (path: string) => Promise<{ data: { tutorials?: Tutorial[] } }> }): Promise<Tutorial[]> {
  const response = await client.get('/tutorials');
  return (response.data.tutorials ?? []).map((tutorial) => ({
    ...tutorial,
    videoUrl: resolveMediaUrl(tutorial.videoUrl),
    posterUrl: resolveMediaUrl(tutorial.posterUrl),
  }));
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
  const pageOrder = new Map(PAGE_ORDER[role].map((page, index) => [page, index]));
  const byGroup = new Map<string, Tutorial[]>();
  for (const tutorial of tutorials) byGroup.set(tutorial.group, [...(byGroup.get(tutorial.group) ?? []), tutorial]);
  return [...byGroup.entries()]
    .map(([name, rows]) => ({ name, tutorials: [...rows].sort((a, b) => a.title.localeCompare(b.title)) }))
    .sort((a, b) => {
      const firstPage = (group: TutorialGroup) => Math.min(...group.tutorials.flatMap((tutorial) => tutorial.pages.length ? tutorial.pages.map((page) => pageOrder.get(page) ?? 999) : [-1]));
      return firstPage(a) - firstPage(b) || a.name.localeCompare(b.name);
    });
}

