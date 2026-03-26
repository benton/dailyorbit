import SignIn from './SignIn.tsx';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="w-full max-w-sm space-y-6 rounded-theme border border-border-theme bg-white p-8 shadow-sm dark:border-border-theme dark:bg-on-surface">
        <div className="text-center">
          <h1 className="text-xl font-bold text-on-surface">The Daily Orbit</h1>
          <p className="mt-1 text-sm text-on-surface-muted">Sign in to continue</p>
        </div>
        <SignIn />
      </div>
    </div>
  );
}
