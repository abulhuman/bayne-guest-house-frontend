import { ReactNode, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';
import { buttonClass } from '@/components/Button';
import { CHANGE_PASSWORD_PATH, PAGES, pagesFor } from '@/lib/permissions';

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const isActive = (path: string) =>
    router.pathname === path || router.pathname.startsWith(path + '/');

  const visibleItems = user ? pagesFor(user.role) : [];
  const helpItem = visibleItems.find(item => item.path === '/help');
  const pageLabel = PAGES.find(page => isActive(page.path))?.label;

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    sidebarRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const button = menuButtonRef.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      if (button?.isConnected) button.focus();
    };
  }, [menuOpen]);

  return (
    <div className="flex h-screen">
      <Head>
        <title>{pageLabel ? `${pageLabel} · Almis Hotel` : 'Almis Hotel'}</title>
      </Head>

      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-ink/50 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}

      <aside
        ref={sidebarRef}
        id="sidebar"
        className={`${menuOpen ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-40 w-64 flex-col bg-rail text-rail-text md:static md:flex`}
      >
        <div className="border-b border-rail-text/15 p-4 text-xl font-bold text-rail-text-on">Almis Hotel</div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {visibleItems.filter(item => item.path !== '/help').map(item => (
            <Link
              key={item.path}
              href={item.path}
              onClick={() => setMenuOpen(false)}
              className={`flex min-h-11 items-center rounded-input px-3 font-medium transition-colors ${isActive(item.path) ? 'bg-accent text-rail-text-on' : 'hover:bg-rail-text/10 hover:text-rail-text-on'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {user && (
          <div className="border-t border-rail-text/15 p-2 md:hidden">
            <Link href={CHANGE_PASSWORD_PATH} className="flex min-h-11 items-center rounded-input px-3 hover:bg-rail-text/10 hover:text-rail-text-on">
              Change password
            </Link>
            <button onClick={logout} className="flex min-h-11 w-full items-center rounded-input px-3 text-left hover:bg-rail-text/10 hover:text-rail-text-on">
              Logout
            </button>
          </div>
        )}
        {helpItem && (
          <div className="border-t border-rail-text/15 p-2">
            <Link
              href={helpItem.path}
              onClick={() => setMenuOpen(false)}
              className={`flex min-h-11 items-center rounded-input px-3 font-medium transition-colors ${isActive(helpItem.path) ? 'bg-accent text-rail-text-on' : 'hover:bg-rail-text/10 hover:text-rail-text-on'}`}
            >
              {helpItem.label}
            </Link>
          </div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 md:px-6">
          <button
            ref={menuButtonRef}
            onClick={() => setMenuOpen(true)}
            className={`${buttonClass('quiet', 'sm')} md:hidden`}
            aria-label="Open menu"
            aria-controls="sidebar"
            aria-expanded={menuOpen}
          >
            Menu
          </button>
          <div className="min-w-0 flex-1 truncate text-lg font-bold">
            Welcome{user?.name ? `, ${user.name}` : ''}
          </div>
          {user ? (
            <>
              <Link href={CHANGE_PASSWORD_PATH} className={`${buttonClass('quiet', 'sm')} max-md:hidden`}>
                Change password
              </Link>
              <button onClick={logout} className={`${buttonClass('quiet', 'sm')} max-md:hidden`}>
                Logout
              </button>
            </>
          ) : (
            <Link href="/login" className={buttonClass('quiet', 'sm')}>
              Login
            </Link>
          )}
        </header>

        <div className="overflow-auto p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
