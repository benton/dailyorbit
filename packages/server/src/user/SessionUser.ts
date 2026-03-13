import type { auth } from "../lib/auth.ts";

type User = typeof auth.$Infer.Session.user;

export type SessionUser = Pick<User, "email" | "id" | "name">;
