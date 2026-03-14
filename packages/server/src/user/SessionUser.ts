import type { betterAuth } from 'better-auth';

type AuthInstance = ReturnType<typeof betterAuth>;
type User = AuthInstance['$Infer']['Session']['user'];

export type SessionUser = Pick<User, 'email' | 'id' | 'name'>;
