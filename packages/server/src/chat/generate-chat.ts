import type {
  ConverseStreamCommandInput,
  Message as BedrockMessage,
} from '@aws-sdk/client-bedrock-runtime';
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
  const template: string = userPromptTemplate ?? DEFAULT_GENERATE_USER_PROMPT;
  const userMessage: string = renderPrompt(template, {
    context: contextBlock,
    question,
  });
  bedrockMessages.push({
    role: 'user',
    content: [{ text: userMessage }],
  });

  // Model + inference config
  const modelId: string = consultant.modelId ?? fallbackModelId;
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
