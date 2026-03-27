# Plan: OpenDAL Storage Abstraction + file-type MIME Detection

## Context

The attachment pipeline's validation stage shells out to the `file` command on local filesystem paths. In production, this breaks when files aren't present on local disk (e.g., after instance replacement where only the DB was restored). The root cause is that the entire attachment storage layer is hardcoded to `node:fs` operations — there's no abstraction over local vs S3 storage.

This plan replaces the local-only storage with Apache OpenDAL (supporting local FS in dev, S3 in production) and replaces the `file` shell command with the `file-type` npm package for MIME detection from magic bytes.

**Why OpenDAL?** Prebuilt ARM64 Linux binaries, same NAPI pattern as `@duckdb/node-api` already in the project. No Dockerfile or CI changes needed. Supports `fs`, `s3`, and `memory` (for tests) backends with a unified API.

---

## Phase 1: Dependencies + StorageBackend Type

### 1.1 Install packages

```
pnpm add --filter @daily-orbit/server opendal file-type
```

### 1.2 Create `packages/server/src/attachments/storage-backend.ts`

Define a `StorageBackend` type wrapping OpenDAL `Operator`:

```typescript
export type StorageBackend = {
  write(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  stat(key: string): Promise<{ contentLength: number } | null>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
  rename(src: string, dest: string): Promise<void>;
};
```

Three factory functions:
- `createFsBackend(rootPath: string)` — wraps `Operator('fs', { root })`
- `createS3Backend(bucket, region, root?)` — wraps `Operator('s3', { bucket, region, root })`
- `createMemoryBackend()` — wraps `Operator('memory')` for tests

