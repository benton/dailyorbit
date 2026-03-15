import { Link, Outlet } from 'react-router';

export default function AdminLayout() {
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
            to="/admin/graph"
          >
            Graph
          </Link>
          <span className="text-neutral-300 dark:text-neutral-600">/</span>
          <Link
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            to="/admin/volume"
          >
            Volume
          </Link>
          <div className="ml-auto">
            <Link
              className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              to="/"
            >
              Back to app
            </Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        <Outlet />
      </main>
    </div>
  );
}
