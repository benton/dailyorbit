import { Maximize2, Minimize2 } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { useSettings } from '../lib/settings-context.tsx';

export default function AdminLayout() {
  const { settings, updateSetting } = useSettings();
  const isWide: boolean = settings?.wideView ?? false;

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border-theme bg-surface-card px-6 py-3">
        <nav className="flex items-center gap-4">
          <Link className="text-sm font-semibold text-on-surface" to="/admin">
            Admin
          </Link>
          <span className="text-on-surface-muted dark:text-on-surface-muted">/</span>
          <Link
            className="text-sm text-on-surface-muted hover:text-on-surface dark:text-on-surface-muted dark:hover:text-on-surface"
            to="/admin"
          >
            Dashboard
          </Link>
          <span className="text-on-surface-muted dark:text-on-surface-muted">/</span>
          <Link
            className="text-sm text-on-surface-muted hover:text-on-surface dark:text-on-surface-muted dark:hover:text-on-surface"
            to="/admin/settings"
          >
            Settings
          </Link>
          <span className="text-on-surface-muted dark:text-on-surface-muted">/</span>
          <Link
            className="text-sm text-on-surface-muted hover:text-on-surface dark:text-on-surface-muted dark:hover:text-on-surface"
            to="/admin/companies"
          >
            Companies
          </Link>
          <span className="text-on-surface-muted dark:text-on-surface-muted">/</span>
          <Link
            className="text-sm text-on-surface-muted hover:text-on-surface dark:text-on-surface-muted dark:hover:text-on-surface"
            to="/admin/users"
          >
            Users
          </Link>
          <span className="text-on-surface-muted dark:text-on-surface-muted">/</span>
          <Link
            className="text-sm text-on-surface-muted hover:text-on-surface dark:text-on-surface-muted dark:hover:text-on-surface"
            to="/admin/costs"
          >
            Costs
          </Link>
          <span className="text-on-surface-muted dark:text-on-surface-muted">/</span>
          <Link
            className="text-sm text-on-surface-muted hover:text-on-surface dark:text-on-surface-muted dark:hover:text-on-surface"
            to="/admin/pipeline"
          >
            Pipeline
          </Link>
          <span className="text-on-surface-muted dark:text-on-surface-muted">/</span>
          <Link
            className="text-sm text-on-surface-muted hover:text-on-surface dark:text-on-surface-muted dark:hover:text-on-surface"
            to="/admin/pipeline/history"
          >
            History
          </Link>
          <span className="text-on-surface-muted dark:text-on-surface-muted">/</span>
          <Link
            className="text-sm text-on-surface-muted hover:text-on-surface dark:text-on-surface-muted dark:hover:text-on-surface"
            to="/admin/hidden-items"
          >
            Hidden Items
          </Link>
          <span className="text-on-surface-muted dark:text-on-surface-muted">/</span>
          <Link
            className="text-sm text-on-surface-muted hover:text-on-surface dark:text-on-surface-muted dark:hover:text-on-surface"
            to="/admin/backups"
          >
            Backups
          </Link>
          <span className="text-on-surface-muted dark:text-on-surface-muted">/</span>
          <Link
            className="text-sm text-on-surface-muted hover:text-on-surface dark:text-on-surface-muted dark:hover:text-on-surface"
            to="/admin/newspaper"
          >
            Newspaper
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <button
              className="rounded-theme p-1.5 text-on-surface-muted hover:bg-on-surface/10 hover:text-on-surface"
              onClick={() => updateSetting('wideView', !isWide)}
              title={isWide ? 'Narrow view' : 'Wide view'}
              type="button"
            >
              {isWide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <Link
              className="text-sm text-on-surface-muted hover:text-on-surface dark:text-on-surface-muted dark:hover:text-on-surface"
              to="/"
            >
              Back to app
            </Link>
          </div>
        </nav>
      </header>
      <main className={`mx-auto p-6 ${isWide ? '' : 'max-w-5xl'}`}>
        <Outlet />
      </main>
    </div>
  );
}