`rename` is copy+delete on S3 (OpenDAL doesn't support atomic rename on all backends).

### 1.3 Add config keys to `packages/server/src/lib/config-schema.ts`

| Key | Default | Description |
|-----|---------|-------------|
| `storageBackend` | `'fs'` | `'fs'` or `'s3'` |
| `storageBucket` | `''` | S3 bucket name |
| `storagePrefix` | `'attachments/'` | S3 key prefix |
| `storageRegion` | `'us-east-2'` | AWS region for S3 |
| `storageFsRoot` | `'data/attachments'` | Local root for `fs` backend |

### 1.4 Create `packages/server/src/attachments/create-storage.ts`

Single factory that reads config and returns the appropriate backend:

```typescript
export function createStorageFromConfig(config: ConfigService): StorageBackend
```

Standalone CLI commands (no ConfigService) fall back to `createFsBackend(resolvedPath)`.

---

## Phase 2: Replace `file` Command with `file-type`

### 2.1 Rewrite `packages/server/src/attachments/validate-content-type.ts`

Change signature from `(filePath: string, declaredType)` to `(data: Buffer, declaredType)`:

```typescript
import { fileTypeFromBuffer } from 'file-type';

export async function detectContentType(
  data: Buffer,
  declaredType: string | null,
): Promise<DetectedContentType> {
  const result = await fileTypeFromBuffer(data);
  const mimeType = result?.mime ?? declaredType ?? 'application/octet-stream';
  return { mimeType, isDifferent: declaredType != null && mimeType !== declaredType, declaredType };
}
```

### 2.2 Update `validate-content-type.test.ts`

Tests pass `Buffer` instances with known magic bytes (PDF header `%PDF`, ZIP `PK\x03\x04`, etc). No temp files needed.

### 2.3 Remove `file` from Dockerfile line 40

The entire `RUN apt-get update && apt-get install -y --no-install-recommends file && ...` line can be deleted. (`pdftotext`/`poppler-utils` is not installed here — it's assumed available on the instance.)

---

## Phase 3: Refactor storage.ts

### 3.1 Update `packages/server/src/attachments/storage.ts`

- Rename `attachmentStoragePath()` → `attachmentStorageKey()`, remove `basePath` param. Returns relative key: `{subsystem}/{fileNumber}/{attachmentKey}.{ext}`
- `downloadFile()` changes to return `{ buffer, fileSizeBytes, contentType }` instead of writing to disk. The caller writes to storage.
- Remove `findExistingAttachment()`, `fileExists()`, `getFileSize()` — replaced by `StorageBackend.stat()` and `StorageBackend.list()`

### 3.2 Update `storage.test.ts`

Update `attachmentStorageKey` tests (no `basePath`). Move existence/find tests to `storage-backend.test.ts` using `createMemoryBackend()`.

---

## Phase 4: DB Schema Migration

### 4.1 Update `packages/server/src/attachments/repository.ts`

Add to `MIGRATE_COLUMNS_SQL`:
```sql
ALTER TABLE attachment RENAME COLUMN local_path TO storage_key
```

Add a data migration to strip the base path prefix from existing values:
```sql
UPDATE attachment SET storage_key = regexp_replace(storage_key, '^(.*?/)?data/attachments/', '')
  WHERE storage_key IS NOT NULL AND storage_key LIKE '%data/attachments/%'
```

This handles both absolute (`/data/attachments/SAT/...`) and relative (`data/attachments/SAT/...`) paths.

### 4.2 Update all SQL queries

- `markDownloaded()`: param `localPath` → `storageKey`, column `local_path` → `storage_key`
- `getPendingValidations()`: select `storage_key`, return as `storageKey`
- `getPendingExtractions()`: select `storage_key`, return as `storageKey`
- `getPendingDownloads()`: select `storage_key`

### 4.3 Update types

- `PendingValidationRow`: `localPath` → `storageKey`
- `PendingExtractionRow`: `localPath` → `storageKey`
- `AttachmentRow` in `types.ts`: `localPath` → `storageKey`

---

## Phase 5: Update Pipeline Consumers

### 5.1 `packages/server/src/attachments/pipeline.ts`

- `AttachmentPipelineOptions`: replace `storageBasePath: string` with `storage: StorageBackend`
- **Stage 4 (Download)**: `downloadFile()` returns buffer → `storage.write(key, buffer)`. `findExistingAttachment()` → `storage.stat(key)`. `rename(tmp, final)` → `storage.rename(tmpKey, finalKey)`.
- **Stage 4.5 (Validate)**: `storage.read(row.storageKey)` → `detectContentType(buffer, declaredType)`
- **Stage 5 (Extract)**: `storage.read(row.storageKey)` replaces `readFileSync(row.localPath)`. For `pdftotext` fallback: write buffer to `os.tmpdir()`, run pdftotext, clean up in `finally`.

### 5.2 `packages/server/src/attachments/validate-pipeline.ts`

Add `storage: StorageBackend` to options. Read bytes via `storage.read(row.storageKey)`.

### 5.3 `packages/server/src/attachments/extract-pipeline.ts`

Add `storage: StorageBackend` to options. Replace `readFileSync`/`statSync` with `storage.read()`/`storage.stat()`.

### 5.4 `packages/server/src/attachments/extract-text.ts`

`extractTextFromPdf(bytes, filePath?)` — keep signature. For `pdftotext` fallback when on S3 storage, the **caller** (pipeline) writes bytes to a temp file and passes the temp path. No change to `extract-text.ts` itself.

---

## Phase 6: Update CLI + Pipeline Registry

### 6.1 `packages/server/src/pipeline/registry.ts`

Replace hardcoded `storageBasePath: 'data/attachments'` with:
```typescript
const { createStorageFromConfig } = await import('../attachments/create-storage.ts');
const { getConfigService } = await import('../lib/config.ts');
const storage = createStorageFromConfig(getConfigService());
```

Same for the `attachments.extract`, `attachments.validate`, and `attachments.summarize` stages.

### 6.2 CLI commands (`packages/server/src/cli/attachments/`)

- `download.ts`, `sync.ts`, `discover.ts`: construct `StorageBackend` from `--storage-path` arg (fs backend) or config, pass `storage` instead of `storageBasePath`
- `validate.ts`, `extract.ts`: pass `StorageBackend` through
- `reset.ts`: use `storage.list()` + `storage.delete()` instead of `rm -rf`

### 6.3 `packages/server/src/cli/shared/args.ts`

Keep `--storage-path` for CLI use (overrides `storageFsRoot` config for local dev). Default remains `data/attachments`.

---

## Phase 7: Tests

### 7.1 New: `storage-backend.test.ts`

Unit tests with `createMemoryBackend()`: write/read round-trip, stat, list, delete, rename.

### 7.2 Update existing tests

| Test file | Change |
|-----------|--------|
| `pipeline.test.ts` | `storageBasePath` → `storage: createMemoryBackend()` |
| `validate-pipeline.test.ts` | Add `storage`, pass buffers |
| `validate-content-type.test.ts` | Pass `Buffer` directly, remove temp files |
| `storage.test.ts` | Update `attachmentStorageKey` tests, remove `basePath` |

---

## Verification

1. `make test` — all unit and integration tests pass
2. CLI smoke test: `./daily-orbit attachments download --scope SAT --limit 5` with local fs backend
3. Deploy to production with `storageBackend=s3`, `storageBucket=daily-orbit-storage`, `storagePrefix=attachments/`
4. Run pipeline: `./daily-orbit pipeline run --stage attachments.discover-download` — verify files are written to S3, validation reads from S3, no `file` command errors
5. Verify extraction still works: `./daily-orbit attachments extract --limit 10`

---

## Files Modified (summary)

| File | Action |
|------|--------|
| `packages/server/package.json` | Add `opendal`, `file-type` |
| `packages/server/src/attachments/storage-backend.ts` | **NEW** — StorageBackend type + factories |
| `packages/server/src/attachments/create-storage.ts` | **NEW** — config-driven factory |
| `packages/server/src/attachments/storage-backend.test.ts` | **NEW** — memory backend tests |
| `packages/server/src/lib/config-schema.ts` | Add 5 storage config keys |
| `packages/server/src/attachments/validate-content-type.ts` | Rewrite: Buffer input, `file-type` |
| `packages/server/src/attachments/validate-content-type.test.ts` | Buffer-based tests |
| `packages/server/src/attachments/storage.ts` | Refactor: key builder, download returns buffer |
| `packages/server/src/attachments/storage.test.ts` | Update for new signatures |
| `packages/server/src/attachments/types.ts` | `storageBasePath` → `storage`, `localPath` → `storageKey` |
| `packages/server/src/attachments/repository.ts` | Column rename migration, SQL updates |
| `packages/server/src/attachments/pipeline.ts` | Use StorageBackend throughout |
| `packages/server/src/attachments/pipeline.test.ts` | Use memory backend |
| `packages/server/src/attachments/validate-pipeline.ts` | Add storage option, read bytes |
| `packages/server/src/attachments/extract-pipeline.ts` | Add storage option, read bytes |
| `packages/server/src/pipeline/registry.ts` | Config-driven storage |
| `packages/server/src/cli/attachments/*.ts` | Construct StorageBackend from args/config |
| `Dockerfile` | Remove `file` apt package (line 40) |
