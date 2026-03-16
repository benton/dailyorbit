import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import AuthClient from './AuthClient.tsx';

type AuthUser = {
  email: string;
  id: string;
  name: string;
  role: string;
};

type AuthContextValue = {
  isAdmin: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  refetch: () => void;
  user: AuthUser | null;
};

const AuthContext = createContext<AuthContextValue>({
  isAdmin: false,
  isAuthenticated: false,
  isLoading: true,
  refetch: () => {},
  user: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchSession = () => {
    setIsLoading(true);
    AuthClient.getSession()
      .then((result) => {
        if (result.data?.user != null) {
          const u = result.data.user as Record<string, unknown>;
          setUser({
            email: u.email as string,
            id: u.id as string,
            name: u.name as string,
            role: (u.role as string) ?? 'user',
          });
        } else {
          setUser(null);
        }
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect
    fetchSession();
  }, []);

  const value: AuthContextValue = {
    isAdmin: user?.role === 'admin',
    isAuthenticated: user != null,
    isLoading,
    refetch: fetchSession,
    user,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
