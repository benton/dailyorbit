# Chat with your Team — Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the backend for a multi-turn conversational chatbot with switchable consultant personas, sharing the existing RAG pipeline.

**Architecture:** New `chat` module (`packages/server/src/chat/`) with schema, repository, types, routes, and a `generate-chat.ts` streaming generator that wraps the existing query pipeline. Consultant CRUD lives in a separate `consultant` module. Both integrate into the existing Hono app, DB init, and CLI.

**Tech Stack:** DuckDB, Hono (SSE streaming), AWS Bedrock (converseStream), citty (CLI), vitest

**Design doc:** `doc/plans/2026-03-19-chat-consultants-design.md`

---

## Task 1: Consultant Schema & Types

**Files:**
- Create: `packages/server/src/consultant/schema.ts`
- Create: `packages/server/src/consultant/types.ts`
- Modify: `packages/server/src/lib/db-init.ts`

**Step 1: Create types file**

```typescript
// packages/server/src/consultant/types.ts

export type Consultant = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  systemPrompt: string;
  modelId: string | null;
  temperature: number | null;
  maxResponseTokens: number | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  enabled: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

**Step 2: Create schema file**

```typescript
// packages/server/src/consultant/schema.ts
import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureConsultantTables(conn: DuckDBConnection): Promise<void> {
  await conn.run(`CREATE SEQUENCE IF NOT EXISTS consultant_id_seq START 1`);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS consultant (
      id                  INTEGER PRIMARY KEY DEFAULT nextval('consultant_id_seq'),
      name                VARCHAR NOT NULL,
      slug                VARCHAR NOT NULL UNIQUE,
      description         VARCHAR,
      system_prompt       TEXT NOT NULL,
      model_id            VARCHAR,
      temperature         FLOAT,
      max_response_tokens INTEGER,
      icon                VARCHAR,
      color               VARCHAR,
      sort_order          INTEGER DEFAULT 0,
      enabled             BOOLEAN DEFAULT true,
      archived_at         TIMESTAMP,
      created_at          TIMESTAMP DEFAULT current_timestamp,
      updated_at          TIMESTAMP DEFAULT current_timestamp
    )
  `);
}
```

**Step 3: Register in db-init.ts**

Add import and call `await ensureConsultantTables(conn);` after `ensureNewsTables(conn)` in `initializeDatabase()`.

**Step 4: Commit**

```bash
git add packages/server/src/consultant/schema.ts packages/server/src/consultant/types.ts packages/server/src/lib/db-init.ts
git commit -m "feat(chat): add consultant table schema and types"
```

---

## Task 2: Consultant Repository

**Files:**
- Create: `packages/server/src/consultant/repository.ts`
- Create: `packages/server/src/consultant/repository.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/consultant/repository.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureConsultantTables } from './schema.ts';
import {
  createConsultant,
  getConsultantById,
  getConsultantBySlug,
  listConsultants,
  updateConsultant,
  archiveConsultant,
} from './repository.ts';

describe('consultant repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureConsultantTables(conn);
  });

  afterEach(() => {
    conn.closeSync();
  });

  const SEED_DATA = {
    name: 'General Analyst',
    slug: 'general-analyst',
    description: 'Balanced FCC filing Q&A',
    systemPrompt: 'You are a general analyst.',
    modelId: null,
    temperature: null,
    maxResponseTokens: null,
    icon: '🔍',
    color: '#3B82F6',
    sortOrder: 0,
    enabled: true,
  };

  describe('createConsultant', () => {
    it('creates and returns a consultant with all fields', async () => {
      const result = await createConsultant(conn, SEED_DATA);

      expect(result).toEqual(expect.objectContaining({
        name: 'General Analyst',
        slug: 'general-analyst',
        description: 'Balanced FCC filing Q&A',
        systemPrompt: 'You are a general analyst.',
        icon: '🔍',
        color: '#3B82F6',
        sortOrder: 0,
        enabled: true,
        archivedAt: null,
      }));
      expect(result.id).toBeGreaterThan(0);
      expect(result.createdAt).toBeTruthy();
    });
  });

  describe('getConsultantById', () => {
    it('returns the consultant when found', async () => {
      const created = await createConsultant(conn, SEED_DATA);
      const found = await getConsultantById(conn, created.id);
      expect(found).toEqual(created);
    });

    it('returns null when not found', async () => {
      const found = await getConsultantById(conn, 99999);
      expect(found).toBeNull();
    });
  });

  describe('getConsultantBySlug', () => {
    it('returns the consultant when found', async () => {
      const created = await createConsultant(conn, SEED_DATA);
      const found = await getConsultantBySlug(conn, 'general-analyst');
      expect(found).toEqual(created);
    });
  });

  describe('listConsultants', () => {
    it('returns only enabled, non-archived by default', async () => {
      await createConsultant(conn, SEED_DATA);
      await createConsultant(conn, { ...SEED_DATA, name: 'Disabled', slug: 'disabled', enabled: false });
      const result = await listConsultants(conn, { enabledOnly: true });
      expect(result).toHaveLength(1);
      expect(result[0]!.slug).toEqual('general-analyst');
    });

    it('returns all when enabledOnly is false', async () => {
      await createConsultant(conn, SEED_DATA);
      await createConsultant(conn, { ...SEED_DATA, name: 'Disabled', slug: 'disabled', enabled: false });
      const result = await listConsultants(conn, { enabledOnly: false });
      expect(result).toHaveLength(2);
    });
  });

  describe('updateConsultant', () => {
    it('updates specified fields only', async () => {
      const created = await createConsultant(conn, SEED_DATA);
      const updated = await updateConsultant(conn, created.id, { name: 'Updated Name' });
      expect(updated!.name).toEqual('Updated Name');
      expect(updated!.slug).toEqual('general-analyst'); // unchanged
    });
  });

  describe('archiveConsultant', () => {
    it('sets archived_at and returns true', async () => {
      const created = await createConsultant(conn, SEED_DATA);
      const result = await archiveConsultant(conn, created.id);
      expect(result).toEqual(true);
      const found = await getConsultantById(conn, created.id);
      expect(found!.archivedAt).toBeTruthy();
    });

    it('returns false for non-existent id', async () => {
      const result = await archiveConsultant(conn, 99999);
      expect(result).toEqual(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm vitest run packages/server/src/consultant/repository.test.ts`
Expected: FAIL — module `./repository.ts` not found.

**Step 3: Write the repository implementation**

Create `packages/server/src/consultant/repository.ts` following the news repository pattern:
- `rowToConsultant()` row mapper
- `createConsultant(conn, data)` — INSERT + SELECT max(id)
- `getConsultantById(conn, id)` — SELECT WHERE id = $1
- `getConsultantBySlug(conn, slug)` — SELECT WHERE slug = $1
- `listConsultants(conn, { enabledOnly })` — SELECT with optional WHERE enabled = true AND archived_at IS NULL, ORDER BY sort_order, name
- `updateConsultant(conn, id, data)` — conditional SET with updated_at
- `archiveConsultant(conn, id)` — SET archived_at = current_timestamp

All using `$1, $2, ...` parameterized queries and `DuckDBValue[]`.

**Step 4: Run tests to verify they pass**

Run: `cd /Users/benton/code/daily-orbit && pnpm vitest run packages/server/src/consultant/repository.test.ts`
Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add packages/server/src/consultant/repository.ts packages/server/src/consultant/repository.test.ts
git commit -m "feat(chat): add consultant repository with CRUD operations"
```

---

## Task 3: Consultant Admin Routes

**Files:**
- Create: `packages/server/src/consultant/routes.ts`
- Modify: `packages/server/src/app.ts`

**Step 1: Create the routes file**

```typescript
// packages/server/src/consultant/routes.ts
import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { getDb } from '../lib/db.ts';
import {
  createConsultant,
  getConsultantById,
  listConsultants,
  updateConsultant,
  archiveConsultant,
} from './repository.ts';

// ── Admin routes (mounted at /api/admin/consultants) ──────────
export const consultantAdminRoutes = new Hono();

// GET / — list all consultants (including disabled/archived)
consultantAdminRoutes.get('/', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const consultants = await listConsultants(conn, { enabledOnly: false });
    return c.json(consultants);
  } finally {
    conn.closeSync();
  }
});

