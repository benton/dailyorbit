import type { ConverseStreamCommandInput } from '@aws-sdk/client-bedrock-runtime';
import type { BedrockClient } from '../inference/bedrock-client.ts';
import type { QuerySSEEvent, RetrievedSource } from './types.ts';

const GENERATE_SYSTEM_PROMPT: string = `You are an FCC filing analyst. Answer the user's question using ONLY the provided sources. Cite sources using [brackets] with the source ID. If the sources don't contain enough information, say so. Never invent facts or sources.`;

/** Format sources into a context block for the generation prompt. */
function buildContextBlock(sources: RetrievedSource[]): string {
  return sources
    .map(
      (s: RetrievedSource, i: number) =>
        `[Source ${i + 1}: ${s.type} — ${s.id}]\nTitle: ${s.title}\n${s.snippet}`,
    )
    .join('\n\n');
}

/**
 * Generate a streamed answer from retrieved sources.
 * Yields delta and usage QuerySSEEvents.
 */
export async function* generateAnswer(
  question: string,
  sources: RetrievedSource[],
  client: BedrockClient,
  modelId: string,
): AsyncGenerator<QuerySSEEvent> {
  const contextBlock: string = buildContextBlock(sources);
  const userMessage: string = `Context:\n${contextBlock}\n\nQuestion: ${question}`;

  const input: ConverseStreamCommandInput = {
    modelId,
    system: [{ text: GENERATE_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: userMessage }] }],
    inferenceConfig: { maxTokens: 4096, temperature: 0.2 },
  };

  let inputTokens: number = 0;
  let outputTokens: number = 0;

  for await (const event of client.converseStream(input)) {
    // Text deltas
    if (event.contentBlockDelta != null) {
      const delta = event.contentBlockDelta.delta;
      if (delta != null && 'text' in delta && delta.text != null) {
        yield { type: 'delta', text: delta.text };
      }
    }

    // Token usage from metadata event
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

/** Return type for the generator — token counts collected during streaming. */
export type GenerateUsage = {
  inputTokens: number;
  outputTokens: number;
};
