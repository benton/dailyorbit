import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import AuthClient from './AuthClient.tsx';

type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  refetch: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  isLoading: true,
  refetch: () => {},
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
            id: u.id as string,
            email: u.email as string,
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
    fetchSession();
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: user != null,
    isAdmin: user?.role === 'admin',
    isLoading,
    refetch: fetchSession,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
