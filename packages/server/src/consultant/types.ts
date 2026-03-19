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
