import SignIn from './SignIn.tsx';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="text-center">
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
            The Daily Orbit
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Sign in to continue</p>
        </div>
        <SignIn />
      </div>
    </div>
  );
}
