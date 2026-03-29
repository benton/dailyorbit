---
paths:
  - "**/*.duckdb"
  - "**/daily-orbit*.key"
  - "packages/server/**/*.ts"
---

# Data Storage Rules

- Use the domain-driven design Repository pattern for all data access
- The application uses an encryption key to store secret data. The default application key file is `data/daily-orbit.key`
- All application data except for the application key file and binary file data should be stored in the DuckDB database, including secrets and other configuration data. Secret DB fields must be encrypted with the application key file. The default database path is `data/daily-orbit.duckdb`.
- Binary file data must be stored either on the local filesystem or in S3. API server access to these assets must be abstracted through
- Use compiled SQL queries with `?`-style parameters for all repository-level queries.
