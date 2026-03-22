import { Link, Outlet, useLocation } from 'react-router';

const tabs: Array<{ label: string; path: string }> = [
  { label: 'Settings', path: '/admin/settings' },
  { label: 'AI', path: '/admin/settings/ai' },
  { label: 'News', path: '/admin/settings/news' },
  { label: 'Consultants', path: '/admin/settings/consultants' },
];

export default function SettingsLayout() {
  const { pathname } = useLocation();

  return (
    <div>
      <nav className="mb-6 flex gap-1 border-b border-neutral-200 dark:border-neutral-700">
        {tabs.map((tab) => {
          const isActive: boolean =
            tab.path === '/admin/settings'
              ? pathname === '/admin/settings'
              : pathname.startsWith(tab.path);
          return (
            <Link
              className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-neutral-900 font-medium text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
                  : 'border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-500 dark:hover:text-neutral-200'
              }`}
              key={tab.path}
              to={tab.path}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
