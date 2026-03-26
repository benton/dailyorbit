import { Navigate } from 'react-router';
import { useAuth } from './AuthContext.tsx';

export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return <p className="p-6 text-sm text-on-surface-muted">Loading...</p>;
  }

  if (!isAdmin) {
    return <Navigate replace to="/" />;
  }

  return <>{children}</>;
}