// POST / — create consultant
consultantAdminRoutes.post('/', async (c) => {
  const body = await c.req.json();
  // Validate required fields
  if (!body.name || !body.slug || !body.systemPrompt) {
    return c.json({ error: 'name, slug, and systemPrompt are required' }, 400);
  }
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const consultant = await createConsultant(conn, body);
    return c.json(consultant, 201);
  } catch (err: unknown) {
    const message: string = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('UNIQUE') || message.includes('Duplicate')) {
      return c.json({ error: `Slug "${body.slug}" already exists` }, 409);
    }
    return c.json({ error: message }, 500);
  } finally {
    conn.closeSync();
  }
});

// PUT /:id — update consultant
consultantAdminRoutes.put('/:id', async (c) => {
  const id: number = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const body = await c.req.json();
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const updated = await updateConsultant(conn, id, body);
    if (updated == null) return c.json({ error: 'Consultant not found' }, 404);
    return c.json(updated);
  } finally {
    conn.closeSync();
  }
});

// DELETE /:id — archive (soft-delete)
consultantAdminRoutes.delete('/:id', async (c) => {
  const id: number = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const archived = await archiveConsultant(conn, id);
    if (!archived) return c.json({ error: 'Consultant not found' }, 404);
    return c.json({ ok: true });
  } finally {
    conn.closeSync();
  }
});

// ── Public route (mounted at /api/consultants) ──────────────
export const consultantRoutes = new Hono();

// GET / — list enabled consultants only
consultantRoutes.get('/', async (c) => {
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const consultants = await listConsultants(conn, { enabledOnly: true });
    return c.json(consultants);
  } finally {
    conn.closeSync();
  }
});
```

**Step 2: Mount in app.ts**

Add imports and route mounts:

```typescript
import { consultantRoutes, consultantAdminRoutes } from './consultant/routes.ts';

// In the public prefixes array, add:
'/api/consultants',

// Mount routes:
app.route('/api/consultants', consultantRoutes);
app.route('/api/admin/consultants', consultantAdminRoutes);
```

**Note:** `/api/consultants` is public (users need to see consultant list before authing into chat). Admin routes are already protected by `requireAdmin()` middleware.

**Step 3: Commit**

```bash
git add packages/server/src/consultant/routes.ts packages/server/src/app.ts
git commit -m "feat(chat): add consultant admin and public API routes"
```

---

## Task 4: Seed Consultants CLI Command

**Files:**
- Create: `packages/server/src/consultant/seed.ts`
- Create: `packages/server/src/cli/consultant/index.ts`
- Modify: `packages/server/src/cli/index.ts` (register the subcommand)

**Step 1: Create seed data and function**

```typescript
// packages/server/src/consultant/seed.ts
import type { DuckDBConnection } from '@duckdb/node-api';
import { createConsultant, getConsultantBySlug } from './repository.ts';

