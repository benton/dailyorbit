import { ChevronDown, ChevronRight, Cog, Wrench, BarChart3, ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';

type NavItem = {
  label: string;
  path: string;
};

type NavGroup = {
  icon: React.ReactNode;
  items: Array<NavItem>;
  label: string;
  prefix: string;
};

const navGroups: Array<NavGroup> = [
  {
    icon: <Cog className="h-4 w-4" />,
    items: [
      { label: 'General', path: '/admin/config' },
      { label: 'AI & Inference', path: '/admin/config/ai' },
      { label: 'News Sources', path: '/admin/config/news' },
      { label: 'Consultants', path: '/admin/config/consultants' },
    ],
    label: 'Configuration',
    prefix: '/admin/config',
  },
  {
    icon: <Wrench className="h-4 w-4" />,
    items: [
      { label: 'Pipeline', path: '/admin/maintain/pipeline' },
      { label: 'Users', path: '/admin/maintain/users' },
      { label: 'Companies', path: '/admin/maintain/companies' },
      { label: 'Hidden Items', path: '/admin/maintain/hidden-items' },
      { label: 'Backups', path: '/admin/maintain/backups' },
      { label: 'Newspaper', path: '/admin/maintain/newspaper' },
    ],
    label: 'Maintenance',
    prefix: '/admin/maintain',
  },
  {
    icon: <BarChart3 className="h-4 w-4" />,
    items: [
      { label: 'Dashboard', path: '/admin' },
      { label: 'Inference Costs', path: '/admin/info/costs' },
      { label: 'Logs', path: '/admin/info/logs' },
    ],
    label: 'Info',
    prefix: '/admin/info',
  },
];

function isActive(pathname: string, itemPath: string): boolean {
  if (itemPath === '/admin') {
    return pathname === '/admin';
  }
  return pathname === itemPath || pathname.startsWith(itemPath + '/');
}

function groupIsActive(pathname: string, group: NavGroup): boolean {
  return group.items.some((item: NavItem) => isActive(pathname, item.path));
}

export default function AdminSidebar() {
  const { pathname } = useLocation();

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of navGroups) {
      initial[group.prefix] = groupIsActive(pathname, group);
    }
    // Default: expand at least the first group if nothing is active
    if (!Object.values(initial).some(Boolean)) {
      initial[navGroups[0].prefix] = true;
    }
    return initial;
  });

  const toggle = (prefix: string): void => {
    setExpanded((prev: Record<string, boolean>) => ({
      ...prev,
      [prefix]: !prev[prefix],
    }));
  };

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border-theme bg-surface-card">
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {navGroups.map((group: NavGroup) => (
          <div className="mb-2" key={group.prefix}>
            <button
              className="flex w-full items-center gap-2 rounded-theme px-2 py-1.5 text-xs font-semibold tracking-wide text-on-surface-muted uppercase hover:bg-on-surface/5 hover:text-on-surface"
              onClick={() => toggle(group.prefix)}
              type="button"
            >
              {expanded[group.prefix] ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {group.icon}
              {group.label}
            </button>
            {expanded[group.prefix] && (
              <div className="mt-0.5 ml-3 space-y-0.5 border-l border-border-theme pl-3">
                {group.items.map((item: NavItem) => (
                  <Link
                    className={`block rounded-theme px-2 py-1.5 text-sm transition-colors ${
                      isActive(pathname, item.path)
                        ? 'bg-on-surface/10 font-medium text-on-surface'
                        : 'text-on-surface-muted hover:bg-on-surface/5 hover:text-on-surface'
                    }`}
                    key={item.path}
                    to={item.path}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-border-theme px-3 py-3">
        <Link
          className="flex items-center gap-2 rounded-theme px-2 py-1.5 text-sm text-on-surface-muted hover:bg-on-surface/5 hover:text-on-surface"
          to="/"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to app
        </Link>
      </div>
    </aside>
  );
}
