# Plan: SecretValue Audit

## Context

A Playwright network capture revealed a plaintext password in a POST body (Better Auth sign-in). This is a browser-level capture, not an application log leak — but it surfaced a need to audit whether the app's `SecretValue` wrapper is consistently used everywhere secrets enter and flow through the codebase.

The `SecretValue` class **already exists** in `packages/server/src/lib/encryption.ts`. It:
- Wraps a private string field behind `#value`
- Overrides `toString()`, `toJSON()`, and Node.js `inspect` to return `[ENCRYPTED]`
- Exposes `.unwrap()` as the only way to get the plaintext

The audit goal: find every place a secret enters the system as a raw string and either (a) confirm it's immediately wrapped in `SecretValue`, or (b) fix it.

---

## What's Already Good

- Encrypted config values return `SecretValue` from `config.get()` (`config-service.ts`)
- User passwords are wrapped with `new SecretValue(body.password)` immediately in route handlers (`user/routes.ts:121`)
- `hashPassword()` receives the unwrapped value only at the last moment (`user-service.ts`)
- Request logger never logs bodies — only method/path/status/duration (`request-logger.ts`)
- Config admin API masks encrypted values as `'********'` (`config/routes.ts`)

---

## Findings to Address

### 1. Minor: `[ENCRYPTED]` vs `[REDACTED]`

The display string is `[ENCRYPTED]`, not `[REDACTED]`. Change this in `SecretValue` so log output is consistent with the spec.

**File:** `packages/server/src/lib/encryption.ts` — 3 occurrences in `toString()`, `toJSON()`, `inspect`.

### 2. SMTP password in config schema

`email-service.ts` passes `config.smtpPass` to nodemailer. Need to verify whether `smtpPass` in `config-schema.ts` is marked `encrypted: true`.

**Files to check:**
- `packages/server/src/email/email-service.ts`
- `packages/server/src/lib/config-schema.ts`

### 3. ICFS credentials — defensive `typeof` check

`pipeline/registry.ts` lines 219-222:
```ts
const username = typeof rawUser === 'string' ? rawUser : rawUser.unwrap();
```
This silently accepts a plain string if the config key is not encrypted. This is not a bug, but worth documenting as a known pattern.

### 4. No pino `redact` configuration

`packages/server/src/lib/logger.ts` — pino supports a `redact` option that masks specific log fields. Currently not configured. This is a defense-in-depth layer that would catch any future accidental raw-string logging.

### 5. ICFS failure screenshot

`packages/server/src/icfs/headless-login.ts` — saves a screenshot to `/tmp/icfs-login-failure.png` on login failure. If the password field is visible in the screenshot, this is a leak risk.

---

## Implementation Steps

### Step 1: Change `[ENCRYPTED]` → `[REDACTED]`

Edit `packages/server/src/lib/encryption.ts`:
- `toString()` → `return '[REDACTED]';`
- `toJSON()` → `return '[REDACTED]';`
- `[Symbol.for('nodejs.util.inspect.custom')]()` → `return '[REDACTED]';`

Update `packages/server/src/lib/encryption.test.ts` to assert `[REDACTED]`.

### Step 2: Audit `smtpPass` in config schema

Read both files. If `smtpPass` is a config key without `encrypted: true`, add it.

### Step 3: Add pino `redact` paths

Edit `packages/server/src/lib/logger.ts`:
```ts
return pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['password', 'body.password', '*.password', 'token', 'secret', 'authorization'],
    censor: '[REDACTED]',
  },
  ...
});
```

### Step 4: Fix ICFS failure screenshot

Read `packages/server/src/icfs/headless-login.ts` around line 243.
- If the screenshot may capture a password field, clear input values before screenshotting:
  ```ts
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('input[type="password"]')) {
      (el as HTMLInputElement).value = '';
    }
  });
  ```
- Or remove the screenshot entirely if it provides little debugging value.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/server/src/lib/encryption.ts` | `[ENCRYPTED]` → `[REDACTED]` in all 3 methods |
| `packages/server/src/lib/encryption.test.ts` | Update assertions |
| `packages/server/src/lib/logger.ts` | Add pino `redact` config |
| `packages/server/src/lib/config-schema.ts` | Ensure `smtpPass` is `encrypted: true` (if present) |
| `packages/server/src/icfs/headless-login.ts` | Clear password inputs before failure screenshot |

---

## Verification

1. `pnpm test --filter=server -- encryption` — confirms `[REDACTED]` output
2. Manual: log a `SecretValue` instance via pino and confirm it shows `[REDACTED]`
3. TypeScript: `pnpm tsc --noEmit` passes with no errors
4. Config admin UI still shows `'********'` for encrypted values (unaffected — that's hardcoded in routes.ts)