const SEED_CONSULTANTS = [
  {
    name: 'General Analyst',
    slug: 'general-analyst',
    description: 'Balanced FCC filing Q&A — a good starting point for any question about filings, companies, or regulatory activity.',
    systemPrompt: `Your focus is providing clear, well-sourced answers about FCC filings and satellite communications. You cover all aspects of the IBFS dataset: applications, comments, attachments, companies, and news. Provide balanced analysis with citations.`,
    icon: '🔍',
    color: '#3B82F6',
    sortOrder: 0,
    enabled: true,
    modelId: null,
    temperature: null,
    maxResponseTokens: null,
  },
  {
    name: 'Regulatory Strategist',
    slug: 'regulatory-strategist',
    description: 'Focuses on procedural status, approval timelines, legal precedent, and recommended actions.',
    systemPrompt: `Your focus is regulatory procedure and legal strategy in FCC satellite licensing. When analyzing filings, emphasize: where the application sits in the approval process, relevant procedural deadlines, precedent from similar filings, potential objections or conditions, and what actions the filer or interested parties should consider. Frame your answers in terms of regulatory risk and strategic positioning.`,
    icon: '⚖️',
    color: '#8B5CF6',
    sortOrder: 1,
    enabled: true,
    modelId: null,
    temperature: null,
    maxResponseTokens: null,
  },
  {
    name: 'Competitive Intelligence',
    slug: 'competitive-intelligence',
    description: 'Focuses on market positioning, company activity patterns, spectrum competition, and M&A implications.',
    systemPrompt: `Your focus is market dynamics and corporate strategy in the satellite communications industry. When analyzing filings, emphasize: who is competing for the same spectrum or orbital slots, patterns in a company's filing activity over time, M&A implications from transfer-of-control or assignment filings, and strategic positioning relative to competitors. Frame your answers in terms of competitive advantage and business impact.`,
    icon: '📊',
    color: '#059669',
    sortOrder: 2,
    enabled: true,
    modelId: null,
    temperature: null,
    maxResponseTokens: null,
  },
];

export async function seedConsultants(
  conn: DuckDBConnection,
): Promise<{ created: number; skipped: number }> {
  let created: number = 0;
  let skipped: number = 0;

  for (const seed of SEED_CONSULTANTS) {
    const existing = await getConsultantBySlug(conn, seed.slug);
    if (existing != null) {
      skipped++;
      continue;
    }
    await createConsultant(conn, seed);
    created++;
  }

  return { created, skipped };
}
```

**Step 2: Create CLI command**

```typescript
// packages/server/src/cli/consultant/index.ts
import { defineCommand } from 'citty';
import { DuckDBConnection } from '@duckdb/node-api';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';

const seedCommand = defineCommand({
  meta: {
    name: 'seed',
    description: 'Seed default consultants (idempotent)',
  },
  args: {
    database: databaseArg,
  },
  async run({ args }) {
    const db = await createDb(args.database);
    const conn: DuckDBConnection = await DuckDBConnection.create(db);

    try {
      const { ensureConsultantTables } = await import('../../consultant/schema.ts');
      await ensureConsultantTables(conn);

      const { seedConsultants } = await import('../../consultant/seed.ts');
      const result = await seedConsultants(conn);

      console.log(
        `Seed complete: ${String(result.created)} created, ${String(result.skipped)} skipped (already exist)`,
      );
    } finally {
      conn.closeSync();
    }
  },
});

export const consultantCommand = defineCommand({
  meta: {
    name: 'consultant',
    description: 'Manage consultant personas',
  },
  subCommands: {
    seed: seedCommand,
  },
});
```

**Step 3: Register in main CLI**

In `packages/server/src/cli/index.ts`, import and add `consultant: consultantCommand` to the `subCommands` object of the main command.

**Step 4: Test manually**

Run: `cd /Users/benton/code/daily-orbit && ./daily-orbit consultant seed`
Expected: `Seed complete: 3 created, 0 skipped (already exist)`

Run again: `./daily-orbit consultant seed`
Expected: `Seed complete: 0 created, 3 skipped (already exist)`

**Step 5: Commit**

```bash
git add packages/server/src/consultant/seed.ts packages/server/src/cli/consultant/index.ts packages/server/src/cli/index.ts
git commit -m "feat(chat): add seed consultants CLI command"
```

---

## Task 5: Conversation & Message Schema and Types

**Files:**
- Create: `packages/server/src/chat/schema.ts`
- Create: `packages/server/src/chat/types.ts`
- Modify: `packages/server/src/lib/db-init.ts`

**Step 1: Create chat types**

```typescript
// packages/server/src/chat/types.ts
import type { RetrievedSource, QueryUsage } from '../query/types.ts';

export type Conversation = {
  id: string;
  userId: string;
  consultantId: number;
  consultantName: string | null;   // joined from consultant table
  consultantIcon: string | null;
  consultantColor: string | null;
  title: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources: RetrievedSource[] | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number;
  modelId: string | null;
  consultantId: number | null;
  sequence: number;
  createdAt: string;
};

export type ConversationWithMessages = Conversation & {
  messages: Message[];
};

