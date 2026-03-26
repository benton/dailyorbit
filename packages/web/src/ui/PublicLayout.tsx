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
      className={`text-sm ${isActive ? 'font-semibold' : ''}`}
      style={{ color: isActive ? 'var(--do-text-heading)' : 'var(--do-text-muted)' }}
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
    const interval: ReturnType<typeof setInterval> = setInterval(() => void fetchCount(), 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Link
      className={`relative text-sm hover:text-on-surface ${isActive ? 'font-semibold text-on-surface' : 'text-on-surface-muted'}`}
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
    <div className="min-h-screen" style={{ backgroundColor: 'var(--do-bg)' }}>
      <header
        className="px-6 py-3"
        style={{
          backgroundColor: 'var(--do-bg-card)',
          borderBottom: 'var(--do-border-style)',
        }}
      >
        <nav className="flex items-center gap-4">
          <Link
            className="text-base font-bold"
            style={{
              color: 'var(--do-text-heading)',
              fontFamily: 'var(--do-font-heading)',
            }}
            to="/"
          >
            The Daily Orbit
          </Link>
          <span style={{ color: 'var(--do-border)' }}>|</span>
          <NavLink label="Home" to="/" />
          <NavLink label="Search" to="/search" />
          <NavLink label="News" to="/news" />
          {isAuthenticated && <NavLink label="Chat" to="/chat" />}
          {isAuthenticated && <AlertBadge />}
          <div className="ml-auto flex items-center gap-3">
            <button
              className="rounded-theme p-1.5 text-on-surface-muted hover:bg-on-surface/10 hover:text-on-surface"
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
