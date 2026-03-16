import { Maximize2, Minimize2 } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { useSettings } from '../lib/settings-context.tsx';

export default function AdminLayout() {
  const { settings, updateSetting } = useSettings();
  const isWide: boolean = settings?.wideView ?? false;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white px-6 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <nav className="flex items-center gap-4">
          <Link
            className="text-sm font-semibold text-neutral-900 dark:text-neutral-100"
            to="/admin"
          >
            Admin
          </Link>
          <span className="text-neutral-300 dark:text-neutral-600">/</span>
          <Link
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            to="/admin"
          >
            Dashboard
          </Link>
          <span className="text-neutral-300 dark:text-neutral-600">/</span>
          <Link
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            to="/admin/config"
          >
            Config
          </Link>
          <span className="text-neutral-300 dark:text-neutral-600">/</span>
          <Link
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            to="/admin/companies"
          >
            Companies
          </Link>
          <span className="text-neutral-300 dark:text-neutral-600">/</span>
          <Link
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            to="/admin/users"
          >
            Users
          </Link>
          <span className="text-neutral-300 dark:text-neutral-600">/</span>
          <Link
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            to="/admin/ai"
          >
            AI
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <button
              className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              onClick={() => updateSetting('wideView', !isWide)}
              title={isWide ? 'Narrow view' : 'Wide view'}
              type="button"
            >
              {isWide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <Link
              className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              to="/"
            >
              Back to app
            </Link>
          </div>
        </nav>
      </header>
      <main className={`mx-auto p-6 ${isWide ? 'max-w-[96rem]' : 'max-w-5xl'}`}>
        <Outlet />
      </main>
    </div>
  );
}
