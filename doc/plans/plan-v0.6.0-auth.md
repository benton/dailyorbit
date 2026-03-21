# v0.6.0 Implementation Plan: User Authentication & Authorization

## Context

The app currently has no access control — all routes (including admin) are publicly accessible. better-auth is already partially wired in (DuckDB adapter, config keys, skeleton sign-in form) but auth tables aren't created, the admin plugin isn't enabled, and no routes are protected. This plan completes the authentication story: login, role-based authorization, CLI user management, and frontend auth flows.

---

## Key Design Decisions

### Auth tables in DuckDB
The custom DuckDB adapter does NOT auto-create tables. A new `ensureAuthTables()` function (same `CREATE TABLE IF NOT EXISTS` pattern as `ensureCompanyTables` in `companies/schema.ts`) will be called from `initializeDatabase()` in `db-init.ts`.

### Password hashing
better-auth handles password hashing internally with proper salting. The `betterAuthSecret` config key (already auto-generated, encrypted at rest) provides the signing secret. We do NOT derive password salt from the encryption key — better-auth's built-in approach is sound. We DO use `SecretValue` to wrap passwords in transit (CLI args, service method params) so they don't leak to logs.

### Auth middleware
Hono middleware: `requireAuth()` validates session via `getAuth().api.getSession()`, attaches user to context. `requireAdmin()` checks `role === 'admin'`. Compose as needed per route group.

### CLI user commands
Operate through a `UserService` that wraps the DuckDB adapter directly (no HTTP server needed). Uses better-auth's password hashing utilities for secure storage.

### First-user auto-admin
`daily-orbit user create` checks user count. If zero → auto-promote to admin + print warning. Web sign-up path also checks count.

### OIDC compatibility
better-auth's existing endpoints (`/api/auth/sign-in/email`, `/api/auth/sign-up/email`, `/api/auth/get-session`) already follow OAuth-style conventions. When we add OIDC federation later, it plugs into better-auth's plugin system without changing these routes.

---

## Steps

### Step 1: Auth Table Schema

Create `packages/server/src/user/schema.ts` — `ensureAuthTables(conn)`:
- `user` table: id, name, email (UNIQUE), emailVerified, image, createdAt, updatedAt, role (DEFAULT 'user'), banned (DEFAULT false), banReason, banExpires
- `session` table: id, userId, token (UNIQUE), expiresAt, ipAddress, userAgent, createdAt, updatedAt, impersonatedBy
- `account` table: id, userId, accountId, providerId, accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, idToken, password, createdAt, updatedAt
- `verification` table: id, identifier, value, expiresAt, createdAt, updatedAt

Modify `packages/server/src/lib/db-init.ts` — call `ensureAuthTables(conn)`.

Test `packages/server/src/user/schema.test.ts` — tables exist after call; idempotent.

### Step 2: Admin Plugin Integration

Modify `packages/server/src/lib/auth.ts`:
- Import `admin` from `better-auth/plugins/admin`
- Add `plugins: [admin()]` to `betterAuth()` config
- This auto-exposes `/api/auth/admin/*` endpoints (setRole, createUser, listUsers, banUser, etc.)

Modify `packages/server/src/user/SessionUser.ts`:
- Add `role` to the `SessionUser` type

### Step 3: Auth Middleware

Create `packages/server/src/lib/auth-middleware.ts`:
- `requireAuth()` — validates session cookie/bearer, sets `c.set('user', sessionUser)`. Returns 401 on failure.
- `requireAdmin()` — checks `c.get('user').role === 'admin'`. Returns 403 on failure.
- Type augmentation for Hono's `ContextVariableMap`.

Modify `packages/server/src/app.ts`:
- Apply `requireAuth()` to `/api/*` except `/api/health` and `/api/auth/**`
- Apply `requireAdmin()` to `/api/admin/*`

Test `packages/server/src/lib/auth-middleware.test.ts` — 401 no session, pass-through valid session, 403 non-admin, pass-through admin.

### Step 4: UserService

Create `packages/server/src/user/user-service.ts`:
- `createUser(email, name, password: SecretValue, role?)` — first user auto-admin with warning
- `listUsers()`
- `getUser(userId)`
- `disableUser(userId, reason?)` — sets banned=true
- `enableUser(userId)`
- `deleteUser(userId)`
- `resetPassword(userId, newPassword: SecretValue)`
- `setRole(userId, role)`
- `getUserCount()` — for first-user detection

