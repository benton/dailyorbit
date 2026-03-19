import type { BedrockClient } from '../inference/bedrock-client.ts';

const TITLE_SYSTEM_PROMPT: string =
  'Generate a short, descriptive title (5-10 words) for this conversation. Respond with only the title, no quotes or punctuation.';

export function buildTitlePrompt(question: string, answer: string): string {
  return `User asked: ${question}\n\nAssistant answered: ${answer.slice(0, 500)}`;
}

export function parseTitleResponse(raw: string): string {
  let title: string = raw.trim();
  // Strip surrounding quotes
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
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
