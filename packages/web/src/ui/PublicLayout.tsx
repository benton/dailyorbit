import { Link, Outlet, useLocation } from 'react-router';

function NavLink({ to, label }: { to: string; label: string }) {
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

export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white px-6 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <nav className="flex items-center gap-4">
          <Link className="text-base font-bold text-neutral-900 dark:text-neutral-100" to="/">
            Daily Orbit
          </Link>
          <span className="text-neutral-300 dark:text-neutral-600">|</span>
          <NavLink label="Home" to="/" />
          <NavLink label="Search" to="/search" />
          <div className="ml-auto">
            <NavLink label="Admin" to="/admin" />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-6">
        <Outlet />
      </main>
    </div>
  );
}
