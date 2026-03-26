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
      <nav className="mb-6 flex gap-1 border-b border-border-theme">
        {tabs.map((tab) => {
          const isActive: boolean =
            tab.path === '/admin/settings'
              ? pathname === '/admin/settings'
              : pathname.startsWith(tab.path);
          return (
            <Link
              className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-on-surface font-medium text-on-surface'
                  : 'border-transparent text-on-surface-muted hover:border-border-theme hover:text-on-surface '
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
