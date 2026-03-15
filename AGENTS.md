# Agent Code Guidelines

## Overview

1. First, always read the @README and the @doc/requirements.md
2. Next, read over the data model @doc/datamodel.md

---

## Implementation Best Practices

1. **THE GOLDEN RULE**: Always follow the existing conventions of the codebase!
   In this case, that means observing sound practices for TypeScript and React.
   When in doubt, first check the framework documentation at
   https://github.com/nkzw-tech/web-app-template
   when you need examples of good default design decisions

For specific TypeScript and React best practices (only as a reference), see:

- TypeScript: https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html
- React: https://www.tatvasoft.com/blog/reactjs-best-practices/

2. **THE SILVER RULE**:
   All high-level User UI actions - that is, at a minimum, anything that _corresponds to a User story_ or _modifies the state of the system_ - should be implemented as a Services layer method, with a corresponding API method. The general principle is that anything a User can do through the UI should be easily automatable by driving a simple, high-level API call. Think hard and ask any necessary questions when considering this rule and its implications.

3. **THE BRONZE RULE**:
   All application data except for binary files should be stored in the DuckDB database, including secrets and other configuration data. The default database path should be `data/daily-orbit.duckdb`. Binary files are stored at a URL that points either to a local directory or to an S3-compatible storage service endpoint.

---

### 0 — Purpose

These rules ensure maintainability, safety, and developer velocity.
**MUST** rules are enforced by CI; **SHOULD** rules are strongly recommended.

---

### 1 — Before Coding

- **BP-1 (MUST)** Ask the user clarifying questions if anything is ambiguous.
- **BP-2 (SHOULD)** Draft and confirm an approach for complex work.
- **BP-3 (SHOULD)** If ≥ 2 approaches exist, list clear pros and cons.

---

### 2 — While Coding

- **C-1 (MUST)** Follow TDD: scaffold stub -> write failing test -> implement.
- **C-2 (MUST)** Name functions with existing domain vocabulary for consistency.
- **C-3 (SHOULD NOT)** Introduce classes when small testable functions suffice.
- **C-4 (SHOULD)** Prefer simple, composable, testable functions.
- **C-5 (MUST)** Use type annotations for all function parameters, return types, and local variables.
- **C-6 (SHOULD)** Formatting: Use `oxlint` for linting and `oxfmt` for formatting

---

### 3 — Testing

- **T-0 (MUST)** Use `pnpm test` to run tests. Use `npm-run-all2` to parallelize local test runs.
- **T-1 (MUST)** Create unit tests for simple functions and classes.
- **T-2 (MUST)** Create integration tests for code that interacts with external APIs
- **T-3 (SHOULD)** Maintain a single end-to-end test.
  This test should cover the happy path of the main functionality of the application, ensuring that all components work together as expected.
- **T-4 (MUST)** ALWAYS separate pure-logic unit tests from IO-touching integration tests.
- **T-5 (SHOULD)** Prefer integration tests over heavy mocking.
- **T-6 (SHOULD)** Unit-test complex algorithms thoroughly.
- **T-7 (SHOULD)** When testing data structures, test the entire structure in one assertion if possible

---

### 4 — Database

- **D-1 (MUST)** Use the domain-driven design Repository pattern for all data access!
- **D-2 (SHOULD)** Use compiled SQL queries with `?`-style parameters for all repository-level queries.
- **D-3 (MUST)** Use DuckDB with in-memory driver for unit tests.
- **D-4 (SHOULD)** Use DuckDB with regular app configuration for integration and end-to-end tests.

---

### 5 — Code Organization

- **O-0 (MUST)** Any complex command that needs to be run repeatedly should be wrapped in a `make` target.
- **O-1 (MUST)** Place code in `src/[module name]` as per the standard ES modules layout.
- **O-2 (MUST)** Place deployment-related code in `deploy`
- **O-3 (MUST)** Place documentation in `doc`
- **O-4 (SHOULD)** Place short-term, development-only scripts in `scripts` - permanent application tooling should be integrated into the appliction's CLI. If a script needs to access app modules, if should be a CLI subcommand because transitive imports may fail.

---

### 6 — Tooling

- Use `./daily-orbit serve api` to run the API server - it should hot-reload changes
- Use `./daily-orbit serve html` to run the VITE fontend server - it should hot-reload changes
- Use `pnpm test` to run tests.
- `pnpm build` for production builds.
- Use [`npm-run-all2`](https://github.com/bcomnes/npm-run-all2) to parallelize local test runs.
- Use `oxlint` for linting and `oxfmt` for formatting.
- Use `swc` with `ts-node` for fast node scripts with [ESM](https://hacks.mozilla.org/2018/03/es-modules-a-cartoon-deep-dive/). See below ↓

#### 6.1 Run node scripts with ESM and TypeScript, fast.

Create a `script.ts` file in `scripts/`, run `chmod x scripts/script.ts` and execute it via `./scripts/script.ts`.

```
#!/usr/bin/env node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm

console.log('Your code goes here.');
```

Use this to restart your scripts instantly when a file changes:

```
#!/usr/bin/env NODE_ENV=development node --watch --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm

console.log('This processes instantly restarts when a file changes.');
```

---

### 7 - Git

- **GH-1 (MUST**) Use Conventional Commits format when writing commit messages: https://www.conventionalcommits.org/en/v1.0.0
- **GH-2 (MUST NOT**) Refer to Claude or Anthropic in commit messages.
