---
paths:
  - "**/*.test.ts"
---

# Testing Rules

- Use `pnpm test` to run tests. Use `npm-run-all2` to parallelize local test runs.
- Use [`npm-run-all2`](https://github.com/bcomnes/npm-run-all2) to parallelize local test runs.
- Use DuckDB with in-memory driver for unit tests.
- Use DuckDB with regular app configuration for integration and end-to-end tests.
- Create unit tests for simple functions and classes.
- Create integration tests for code that interacts with external APIs
- ALWAYS separate pure-logic unit tests from IO-touching integration tests.
- Prefer integration tests over heavy mocking.
- Unit-test complex algorithms thoroughly.
- When testing data structures, test the entire structure in one assertion if possible
- Maintain a single end-to-end test. This test should cover the happy path of the main functionality of the application, ensuring that all components work together as expected.