export type ChatSSEEvent =
  | {
      type: 'status';
      stage: 'rewriting' | 'retrieving' | 'generating';
      message: string;
    }
  | { type: 'sources'; sources: RetrievedSource[] }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: QueryUsage & { costCents: number } }
  | { type: 'title'; title: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
```

**Step 2: Create chat schema**

```typescript
// packages/server/src/chat/schema.ts
import type { DuckDBConnection } from '@duckdb/node-api';

export async function ensureChatTables(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS conversation (
      id                  VARCHAR PRIMARY KEY,
      user_id             VARCHAR NOT NULL,
      consultant_id       INTEGER NOT NULL,
      title               VARCHAR,
      total_input_tokens  INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cost_cents    FLOAT DEFAULT 0,
      created_at          TIMESTAMP DEFAULT current_timestamp,
      updated_at          TIMESTAMP DEFAULT current_timestamp
    )
  `);

  await conn.run(`
    CREATE INDEX IF NOT EXISTS idx_conversation_user_id
    ON conversation(user_id)
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS message (
      id                VARCHAR PRIMARY KEY,
      conversation_id   VARCHAR NOT NULL,
      role              VARCHAR NOT NULL,
      content           TEXT NOT NULL,
      sources           JSON,
      input_tokens      INTEGER,
      output_tokens     INTEGER,
      cost_cents        FLOAT DEFAULT 0,
      model_id          VARCHAR,
      consultant_id     INTEGER,
      sequence          INTEGER NOT NULL,
      created_at        TIMESTAMP DEFAULT current_timestamp
    )
  `);

  await conn.run(`
    CREATE INDEX IF NOT EXISTS idx_message_conversation_seq
    ON message(conversation_id, sequence)
  `);
}
```

**Step 3: Register in db-init.ts**

Add import and call `await ensureChatTables(conn);` after `ensureConsultantTables(conn)`.

**Step 4: Commit**

```bash
git add packages/server/src/chat/schema.ts packages/server/src/chat/types.ts packages/server/src/lib/db-init.ts
git commit -m "feat(chat): add conversation and message table schemas"
```

---

## Task 6: Chat Repository

**Files:**
- Create: `packages/server/src/chat/repository.ts`
- Create: `packages/server/src/chat/repository.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/chat/repository.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureConsultantTables } from '../consultant/schema.ts';
import { createConsultant } from '../consultant/repository.ts';
import { ensureChatTables } from './schema.ts';
import {
  createConversation,
  getConversationById,
  listConversations,
  updateConversationTitle,
  deleteConversation,
  createMessage,
  listMessages,
  getNextSequence,
  updateConversationTotals,
} from './repository.ts';

describe('chat repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let consultantId: number;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureConsultantTables(conn);
    await ensureChatTables(conn);

    const consultant = await createConsultant(conn, {
      name: 'Test Consultant',
      slug: 'test-consultant',
      description: 'For testing',
      systemPrompt: 'You are a test consultant.',
      modelId: null,
      temperature: null,
      maxResponseTokens: null,
      icon: '🧪',
      color: '#FF0000',
      sortOrder: 0,
      enabled: true,
    });
    consultantId = consultant.id;
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('createConversation', () => {
    it('creates a conversation with generated UUID', async () => {
      const conv = await createConversation(conn, {
        userId: 'user-1',
        consultantId,
      });

      expect(conv.id).toBeTruthy();
      expect(conv.userId).toEqual('user-1');
      expect(conv.consultantId).toEqual(consultantId);
      expect(conv.title).toBeNull();
      expect(conv.totalInputTokens).toEqual(0);
      expect(conv.totalCostCents).toEqual(0);
    });
  });

  describe('listConversations', () => {
    it('returns only conversations for the specified user', async () => {
      await createConversation(conn, { userId: 'user-1', consultantId });
      await createConversation(conn, { userId: 'user-2', consultantId });

      const result = await listConversations(conn, 'user-1');
      expect(result).toHaveLength(1);
      expect(result[0]!.userId).toEqual('user-1');
    });
  });

  describe('updateConversationTitle', () => {
    it('updates the title', async () => {
      const conv = await createConversation(conn, { userId: 'user-1', consultantId });
      const updated = await updateConversationTitle(conn, conv.id, 'New Title');
      expect(updated!.title).toEqual('New Title');
    });
  });

  describe('deleteConversation', () => {
    it('deletes conversation and its messages', async () => {
      const conv = await createConversation(conn, { userId: 'user-1', consultantId });
      await createMessage(conn, {
        conversationId: conv.id,
        role: 'user',
        content: 'Hello',
        sequence: 1,
      });

      const deleted = await deleteConversation(conn, conv.id);
      expect(deleted).toEqual(true);

      const found = await getConversationById(conn, conv.id);
      expect(found).toBeNull();

      const messages = await listMessages(conn, conv.id);
      expect(messages).toHaveLength(0);
    });
  });

  describe('messages', () => {
    it('creates and lists messages in sequence order', async () => {
      const conv = await createConversation(conn, { userId: 'user-1', consultantId });

      await createMessage(conn, {
        conversationId: conv.id,
        role: 'user',
        content: 'What is STA?',
        sequence: 1,
      });
      await createMessage(conn, {
        conversationId: conv.id,
        role: 'assistant',
        content: 'STA stands for Special Temporary Authority.',
        sources: [{ type: 'filing', id: 'SAT-STA-123', title: 'Test', snippet: 'test', score: 1.0 }],
        inputTokens: 100,
        outputTokens: 50,
        costCents: 0.02,
        modelId: 'us.amazon.nova-pro-v1:0',
        consultantId,
        sequence: 2,
      });

      const messages = await listMessages(conn, conv.id);
      expect(messages).toHaveLength(2);
      expect(messages[0]!.role).toEqual('user');
      expect(messages[0]!.sequence).toEqual(1);
      expect(messages[1]!.role).toEqual('assistant');
      expect(messages[1]!.sources).toHaveLength(1);
    });
  });

  describe('getNextSequence', () => {
    it('returns 1 for empty conversation', async () => {
      const conv = await createConversation(conn, { userId: 'user-1', consultantId });
      const seq = await getNextSequence(conn, conv.id);
      expect(seq).toEqual(1);
    });

    it('returns max + 1 after messages exist', async () => {
      const conv = await createConversation(conn, { userId: 'user-1', consultantId });
      await createMessage(conn, { conversationId: conv.id, role: 'user', content: 'Hi', sequence: 1 });
      const seq = await getNextSequence(conn, conv.id);
      expect(seq).toEqual(2);
    });
  });

  describe('updateConversationTotals', () => {
    it('increments token and cost totals', async () => {
      const conv = await createConversation(conn, { userId: 'user-1', consultantId });
      await updateConversationTotals(conn, conv.id, {
        inputTokens: 100,
        outputTokens: 50,
        costCents: 0.5,
        consultantId,
      });
      const updated = await getConversationById(conn, conv.id);
      expect(updated!.totalInputTokens).toEqual(100);
      expect(updated!.totalOutputTokens).toEqual(50);
      expect(updated!.totalCostCents).toBeCloseTo(0.5);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm vitest run packages/server/src/chat/repository.test.ts`
Expected: FAIL — module `./repository.ts` not found.

**Step 3: Write the repository implementation**

Create `packages/server/src/chat/repository.ts` with these functions:

- `rowToConversation(r)` — maps snake_case to camelCase, joins consultant name/icon/color
- `rowToMessage(r)` — maps snake_case to camelCase, parses JSON sources
- `createConversation(conn, { userId, consultantId })` — INSERT with `gen_random_uuid()`, return created row (LEFT JOIN consultant for name/icon/color)
- `getConversationById(conn, id)` — SELECT with LEFT JOIN consultant
- `listConversations(conn, userId)` — SELECT WHERE user_id = $1 ORDER BY updated_at DESC
- `updateConversationTitle(conn, id, title)` — UPDATE title + updated_at
- `deleteConversation(conn, id)` — DELETE messages first (WHERE conversation_id = $1), then DELETE conversation
- `createMessage(conn, data)` — INSERT with `gen_random_uuid()`, optional fields for sources/tokens/cost/model/consultant
- `listMessages(conn, conversationId)` — SELECT ORDER BY sequence ASC
- `getNextSequence(conn, conversationId)` — `SELECT COALESCE(MAX(sequence), 0) + 1`
- `updateConversationTotals(conn, id, { inputTokens, outputTokens, costCents, consultantId })` — UPDATE with `+= $N` increments, set consultant_id, bump updated_at

**Key:** Use LEFT JOIN on consultant to populate `consultant_name`, `consultant_icon`, `consultant_color` in conversation queries. This handles archived consultants gracefully (fields become null).

**Step 4: Run tests to verify they pass**

Run: `cd /Users/benton/code/daily-orbit && pnpm vitest run packages/server/src/chat/repository.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/server/src/chat/repository.ts packages/server/src/chat/repository.test.ts
git commit -m "feat(chat): add conversation and message repository with tests"
```

---

## Task 7: Team Preamble Generator

**Files:**
- Create: `packages/server/src/chat/team-preamble.ts`
- Create: `packages/server/src/chat/team-preamble.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/chat/team-preamble.test.ts
import { describe, expect, it } from 'vitest';
import { buildTeamPreamble } from './team-preamble.ts';
import type { Consultant } from '../consultant/types.ts';

describe('buildTeamPreamble', () => {
  const CONSULTANTS: Consultant[] = [
    {
      id: 1, name: 'General Analyst', slug: 'general-analyst',
      description: 'Balanced Q&A', systemPrompt: '', modelId: null,
      temperature: null, maxResponseTokens: null, icon: '🔍',
      color: '#3B82F6', sortOrder: 0, enabled: true,
      archivedAt: null, createdAt: '', updatedAt: '',
    },
    {
      id: 2, name: 'Regulatory Strategist', slug: 'regulatory-strategist',
      description: 'Legal precedent and timelines', systemPrompt: '', modelId: null,
      temperature: null, maxResponseTokens: null, icon: '⚖️',
      color: '#8B5CF6', sortOrder: 1, enabled: true,
      archivedAt: null, createdAt: '', updatedAt: '',
    },
  ];

  it('includes the current consultant name and all team members', () => {
    const preamble = buildTeamPreamble('General Analyst', CONSULTANTS);
    expect(preamble).toContain('You are **General Analyst**');
    expect(preamble).toContain('**General Analyst**');
    expect(preamble).toContain('**Regulatory Strategist**');
    expect(preamble).toContain('Balanced Q&A');
    expect(preamble).toContain('Legal precedent and timelines');
  });

  it('includes the collaboration instruction', () => {
    const preamble = buildTeamPreamble('General Analyst', CONSULTANTS);
    expect(preamble).toContain('colleagues');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/benton/code/daily-orbit && pnpm vitest run packages/server/src/chat/team-preamble.test.ts`

**Step 3: Implement**

```typescript
// packages/server/src/chat/team-preamble.ts
import type { Consultant } from '../consultant/types.ts';

export function buildTeamPreamble(
  currentName: string,
  allConsultants: Consultant[],
): string {
  const memberList: string = allConsultants
    .map((c: Consultant) => `- **${c.name}** — ${c.description ?? 'Team member'}`)
    .join('\n');

  return `You are **${currentName}**, a member of the Daily Orbit analyst team. Your team includes:
${memberList}

When another team member's expertise would better serve the user's question, suggest they switch. You can see and build upon your colleagues' prior responses in the conversation.`;
}
```

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/server/src/chat/team-preamble.ts packages/server/src/chat/team-preamble.test.ts
git commit -m "feat(chat): add dynamic team preamble generator"
```

---

## Task 8: Chat Streaming Generator

This is the core of the feature — a new `generateChatAnswer` async generator that wraps the existing RAG pipeline with multi-turn message history.

**Files:**
- Create: `packages/server/src/chat/generate-chat.ts`

**Step 1: Implement the generator**

This function:
1. Accepts the user's question, conversation message history, consultant config, team preamble, retrieved sources
2. Builds the Bedrock `messages` array: prior turns verbatim + final user message with RAG context
3. Sets system prompt to `teamPreamble + '\n\n' + consultant.systemPrompt`
4. Uses consultant's model_id (or falls back to config default), temperature, max_response_tokens
5. Streams via `client.converseStream()`, yielding `ChatSSEEvent` deltas
6. Returns `{ inputTokens, outputTokens }` on completion

```typescript
// packages/server/src/chat/generate-chat.ts
import type { ConverseStreamCommandInput, Message as BedrockMessage } from '@aws-sdk/client-bedrock-runtime';
import { renderPrompt } from '../inference/prompts.ts';
import type { BedrockClient } from '../inference/bedrock-client.ts';
import type { RetrievedSource } from '../query/types.ts';
import { DEFAULT_GENERATE_USER_PROMPT } from '../query/generate.ts';
import type { Message } from './types.ts';
import type { ChatSSEEvent } from './types.ts';
import type { Consultant } from '../consultant/types.ts';

function buildContextBlock(sources: RetrievedSource[]): string {
  return sources
    .map(
      (s: RetrievedSource, i: number) =>
        `[Source ${i + 1}: ${s.type} — ${s.id}]\nTitle: ${s.title}\n${s.snippet}`,
    )
    .join('\n\n');
}

export type ChatGenerateOptions = {
  question: string;
  sources: RetrievedSource[];
  history: Message[];
  consultant: Consultant;
  teamPreamble: string;
  client: BedrockClient;
  fallbackModelId: string;
  userPromptTemplate?: string;
};

export type ChatGenerateUsage = {
  inputTokens: number;
  outputTokens: number;
};

export async function* generateChatAnswer(
  opts: ChatGenerateOptions,
): AsyncGenerator<ChatSSEEvent, ChatGenerateUsage> {
  const {
    question,
    sources,
    history,
    consultant,
    teamPreamble,
    client,
    fallbackModelId,
    userPromptTemplate,
  } = opts;

  // Build system prompt: team preamble + consultant-specific prompt
  const systemPrompt: string = `${teamPreamble}\n\n${consultant.systemPrompt}`;

  // Build message history for Bedrock
  const bedrockMessages: BedrockMessage[] = [];

  // Prior turns verbatim
  for (const msg of history) {
    bedrockMessages.push({
      role: msg.role,
      content: [{ text: msg.content }],
    });
  }

  // Final user message with RAG context
  const contextBlock: string = buildContextBlock(sources);
  const template: string = userPromptTemplate || DEFAULT_GENERATE_USER_PROMPT;
  const userMessage: string = renderPrompt(template, {
    context: contextBlock,
    question,
  });
  bedrockMessages.push({
    role: 'user',
    content: [{ text: userMessage }],
  });

  // Model + inference config
  const modelId: string = consultant.modelId || fallbackModelId;
  const inferenceConfig: Record<string, number> = {};
  if (consultant.maxResponseTokens != null) {
    inferenceConfig.maxTokens = consultant.maxResponseTokens;
  } else {
    inferenceConfig.maxTokens = 4096;
  }
  if (consultant.temperature != null) {
    inferenceConfig.temperature = consultant.temperature;
  }

  const input: ConverseStreamCommandInput = {
    modelId,
    system: [{ text: systemPrompt }],
    messages: bedrockMessages,
    inferenceConfig,
  };

  let inputTokens: number = 0;
  let outputTokens: number = 0;

  for await (const event of client.converseStream(input)) {
    if (event.contentBlockDelta != null) {
      const delta = event.contentBlockDelta.delta;
      if (delta != null && 'text' in delta && delta.text != null) {
        yield { type: 'delta', text: delta.text };
      }
    }

    if (event.metadata != null) {
      const usage = event.metadata.usage;
      if (usage != null) {
        inputTokens = usage.inputTokens ?? 0;
        outputTokens = usage.outputTokens ?? 0;
      }
    }
  }

  return { inputTokens, outputTokens };
}
```

**Step 2: Commit**

```bash
git add packages/server/src/chat/generate-chat.ts
git commit -m "feat(chat): add multi-turn chat streaming generator"
```

---

## Task 9: Auto-Title Generator

**Files:**
- Create: `packages/server/src/chat/auto-title.ts`
- Create: `packages/server/src/chat/auto-title.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/chat/auto-title.test.ts
import { describe, expect, it } from 'vitest';
import { buildTitlePrompt, parseTitleResponse } from './auto-title.ts';

describe('auto-title', () => {
  describe('buildTitlePrompt', () => {
    it('includes the question and answer in the prompt', () => {
      const prompt = buildTitlePrompt('What is STA?', 'STA stands for Special Temporary Authority.');
      expect(prompt).toContain('What is STA?');
      expect(prompt).toContain('STA stands for Special Temporary Authority.');
    });
  });

  describe('parseTitleResponse', () => {
    it('strips quotes and trims whitespace', () => {
      expect(parseTitleResponse('"STA Overview"')).toEqual('STA Overview');
      expect(parseTitleResponse('  STA Overview  ')).toEqual('STA Overview');
      expect(parseTitleResponse("'STA Overview'")).toEqual('STA Overview');
    });

    it('truncates to 80 characters', () => {
      const long = 'A'.repeat(100);
      expect(parseTitleResponse(long).length).toBeLessThanOrEqual(80);
    });
  });
});
```

**Step 2: Implement**

```typescript
// packages/server/src/chat/auto-title.ts
import type { BedrockClient } from '../inference/bedrock-client.ts';

const TITLE_SYSTEM_PROMPT: string =
  'Generate a short, descriptive title (5-10 words) for this conversation. Respond with only the title, no quotes or punctuation.';

export function buildTitlePrompt(question: string, answer: string): string {
  return `User asked: ${question}\n\nAssistant answered: ${answer.slice(0, 500)}`;
}

export function parseTitleResponse(raw: string): string {
  let title: string = raw.trim();
  // Strip surrounding quotes
  if ((title.startsWith('"') && title.endsWith('"')) ||
      (title.startsWith("'") && title.endsWith("'"))) {
    title = title.slice(1, -1).trim();
  }
  // Truncate
  if (title.length > 80) {
    title = title.slice(0, 77) + '...';
  }
  return title;
}

export async function generateTitle(
  question: string,
  answer: string,
  client: BedrockClient,
  modelId: string,
): Promise<string> {
  const userMessage: string = buildTitlePrompt(question, answer);

  const response = await client.converse({
    modelId,
    system: [{ text: TITLE_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: userMessage }] }],
    inferenceConfig: { maxTokens: 50, temperature: 0.3 },
  });

  const raw: string =
    response.output?.message?.content?.[0]?.text ?? 'Untitled conversation';
  return parseTitleResponse(raw);
}
```

**Step 3: Run tests**

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/server/src/chat/auto-title.ts packages/server/src/chat/auto-title.test.ts
git commit -m "feat(chat): add auto-title generation for conversations"
```

---

## Task 10: Chat Routes (Conversation CRUD + Message Streaming)

This is the largest task — the main API endpoints.

**Files:**
- Create: `packages/server/src/chat/routes.ts`
- Modify: `packages/server/src/app.ts`

**Step 1: Implement chat routes**

Create `packages/server/src/chat/routes.ts` with a Hono router:

**Conversation CRUD endpoints:**
- `GET /` — `listConversations(conn, userId)` — get userId from auth session
- `POST /` — `createConversation(conn, { userId, consultantId })` — validate consultantId exists and is enabled
- `GET /:id` — `getConversationById(conn, id)` + `listMessages(conn, id)` — verify user owns it
- `PUT /:id` — `updateConversationTitle(conn, id, title)` — verify ownership
- `DELETE /:id` — `deleteConversation(conn, id)` — verify ownership

**Message streaming endpoint:**
- `POST /:id/messages` — the core flow from the design doc

The message endpoint implementation:

```typescript
chatRoutes.post('/:id/messages', async (c) => {
  const conversationId: string = c.req.param('id');
  const body = await c.req.json<{ content: string }>();
  const content: string = body.content?.trim() ?? '';
  if (content === '') return c.json({ error: 'Content is required' }, 400);

  // Get auth user (from session middleware — use c.get('user') or equivalent)
  // Verify conversation exists and belongs to user
  // Load consultant config
  // Load team members for preamble

  return streamSSE(c, async (stream) => {
    let eventId: number = 0;
    const emit = async (event: ChatSSEEvent): Promise<void> => {
      await stream.writeSSE({ id: String(eventId++), data: JSON.stringify(event) });
    };

    try {
      const db = await getDb();
      const conn: DuckDBConnection = await DuckDBConnection.create(db);
      try {
        // 1. Persist user message
        const seq: number = await getNextSequence(conn, conversationId);
        await createMessage(conn, { conversationId, role: 'user', content, sequence: seq });

        // 2. Load history + consultant
        const history: Message[] = await listMessages(conn, conversationId);
        const conversation = await getConversationById(conn, conversationId);
        const consultant = await getConsultantById(conn2, conversation.consultantId);
        const allConsultants = await listConsultants(conn, { enabledOnly: true });
        const teamPreamble: string = buildTeamPreamble(consultant.name, allConsultants);

        // 3. Rewrite (existing pipeline)
        await emit({ type: 'status', stage: 'rewriting', message: 'Analyzing your question...' });
        const { queries, usage: rewriteUsage } = await rewriteQuery(content, client, rewriteModelId);

        // 4. Retrieve (existing pipeline)
        await emit({ type: 'status', stage: 'retrieving', message: 'Searching...' });
        const retrieval = await retrieveContext(queries, conn, embeddingCtx);
        await emit({ type: 'sources', sources: retrieval.sources });

        // 5. Generate (multi-turn streaming)
        await emit({ type: 'status', stage: 'generating', message: 'Generating answer...' });
        // Pass history WITHOUT the just-inserted user message (it's the current question)
        const priorHistory: Message[] = history.slice(0, -1);  // exclude current user msg

        let answerText: string = '';
        const gen = generateChatAnswer({
          question: content,
          sources: retrieval.sources,
          history: priorHistory,
          consultant,
          teamPreamble,
          client,
          fallbackModelId: generateModelId,
        });
        let result = await gen.next();
        while (!result.done) {
          if (result.value.type === 'delta') answerText += result.value.text;
          await emit(result.value);
          result = await gen.next();
        }
        const genUsage = result.value;

        // 6. Persist assistant message
        const assistantSeq: number = await getNextSequence(conn, conversationId);
        await createMessage(conn, {
          conversationId,
          role: 'assistant',
          content: answerText,
          sources: retrieval.sources,
          inputTokens: genUsage.inputTokens,
          outputTokens: genUsage.outputTokens,
          costCents: 0,  // TODO: calculate from model pricing
          modelId: consultant.modelId || generateModelId,
          consultantId: consultant.id,
          sequence: assistantSeq,
        });

        // 7. Update conversation totals
        await updateConversationTotals(conn, conversationId, {
          inputTokens: rewriteUsage.input + genUsage.inputTokens,
          outputTokens: rewriteUsage.output + genUsage.outputTokens,
          costCents: 0,
          consultantId: consultant.id,
        });

        // 8. Usage event
        const totalMs: number = Math.round(performance.now() - startMs);
        await emit({
          type: 'usage',
          usage: {
            rewriteTokens: rewriteUsage,
            generateTokens: { input: genUsage.inputTokens, output: genUsage.outputTokens },
            retrievalMs: retrieval.retrievalMs,
            totalMs,
            costCents: 0,
          },
        });

        // 9. Auto-title (first exchange only)
        if (assistantSeq === 2 && conversation.title == null) {
          try {
            const title = await generateTitle(content, answerText, client, rewriteModelId);
            await updateConversationTitle(conn, conversationId, title);
            await emit({ type: 'title', title });
          } catch {
            // Non-critical — don't fail the stream if title generation fails
          }
        }
      } finally {
        conn.closeSync();
      }

      await emit({ type: 'done' });
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : 'An unexpected error occurred';
      await emit({ type: 'error', message });
    }
  });
});
```

**Step 2: Mount in app.ts**

```typescript
import { chatRoutes } from './chat/routes.ts';

// Mount (auth-required, not in publicPrefixes):
app.route('/api/conversations', chatRoutes);
```

**Step 3: Get user ID from auth context**

Look at how existing auth-required routes extract the user. The pattern should use the session from `better-auth`. Check `packages/server/src/user/routes.ts` or `packages/server/src/lib/auth-middleware.ts` for the exact mechanism (likely `c.get('session')` or `c.get('user')`). Use the same pattern.

**Step 4: Commit**

```bash
git add packages/server/src/chat/routes.ts packages/server/src/app.ts
git commit -m "feat(chat): add conversation CRUD and message streaming routes"
```

---

## Task 11: Chat Routes E2E Test

**Files:**
- Create: `packages/server/src/chat/routes.test.ts`

**Step 1: Write e2e test**

Follow the pattern from `packages/server/src/query/e2e.test.ts`:
- Mock `BedrockClient` with canned rewrite + stream + title responses
- Mock `getDb` to return in-memory DuckDB
- Seed consultant + create conversation
- POST a message, read SSE stream, verify:
  - Status events arrive in order (rewriting → retrieving → generating)
  - Sources event is emitted
  - Delta events accumulate into an answer
  - Usage event has token counts
  - Done event terminates the stream
  - Message is persisted in DB
  - Conversation totals are updated
  - Title is auto-generated on first exchange

**Step 2: Run test**

Run: `cd /Users/benton/code/daily-orbit && pnpm vitest run packages/server/src/chat/routes.test.ts`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/server/src/chat/routes.test.ts
git commit -m "test(chat): add e2e test for chat message streaming"
```

---

## Task 12: Lint, Format, Full Test Suite

**Step 1: Run linter**

Run: `cd /Users/benton/code/daily-orbit && make lint`
Fix any issues.

**Step 2: Run formatter**

Run: `cd /Users/benton/code/daily-orbit && make format`

**Step 3: Run full test suite**

Run: `cd /Users/benton/code/daily-orbit && make test`
Expected: All tests pass, including existing query tests (unchanged).

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "style: fix lint and format issues in chat module"
```

---

## Summary of Created Files

| File | Purpose |
|------|---------|
| `packages/server/src/consultant/types.ts` | Consultant domain type |
| `packages/server/src/consultant/schema.ts` | Consultant table DDL |
| `packages/server/src/consultant/repository.ts` | Consultant CRUD queries |
| `packages/server/src/consultant/repository.test.ts` | Consultant repo unit tests |
| `packages/server/src/consultant/routes.ts` | Admin + public API routes |
| `packages/server/src/consultant/seed.ts` | Seed data + function |
| `packages/server/src/cli/consultant/index.ts` | CLI subcommand |
| `packages/server/src/chat/types.ts` | Conversation, Message, ChatSSEEvent types |
| `packages/server/src/chat/schema.ts` | Conversation + message table DDL |
| `packages/server/src/chat/repository.ts` | Conversation + message CRUD |
| `packages/server/src/chat/repository.test.ts` | Chat repo unit tests |
| `packages/server/src/chat/team-preamble.ts` | Dynamic team preamble builder |
| `packages/server/src/chat/team-preamble.test.ts` | Preamble unit tests |
| `packages/server/src/chat/generate-chat.ts` | Multi-turn streaming generator |
| `packages/server/src/chat/auto-title.ts` | Auto-title generation |
| `packages/server/src/chat/auto-title.test.ts` | Auto-title unit tests |
| `packages/server/src/chat/routes.ts` | Chat conversation + message API |
| `packages/server/src/chat/routes.test.ts` | Chat e2e test |

## Modified Files

| File | Change |
|------|--------|
| `packages/server/src/lib/db-init.ts` | Import + call `ensureConsultantTables`, `ensureChatTables` |
| `packages/server/src/app.ts` | Import + mount chat and consultant routes |
| `packages/server/src/cli/index.ts` | Register consultant CLI subcommand |