Test `packages/server/src/user/user-service.test.ts` — integration tests with in-memory DuckDB.

### Step 5: User API Routes

Create `packages/server/src/user/routes.ts`:
- Admin routes at `/api/admin/users`: GET / (list), POST / (create), GET /:id, PUT /:id/disable, PUT /:id/enable, DELETE /:id, POST /:id/reset-password, PUT /:id/role
- Public route: `GET /api/me` — returns current session user

Modify `packages/server/src/app.ts` — mount routes.

### Step 6: CLI User Commands

Create `packages/server/src/cli/user/index.ts`:
- `daily-orbit user create` — args: --email, --name, --password, --admin
- `daily-orbit user disable` — args: --email or --id, --reason
- `daily-orbit user delete` — args: --email or --id, --confirm
- `daily-orbit user reset-password` — args: --email or --id, --password

Modify `packages/server/src/cli/index.ts` — add `user: userCommand`.
Modify `Makefile` — add `user-create`, `user-disable`, `user-delete`, `user-reset-password` targets.

### Step 7: Frontend Auth Context

Create `packages/web/src/user/AuthContext.tsx`:
- `AuthProvider` wrapping `useSession()` from better-auth/react
- Exposes: `user`, `isAuthenticated`, `isAdmin`, `isLoading` via `useAuth()` hook

Create `packages/web/src/user/RequireAuth.tsx` — redirects to `/login` if unauthenticated.
Create `packages/web/src/user/RequireAdmin.tsx` — redirects to `/` if not admin.

Modify `packages/web/src/user/AuthClient.tsx` — add `adminClient()` plugin.

### Step 8: Login Page

Modify `packages/web/src/user/SignIn.tsx` — add error handling, loading states, redirect-after-login.
Create `packages/web/src/user/LoginPage.tsx` — full-page layout with branding.

### Step 9: User Menu in Header

Create `packages/web/src/ui/UserMenu.tsx`:
- Dropdown with: Logout, Settings (disabled), Help (disabled), Demo (disabled)
- Uses lucide icons, `useAuth()` hook
- Logout calls `AuthClient.signOut()`

Modify `packages/web/src/ui/PublicLayout.tsx`:
- Add `UserMenu` to upper-right of header
- Conditionally show "Admin" link only when `isAdmin`

### Step 10: Frontend Route Protection

Modify `packages/web/src/App.tsx`:
- Add `/login` route
- Wrap `PublicLayout` routes with `<RequireAuth>`
- Wrap `AdminLayout` routes with `<RequireAuth>` + `<RequireAdmin>`

### Step 11: Admin User Management UI

Create `packages/web/src/admin/Users.tsx`:
- DataTable of users (email, name, role, status, created)
- Row actions: disable/enable, delete (confirm dialog), reset password (dialog), change role
- "Create User" button + dialog
- Uses `/api/admin/users` endpoints

Modify `packages/web/src/App.tsx` — add admin `/users` route.
Modify `packages/web/src/admin/AdminLayout.tsx` — add "Users" nav link.

---

## Dependency Graph

```
Step 1 (schema) → Step 2 (admin plugin) → Step 3 (middleware) → Step 5 (API routes)
                                                 ↓                       ↓
                                          Step 4 (service) ———→ Step 6 (CLI)
                                                 ↓
                                    Step 7 (auth context) → Step 8 (login page)
                                           ↓                       ↓
                                    Step 9 (user menu) → Step 10 (route protection)
                                                                   ↓
                                                         Step 11 (admin UI)
```

Backend steps 1–6 and frontend steps 7–11 can proceed in parallel after Step 3.

## Verification

1. `make test` — all existing + new tests pass
2. `make dev` — start API + frontend servers
3. `make user-create ARGS="--email admin@test.com --name Admin --password secret123"` — first user auto-promoted to admin
4. `make user-create ARGS="--email user@test.com --name User --password secret123"` — regular user
5. Browser: navigate to `/` → redirected to `/login`
6. Sign in as admin → see Admin link, access `/admin/users`
7. Sign in as regular user → no Admin link, `/admin` returns 403
8. User menu dropdown: Logout works, Settings/Help/Demo disabled
9. Admin UI: create, disable, delete users; reset passwords
