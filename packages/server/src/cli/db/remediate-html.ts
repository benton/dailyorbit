import { defineCommand } from 'citty';
import { DuckDBConnection } from '@duckdb/node-api';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';
import { trackConnection } from '../../lib/graceful-shutdown.ts';
import { htmlToMarkdown, containsHtml } from '../../lib/html-to-markdown.ts';
import { getLogger } from '../../lib/logger.ts';

type RemediationSummary = {
  pleadingsConverted: number;
  filingsConverted: number;
  attachmentsConverted: number;
  embeddingsDeleted: number;
};

const BATCH_SIZE: number = 500;

export const remediateHtmlCommand = defineCommand({
  meta: {
    name: 'remediate-html',
    description:
      'Convert embedded HTML strings to Markdown in pleadings, filings, and attachments; delete stale embeddings',
  },
  args: {
    database: databaseArg,
    'dry-run': {
      type: 'boolean',
      description: 'Count affected rows without modifying the database',
      default: false,
    },
  },
  async run({ args }) {
    const dryRun: boolean = args['dry-run'];
    const db = await createDb(args.database);
    const conn: DuckDBConnection = await DuckDBConnection.create(db);
    trackConnection(conn);

    const summary: RemediationSummary = {
      pleadingsConverted: 0,
      filingsConverted: 0,
      attachmentsConverted: 0,
      embeddingsDeleted: 0,
    };

    // ---------------------------------------------------------------
    // 1. Pleadings — HTML in exhibit_attachment_html
    // ---------------------------------------------------------------
    const log = getLogger();
    log.info('Scanning pleadings for HTML content...');
    const pleadingReader = await conn.runAndReadAll(
      `SELECT pleading_key, exhibit_attachment_html
       FROM pleading
       WHERE exhibit_attachment_html LIKE '%<a %'
          OR exhibit_attachment_html LIKE '%</%'`,
    );
    const pleadingRows: Record<string, unknown>[] =
      pleadingReader.getRowObjectsJS();
    log.info(`  Found ${String(pleadingRows.length)} pleadings with HTML`);

    if (!dryRun && pleadingRows.length > 0) {
      const pleadingKeys: string[] = [];

      for (let i = 0; i < pleadingRows.length; i += BATCH_SIZE) {
        const batch = pleadingRows.slice(i, i + BATCH_SIZE);

        for (const row of batch) {
          const key: string = String(row['pleading_key']);
          const html: string = String(row['exhibit_attachment_html']);
          const markdown: string = htmlToMarkdown(html);

          if (markdown !== html) {
            await conn.run(
              `UPDATE pleading SET exhibit_attachment_html = ? WHERE pleading_key = ?`,
              [markdown, Number(key)],
            );
            summary.pleadingsConverted++;
            pleadingKeys.push(key);
          }
        }

        const progress: number = Math.min(i + BATCH_SIZE, pleadingRows.length);
        process.stdout.write(
          `\r  Converted ${String(progress)}/${String(pleadingRows.length)} pleadings`,
        );
      }
      log.info('');

      // Delete stale embeddings for converted pleadings
      if (pleadingKeys.length > 0) {
        const placeholders: string = pleadingKeys.map(() => '?').join(', ');
        const deleteResult = await conn.runAndReadAll(
          `DELETE FROM embedding
           WHERE source_table = 'pleading'
             AND source_key IN (${placeholders})
           RETURNING source_key`,
          pleadingKeys,
        );
        const deleted: number = deleteResult.getRowObjectsJS().length;
        summary.embeddingsDeleted += deleted;
        log.info(`  Deleted ${String(deleted)} stale pleading embeddings`);
      }
    } else if (dryRun) {
      summary.pleadingsConverted = pleadingRows.length;
    }

    // ---------------------------------------------------------------
    // 2. Filing descriptions — HTML in description
    // ---------------------------------------------------------------
    log.info('Scanning filing descriptions for HTML content...');
    const filingReader = await conn.runAndReadAll(
      `SELECT filing_key, file_number, description
       FROM filing
       WHERE description LIKE '%<%>%'`,
    );
    const filingRows: Record<string, unknown>[] =
      filingReader.getRowObjectsJS();
    log.info(`  Found ${String(filingRows.length)} filings with HTML`);

    if (!dryRun && filingRows.length > 0) {
      const filingFileNumbers: string[] = [];

      for (const row of filingRows) {
        const key: number = Number(row['filing_key']);
        const fileNumber: string = String(row['file_number']);
        const description: string = String(row['description']);

        if (!containsHtml(description)) continue;

        const markdown: string = htmlToMarkdown(description);
        if (markdown !== description) {
          await conn.run(
            `UPDATE filing SET description = ? WHERE filing_key = ?`,
            [markdown, key],
          );
          summary.filingsConverted++;
          filingFileNumbers.push(fileNumber);
        }
      }

      // Delete stale embeddings for converted filings
      if (filingFileNumbers.length > 0) {
        const placeholders: string = filingFileNumbers
          .map(() => '?')
          .join(', ');
        const deleteResult = await conn.runAndReadAll(
          `DELETE FROM embedding
           WHERE source_table = 'filing'
             AND source_key IN (${placeholders})
           RETURNING source_key`,
          filingFileNumbers,
        );
        const deleted: number = deleteResult.getRowObjectsJS().length;
        summary.embeddingsDeleted += deleted;
        log.info(`  Deleted ${String(deleted)} stale filing embeddings`);
      }
    } else if (dryRun) {
      summary.filingsConverted = filingRows.filter((r) =>
        containsHtml(String(r['description'])),
      ).length;
    }

    // ---------------------------------------------------------------
    // 3. Attachment summaries — HTML in summary
    // ---------------------------------------------------------------
    log.info('Scanning attachment summaries for HTML content...');
    const attachmentReader = await conn.runAndReadAll(
      `SELECT attachment_key, summary
       FROM attachment
       WHERE summary LIKE '%<%'`,
    );
    const attachmentRows: Record<string, unknown>[] =
      attachmentReader.getRowObjectsJS();
    log.info(
      `  Found ${String(attachmentRows.length)} attachments with HTML in summary`,
    );

    if (!dryRun && attachmentRows.length > 0) {
      const attachmentKeys: string[] = [];

      for (const row of attachmentRows) {
        const key: string = String(row['attachment_key']);
        const summaryText: string = String(row['summary']);

        if (!containsHtml(summaryText)) continue;

        const markdown: string = htmlToMarkdown(summaryText);
        if (markdown !== summaryText) {
          await conn.run(
            `UPDATE attachment SET summary = ? WHERE attachment_key = ?`,
            [markdown, Number(key)],
          );
          summary.attachmentsConverted++;
          attachmentKeys.push(key);
        }
      }

      // Delete stale embeddings for converted attachments
      if (attachmentKeys.length > 0) {
        const placeholders: string = attachmentKeys.map(() => '?').join(', ');
        const deleteResult = await conn.runAndReadAll(
          `DELETE FROM embedding
           WHERE source_table = 'attachment'
             AND source_key IN (${placeholders})
           RETURNING source_key`,
          attachmentKeys,
        );
        const deleted: number = deleteResult.getRowObjectsJS().length;
        summary.embeddingsDeleted += deleted;
        log.info(`  Deleted ${String(deleted)} stale attachment embeddings`);
      }
    } else if (dryRun) {
      summary.attachmentsConverted = attachmentRows.filter((r) =>
        containsHtml(String(r['summary'])),
      ).length;
    }

    // ---------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------
    log.info('');
    log.info(dryRun ? '=== DRY RUN ===' : '=== Remediation Complete ===');
    log.info(`  Pleadings converted:    ${String(summary.pleadingsConverted)}`);
    log.info(`  Filings converted:      ${String(summary.filingsConverted)}`);
    log.info(
      `  Attachments converted:  ${String(summary.attachmentsConverted)}`,
    );
    if (!dryRun) {
      log.info(
        `  Embeddings deleted:     ${String(summary.embeddingsDeleted)}`,
      );
      log.info('');
      log.info('Run `daily-orbit inference embed` to re-embed affected rows.');
    }
  },
});
