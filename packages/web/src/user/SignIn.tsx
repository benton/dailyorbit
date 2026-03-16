import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import AuthClient from './AuthClient.tsx';
import { useAuth } from './AuthContext.tsx';

export default function SignIn() {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { refetch } = useAuth();

  const from: string = (location.state as { from?: string } | null)?.from ?? '/';

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    await AuthClient.signIn.email(
      { email, password },
      {
        onError: (ctx) => {
          setError(ctx.error.message ?? 'Sign in failed');
          setLoading(false);
        },
        onSuccess: () => {
          refetch();
          void navigate(from, { replace: true });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">Sign In</h2>
      {error != null && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
      <form className="flex flex-col gap-3" onSubmit={signIn}>
        <input
          autoComplete="email"
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
          disabled={loading}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          type="email"
          value={email}
        />
        <input
          autoComplete="current-password"
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
          disabled={loading}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          type="password"
          value={password}
        />
        <button
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          disabled={loading}
          type="submit"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
