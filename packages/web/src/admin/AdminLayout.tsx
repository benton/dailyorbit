import { Maximize2, Minimize2 } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { useSettings } from '../lib/settings-context.tsx';
import UserMenu from '../ui/UserMenu.tsx';
import AdminSidebar from './AdminSidebar.tsx';

export default function AdminLayout() {
  const { settings, updateSetting } = useSettings();
  const isWide: boolean = settings?.wideView ?? false;

  return (
    <div className="flex h-screen bg-surface">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header
          className="flex items-center gap-4 px-6 py-3"
          style={{
            backgroundColor: 'var(--do-bg-card)',
            borderBottom: 'var(--do-border-style)',
          }}
        >
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
          <span className="text-sm text-on-surface-muted">Admin</span>
          <div className="ml-auto flex items-center gap-3">
            <button
              className="rounded-theme p-1.5 text-on-surface-muted hover:bg-on-surface/10 hover:text-on-surface"
              onClick={() => updateSetting('wideView', !isWide)}
              title={isWide ? 'Narrow view' : 'Wide view'}
              type="button"
            >
              {isWide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <UserMenu />
          </div>
        </header>
        <main className={`flex-1 overflow-y-auto p-6 ${isWide ? '' : 'mx-auto w-full max-w-5xl'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
