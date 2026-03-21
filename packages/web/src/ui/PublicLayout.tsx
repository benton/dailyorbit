import { Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useSettings } from '../lib/settings-context.tsx';
import { useAuth } from '../user/AuthContext.tsx';
import UserMenu from './UserMenu.tsx';

function NavLink({ label, to }: { label: string; to: string }) {
  const location = useLocation();
  const isActive: boolean =
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <Link
      className={`text-sm hover:text-neutral-900 dark:hover:text-neutral-100 ${isActive ? 'font-semibold text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
      to={to}
    >
      {label}
    </Link>
  );
}

function AlertBadge() {
  const [count, setCount] = useState<number>(0);
  const location = useLocation();
  const isActive: boolean = location.pathname.startsWith('/alerts');

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res: Response = await fetch('/api/user/alerts/unread-count');
        if (res.ok) {
          const data = (await res.json()) as { count: number };
          setCount(data.count);
        }
      } catch {
        /* silent */
      }
    };
    void fetchCount();
    const interval: ReturnType<typeof setInterval> = setInterval(
      () => void fetchCount(),
      60_000,
    );
    return () => clearInterval(interval);
  }, []);

  return (
    <Link
      className={`relative text-sm hover:text-neutral-900 dark:hover:text-neutral-100 ${isActive ? 'font-semibold text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
      to="/alerts"
    >
      Alerts
      {count > 0 && (
        <span className="absolute -top-1 -right-3 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

export default function PublicLayout() {
  const { isAdmin, isAuthenticated } = useAuth();
  const { settings, updateSetting } = useSettings();
  const [localWide, setLocalWide] = useState<boolean>(false);
  const isWide: boolean = isAuthenticated ? (settings?.wideView ?? false) : localWide;

  const toggleWide = () => {
    if (isAuthenticated) {
      updateSetting('wideView', !isWide);
    } else {
      setLocalWide(!localWide);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white px-6 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <nav className="flex items-center gap-4">
          <Link className="text-base font-bold text-neutral-900 dark:text-neutral-100" to="/">
            The Daily Orbit
          </Link>
          <span className="text-neutral-300 dark:text-neutral-600">|</span>
          <NavLink label="Home" to="/" />
          <NavLink label="Search" to="/search" />
          <NavLink label="News" to="/news" />
          <NavLink label="Ask" to="/query" />
          {isAuthenticated && <NavLink label="Chat" to="/chat" />}
          {isAuthenticated && <AlertBadge />}
          <div className="ml-auto flex items-center gap-3">
            <button
              className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              onClick={toggleWide}
              title={isWide ? 'Narrow view' : 'Wide view'}
              type="button"
            >
              {isWide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            {isAdmin && <NavLink label="Admin" to="/admin" />}
            <UserMenu />
          </div>
        </nav>
      </header>
      <main className={`mx-auto p-6 ${isWide ? '' : 'max-w-6xl'}`}>
        <Outlet />
      </main>
    </div>
  );
}
