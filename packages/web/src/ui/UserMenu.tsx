import { LogIn, LogOut, Settings, HelpCircle, Monitor, User } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import AuthClient from '../user/AuthClient.tsx';
import { useAuth } from '../user/AuthContext.tsx';

type MenuItem = {
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
};

export default function UserMenu() {
  const { isLoading, user } = useAuth();
  const [open, setOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current != null && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (isLoading) {
    return null;
  }

  if (user == null) {
    return (
      <button
        className="flex items-center gap-1.5 rounded-theme px-2 py-1 text-sm text-on-surface-muted hover:bg-on-surface/10 hover:text-on-surface"
        onClick={() => void navigate('/login')}
        type="button"
      >
        <LogIn className="h-4 w-4" />
        Login
      </button>
    );
  }

  const handleLogout = () => {
    void AuthClient.signOut().then(() => {
      void navigate('/login');
    });
  };

  const items: Array<MenuItem> = [
    {
      icon: <User className="h-4 w-4" />,
      label: 'Profile',
      onClick: () => void navigate('/profile'),
    },
    {
      icon: <Settings className="h-4 w-4" />,
      label: 'Settings',
      onClick: () => void navigate('/settings'),
    },
    {
      disabled: true,
      icon: <HelpCircle className="h-4 w-4" />,
      label: 'Help',
      onClick: () => {},
    },
    {
      disabled: true,
      icon: <Monitor className="h-4 w-4" />,
      label: 'Demo',
      onClick: () => {},
    },
    {
      icon: <LogOut className="h-4 w-4" />,
      label: 'Logout',
      onClick: handleLogout,
    },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        className="flex items-center gap-2 rounded-theme px-2 py-1 text-sm text-on-surface-muted hover:bg-on-surface/10 hover:text-on-surface"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="max-w-[120px] truncate">{user.name}</span>
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-48 rounded-theme border border-border-theme bg-surface-card py-1 shadow-lg">
          <div className="border-b border-border-theme px-4 py-2">
            <p className="truncate text-sm font-medium text-on-surface">{user.name}</p>
            <p className="truncate text-xs text-on-surface-muted">{user.email}</p>
          </div>
          {items.map((item) => (
            <button
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-on-surface hover:bg-on-surface/10 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={item.disabled}
              key={item.label}
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
              type="button"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
