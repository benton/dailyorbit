import { LogIn, LogOut, Settings, HelpCircle, Monitor, User } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import AuthClient from '../user/AuthClient.tsx';
import { useAuth } from '../user/AuthContext.tsx';

type MenuItem = {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
};

export default function UserMenu() {
  const { user, isLoading } = useAuth();
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

  if (isLoading) return null;

  if (user == null) {
    return (
      <button
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
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

  const items: MenuItem[] = [
    {
      icon: <User className="h-4 w-4" />,
      label: 'Profile',
      onClick: () => void navigate('/profile'),
    },
    {
      icon: <Settings className="h-4 w-4" />,
      label: 'Settings',
      disabled: true,
      onClick: () => {},
    },
    {
      icon: <HelpCircle className="h-4 w-4" />,
      label: 'Help',
      disabled: true,
      onClick: () => {},
    },
    {
      icon: <Monitor className="h-4 w-4" />,
      label: 'Demo',
      disabled: true,
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
        className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="max-w-[120px] truncate">{user.name}</span>
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-48 rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
          <div className="border-b border-neutral-100 px-4 py-2 dark:border-neutral-700">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {user.name}
            </p>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{user.email}</p>
          </div>
          {items.map((item) => (
            <button
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-700"
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
