import { defineCommand } from 'citty';
import { DuckDBConnection } from '@duckdb/node-api';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';
import { BedrockClient } from '../../inference/bedrock-client.ts';
import { InstrumentedBedrockClient } from '../../inference/instrumented-client.ts';
import { ensureInferenceLogTable } from '../../inference/schema.ts';
import { InferenceService } from '../../inference/inference-service.ts';
import { setConfigService } from '../../lib/config.ts';
import type {
  InferenceRequest,
  InferenceResponse,
} from '../../inference/types.ts';

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT: string = `You are a legal analyst specializing in US telecommunications regulation.
You produce concise, neutral summaries of FCC filings for use in research databases.
Your tone is formal and precise. You focus on what the filing requests or proposes,
the parties involved, and the technical or regulatory specifics.

Context: The FCC International Bureau Filing System (IBFS) — now replaced by ICFS —
processes applications for satellite, earth station, submarine cable, and international
telecommunications authorizations. Filings include license applications, modifications,
transfers of control, and special temporary authorities.`;

function buildUserPrompt(meta: AttachmentMeta): string {
  return `Summarize the following FCC filing attachment in one to two paragraphs.
Focus on: what is being requested or proposed, by whom, and any notable
technical parameters or regulatory conditions. Do not speculate on the
outcome or current status of the filing.

Filing: ${meta.fileNumber}
Filed by: ${meta.applicantName}
Date filed: ${meta.dateFiled}
Application type: ${meta.appTypeCode}
Subsystem: ${meta.subsystemCode}

--- Begin extracted text ---
${meta.fullText}
--- End extracted text ---`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttachmentMeta = {
  readonly attachmentKey: number;
  readonly fileNumber: string;
  readonly applicantName: string;
  readonly dateFiled: string;
  readonly appTypeCode: string;
  readonly subsystemCode: string;
  readonly attachmentName: string;
  readonly textLength: number;
  readonly fullText: string;
};

type SummaryResult = {
  readonly model: string;
  readonly fileNumber: string;
  readonly textLength: number;
  readonly content: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly stopReason: string;
};

// ---------------------------------------------------------------------------
// Default models to test
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: readonly string[] = [
  'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'us.amazon.nova-pro-v1:0',
  'us.anthropic.claude-sonnet-4-5-20250514-v1:0',
];

// ---------------------------------------------------------------------------
// Minimal ConfigService shim for standalone CLI usage
// ---------------------------------------------------------------------------

class StandaloneConfig {
  private readonly values: Map<string, string>;

  constructor(region: string, defaultModel: string) {
    this.values = new Map([
      ['bedrockRegion', region],
      ['bedrockDefaultModel', defaultModel],
    ]);
  }

  get(key: string): string {
    return this.values.get(key) ?? '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getAll(): Record<string, string> {
    return Object.fromEntries(this.values);
  }
}

// ---------------------------------------------------------------------------
// Query: sample attachments with text, joined to filing metadata
// ---------------------------------------------------------------------------

async function sampleAttachments(
  conn: DuckDBConnection,
  sampleSize: number,
): Promise<AttachmentMeta[]> {
  const sql: string = `
    SELECT
      a.attachment_key,
      a.file_number,
      COALESCE(f.signer_name, '(unknown)') AS applicant_name,
      COALESCE(CAST(f.date_filed AS VARCHAR), '(unknown)') AS date_filed,
      COALESCE(f.app_type_code, '(unknown)') AS app_type_code,
      COALESCE(f.subsystem_code, '(unknown)') AS subsystem_code,
      a.attachment_name,
      a.text_length,
      a.full_text
    FROM attachment a
    JOIN filing f ON a.file_number = f.file_number
    WHERE a.full_text IS NOT NULL
      AND a.text_length BETWEEN 1000 AND 50000
      AND f.subsystem_code IN ('SAT', 'SES')
      AND f.app_type_code IN ('LOA', 'MOD', 'STA', 'AMD', 'LIC', 'REG', 'PPL')
    ORDER BY random()
    LIMIT ${String(sampleSize)}
  `;
  const reader = await conn.runAndReadAll(sql);
  const rows: AttachmentMeta[] = [];
  for (const row of reader.getRows()) {
    rows.push({
      attachmentKey: Number(row[0]),
      fileNumber: String(row[1]),
      applicantName: String(row[2]),
      dateFiled: String(row[3]),
      appTypeCode: String(row[4]),
      subsystemCode: String(row[5]),
      attachmentName: String(row[6]),
      textLength: Number(row[7]),
      fullText: String(row[8]),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Summarize a single attachment with a single model
// ---------------------------------------------------------------------------

async function summarizeOne(
  service: InferenceService,
  modelId: string,
  meta: AttachmentMeta,
): Promise<SummaryResult> {
  const request: InferenceRequest = {
    modelId,
    messages: [{ role: 'user', content: buildUserPrompt(meta) }],
    params: {
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 512,
      temperature: 0.3,
    },
  };

  const resp: InferenceResponse = await service.complete(request);

  return {
    model: resp.modelId,
    fileNumber: meta.fileNumber,
    textLength: meta.textLength,
    content: resp.content,
    inputTokens: resp.usage.inputTokens,
    outputTokens: resp.usage.outputTokens,
    latencyMs: resp.latencyMs,
    stopReason: resp.stopReason,
  };
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

async function writeResult(
  outputDir: string,
  meta: AttachmentMeta,
  modelLabel: string,
  result: SummaryResult,
): Promise<void> {
  // Organize: outputDir / <file_number> / <model_label>.md
  const safeFileNumber: string = meta.fileNumber.replace(/\//g, '_');
  const docDir: string = join(outputDir, safeFileNumber);
  await mkdir(docDir, { recursive: true });

  const content: string = `# Summary: ${meta.fileNumber}

## Metadata
- **Attachment**: ${meta.attachmentName}
- **Filed by**: ${meta.applicantName}
- **Date filed**: ${meta.dateFiled}
- **Type**: ${meta.subsystemCode}-${meta.appTypeCode}
- **Text length**: ${String(meta.textLength)} chars
- **Model**: ${result.model}
- **Input tokens**: ${String(result.inputTokens)}
- **Output tokens**: ${String(result.outputTokens)}
- **Latency**: ${String(result.latencyMs)} ms
- **Stop reason**: ${result.stopReason}

## Summary

${result.content}
`;

  const filePath: string = join(docDir, `${modelLabel}.md`);
  await writeFile(filePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Write aggregate stats
// ---------------------------------------------------------------------------

type AggregateStats = {
  readonly model: string;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalLatencyMs: number;
  readonly avgLatencyMs: number;
  readonly count: number;
};

const TOTAL_DOCS_WITH_TEXT: number = 110_896;

async function writeStats(
  outputDir: string,
  allResults: Map<string, SummaryResult[]>,
): Promise<void> {
  const stats: AggregateStats[] = [];
  for (const [model, results] of allResults) {
    const totalInput: number = results.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutput: number = results.reduce((s, r) => s + r.outputTokens, 0);
    const totalLatency: number = results.reduce((s, r) => s + r.latencyMs, 0);
    stats.push({
      model,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalLatencyMs: totalLatency,
      avgLatencyMs: Math.round(totalLatency / results.length),
      count: results.length,
    });
  }

  let md: string = `# Summarization Sample Results

Generated: ${new Date().toISOString()}
Sample size: ${String(stats[0]?.count ?? 0)} docs
Full backlog: ${String(TOTAL_DOCS_WITH_TEXT)} docs with extracted text

## Sample: Token Usage & Latency

| Model | Docs | Input Tokens | Output Tokens | Total Latency | Avg Latency | Min | Median | Max | p95 |
|---|---|---|---|---|---|---|---|---|---|
`;
  for (const s of stats) {
    const results: SummaryResult[] = allResults.get(s.model) ?? [];
    const latencies: number[] = results
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);
    const min: number = latencies[0] ?? 0;
    const max: number = latencies[latencies.length - 1] ?? 0;
    const median: number = latencies[Math.floor(latencies.length / 2)] ?? 0;
    const p95: number = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    md += `| ${s.model} | ${String(s.count)} | ${String(s.totalInputTokens)} | ${String(s.totalOutputTokens)} | ${String(s.totalLatencyMs)} ms | ${String(s.avgLatencyMs)} ms | ${String(min)} ms | ${String(median)} ms | ${String(max)} ms | ${String(p95)} ms |\n`;
  }

  // --- Cost estimates ---
  const pricing: Record<string, { input: number; output: number }> = {
    'anthropic.claude-haiku': { input: 1.0, output: 5.0 },
    'anthropic.claude-sonnet': { input: 3.0, output: 15.0 },
    'amazon.nova-pro': { input: 0.8, output: 3.2 },
    'amazon.nova-lite': { input: 0.06, output: 0.24 },
  };

  md += `\n## Sample Cost (on-demand)\n\n`;
  md += `| Model | Input Cost | Output Cost | Sample Total |\n`;
  md += `|---|---|---|---|\n`;

  for (const s of stats) {
    const priceKey: string | undefined = Object.keys(pricing).find((k) =>
      s.model.includes(k),
    );
    if (priceKey != null) {
      const p = pricing[priceKey]!;
      const inputCost: number = (s.totalInputTokens / 1_000_000) * p.input;
      const outputCost: number = (s.totalOutputTokens / 1_000_000) * p.output;
      md += `| ${s.model} | $${inputCost.toFixed(4)} | $${outputCost.toFixed(4)} | $${(inputCost + outputCost).toFixed(4)} |\n`;
    }
  }

  // --- Full workload projections ---
  md += `\n## Projected Full Workload (${String(TOTAL_DOCS_WITH_TEXT)} docs)\n\n`;
  md += `| Model | Est. Input Tokens | Est. Output Tokens | Est. Cost (on-demand) | Est. Cost (batch 50% off) | Est. Wall Time (serial) | Est. Wall Time (10x concurrency) |\n`;
  md += `|---|---|---|---|---|---|---|\n`;

  for (const s of stats) {
    const scale: number = TOTAL_DOCS_WITH_TEXT / s.count;
    const projInput: number = Math.round(s.totalInputTokens * scale);
    const projOutput: number = Math.round(s.totalOutputTokens * scale);
    const projLatencyMs: number = Math.round(s.totalLatencyMs * scale);

    const priceKey: string | undefined = Object.keys(pricing).find((k) =>
      s.model.includes(k),
    );
    let costStr: string = 'N/A';
    let batchCostStr: string = 'N/A';
    if (priceKey != null) {
      const p = pricing[priceKey]!;
      const cost: number =
        (projInput / 1_000_000) * p.input + (projOutput / 1_000_000) * p.output;
      costStr = `$${cost.toFixed(2)}`;
      batchCostStr = `$${(cost * 0.5).toFixed(2)}`;
    }

    const serialHours: number = projLatencyMs / 3_600_000;
    const concurrentHours: number = serialHours / 10;

    md += `| ${s.model} | ${String(projInput)} | ${String(projOutput)} | ${costStr} | ${batchCostStr} | ${serialHours.toFixed(1)} hrs | ${concurrentHours.toFixed(1)} hrs |\n`;
  }

  // --- Per-document timing data (JSON for further analysis) ---
  const timingData: Array<{
    model: string;
    fileNumber: string;
    textLength: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }> = [];
  for (const [model, results] of allResults) {
    for (const r of results) {
      timingData.push({
        model,
        fileNumber: r.fileNumber,
        textLength: r.textLength,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        latencyMs: r.latencyMs,
      });
    }
  }
  await writeFile(
    join(outputDir, 'timings.json'),
    JSON.stringify(timingData, null, 2),
    'utf-8',
  );

  await writeFile(join(outputDir, 'stats.md'), md, 'utf-8');
}

// ---------------------------------------------------------------------------
// CLI command
// ---------------------------------------------------------------------------

export const sampleSummarizeCommand = defineCommand({
  meta: {
    name: 'sample-summarize',
    description:
      'Sample attachments and summarize with multiple Bedrock models for cost/quality comparison',
  },
  args: {
    database: databaseArg,
    region: {
      type: 'string',
      description: 'AWS region for Bedrock',
      default: 'us-east-2',
    },
    models: {
      type: 'string',
      description: 'Comma-separated model IDs to test',
      default: DEFAULT_MODELS.join(','),
    },
    sample: {
      type: 'string',
      description: 'Number of attachments to sample',
      default: '50',
    },
    output: {
      type: 'string',
      description: 'Output directory for results',
      default: 'data/summarization-samples',
    },
  },
  async run({ args }) {
    const sampleSize: number = parseInt(args.sample, 10);
    const modelIds: string[] = (args.models as string)
      .split(',')
      .map((s: string) => s.trim());
    const outputDir: string = args.output;
    const region: string = args.region;

    // Bootstrap: minimal config shim so InferenceService can resolve modelId
    const shim = new StandaloneConfig(region, modelIds[0]!);
    setConfigService(shim as never);

    // Open DB and sample
    const dbInstance = await createDb(args.database);
    const conn: DuckDBConnection = await DuckDBConnection.create(dbInstance);

    await ensureInferenceLogTable(conn);
    const raw = new BedrockClient(region);
    const client = new InstrumentedBedrockClient(raw, conn, 'sample_summarize');
    const service = new InferenceService(client);

    try {
      console.log(`Sampling ${String(sampleSize)} attachments...`);
      const samples: AttachmentMeta[] = await sampleAttachments(
        conn,
        sampleSize,
      );
      console.log(`Got ${String(samples.length)} attachments`);

      if (samples.length === 0) {
        console.log('No attachments matched the sampling criteria.');
        return;
      }

      // Print sample overview
      const totalChars: number = samples.reduce((s, a) => s + a.textLength, 0);
      console.log(
        `Total text: ${String(totalChars)} chars (~${String(Math.round(totalChars / 4))} tokens)`,
      );
      console.log(`Models: ${modelIds.join(', ')}`);
      console.log(`Output: ${outputDir}\n`);

      await mkdir(outputDir, { recursive: true });

      // Run summarization for each model
      const allResults: Map<string, SummaryResult[]> = new Map();

      for (const modelId of modelIds) {
        const modelLabel: string = modelId
          .replace(/^us\./, '')
          .replace(/[.:]/g, '-');
        console.log(`\n--- Model: ${modelId} ---`);
        const results: SummaryResult[] = [];

        for (let i = 0; i < samples.length; i++) {
          const meta: AttachmentMeta = samples[i]!;
          const prefix: string = `[${String(i + 1)}/${String(samples.length)}]`;
          process.stdout.write(
            `${prefix} ${meta.fileNumber} (${String(meta.textLength)} chars)... `,
          );

          try {
            const result: SummaryResult = await summarizeOne(
              service,
              modelId,
              meta,
            );
            results.push(result);
            await writeResult(outputDir, meta, modelLabel, result);
            console.log(
              `${String(result.outputTokens)} tokens, ${String(result.latencyMs)} ms`,
            );
          } catch (err: unknown) {
            const msg: string =
              err instanceof Error ? err.message : String(err);
            console.log(`ERROR: ${msg}`);
          }
        }

        allResults.set(modelId, results);
      }

      // Write aggregate stats
      await writeStats(outputDir, allResults);
      console.log(`\nDone. Stats written to ${join(outputDir, 'stats.md')}`);
    } finally {
      conn.closeSync();
      dbInstance.closeSync();
    }
  },
});
