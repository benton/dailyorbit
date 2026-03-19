import type { ColumnDef } from '@tanstack/react-table';
import { Loader2, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { ToastProvider, useToast } from '../ui/toast.tsx';
import { PromptEditor } from './PromptEditor.tsx';

type ModelInfo = {
  modelId: string;
  modelName: string;
  provider: string;
};

type InferenceResponse = {
  content: string;
  latencyMs: number;
  modelId: string;
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
};

type ConfigEntry = {
  description: string;
  encrypted: boolean;
  key: string;
  value: string;
};

const modelColumns: Array<ColumnDef<ModelInfo, unknown>> = [
  { accessorKey: 'provider', header: 'Provider', size: 150 },
  { accessorKey: 'modelName', header: 'Name', size: 250 },
  {
    accessorKey: 'modelId',
    cell: ({ getValue }) => <span className="font-mono text-sm">{getValue() as string}</span>,
    header: 'Model ID',
    size: 400,
  },
];

const SUMMARIZATION_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'us.amazon.nova-pro-v1:0', label: 'Amazon Nova Pro' },
  { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Claude Haiku 4.5' },
  { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5' },
];

type TemplateVariable = {
  description: string;
  example: string;
  name: string;
  source: string;
};

type PromptTemplateMeta = {
  defaultSystemPrompt: string;
  defaultUserPrompt: string;
  variables: Array<TemplateVariable>;
};

function AiSettingsInner() {
  const [models, setModels] = useState<Array<ModelInfo>>([]);
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [summarizationModel, setSummarizationModel] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  const [testPrompt, setTestPrompt] = useState<string>('Say hello in one sentence.');
  const [testResult, setTestResult] = useState<InferenceResponse | null>(null);
  const [testing, setTesting] = useState<boolean>(false);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const { toast } = useToast();

  // Prompt template state
  const [summSystemPrompt, setSummSystemPrompt] = useState<string>('');
  const [summUserPrompt, setSummUserPrompt] = useState<string>('');
  const [summMeta, setSummMeta] = useState<PromptTemplateMeta | null>(null);

  // News summarization state
  const [newsSummModel, setNewsSummModel] = useState<string>('');
  const [newsSummSystemPrompt, setNewsSummSystemPrompt] = useState<string>('');
  const [newsSummUserPrompt, setNewsSummUserPrompt] = useState<string>('');
  const [newsSummMeta, setNewsSummMeta] = useState<PromptTemplateMeta | null>(null);

  // Embedding config state
  const [embeddingModel, setEmbeddingModel] = useState<string>('');
  const [embeddingDimensions, setEmbeddingDimensions] = useState<string>('1024');
  const [embeddingNormalize, setEmbeddingNormalize] = useState<boolean>(true);

  const fetchConfig = useCallback(async () => {
    try {
      const [entries, templates] = await Promise.all([
        apiFetch<Array<ConfigEntry>>('/api/admin/config'),
        apiFetch<{
          newsSummarization: PromptTemplateMeta;
          summarization: PromptTemplateMeta;
        }>('/api/admin/inference/prompt-templates'),
      ]);
      const regionEntry = entries.find((e) => e.key === 'bedrockRegion');
      const modelEntry = entries.find((e) => e.key === 'bedrockDefaultModel');
      const summModelEntry = entries.find((e) => e.key === 'summarizationModel');
      const summSysEntry = entries.find((e) => e.key === 'summarizationSystemPrompt');
      const summUserEntry = entries.find((e) => e.key === 'summarizationUserPrompt');
      if (regionEntry) {
        setRegion(regionEntry.value);
      }
      if (modelEntry) {
        setDefaultModel(modelEntry.value);
      }
      if (summModelEntry) {
        setSummarizationModel(summModelEntry.value);
      }
      if (summSysEntry) {
        setSummSystemPrompt(summSysEntry.value);
      }
      if (summUserEntry) {
        setSummUserPrompt(summUserEntry.value);
      }
      setSummMeta(templates.summarization);

      // News summarization
      const newsSummModelEntry = entries.find((e) => e.key === 'newsSummarizationModel');
      const newsSummSysEntry = entries.find((e) => e.key === 'newsSummarizationSystemPrompt');
      const newsSummUserEntry = entries.find((e) => e.key === 'newsSummarizationUserPrompt');
      if (newsSummModelEntry) {
        setNewsSummModel(newsSummModelEntry.value);
      }
      if (newsSummSysEntry) {
        setNewsSummSystemPrompt(newsSummSysEntry.value);
      }
      if (newsSummUserEntry) {
        setNewsSummUserPrompt(newsSummUserEntry.value);
      }
      setNewsSummMeta(templates.newsSummarization);

      // Embedding config
      const embModelEntry = entries.find((e) => e.key === 'embeddingModel');
      const embDimEntry = entries.find((e) => e.key === 'embeddingDimensions');
      const embNormEntry = entries.find((e) => e.key === 'embeddingNormalize');
      if (embModelEntry) {
        setEmbeddingModel(embModelEntry.value);
      }
      if (embDimEntry) {
        setEmbeddingDimensions(embDimEntry.value);
      }
      if (embNormEntry) {
        setEmbeddingNormalize(embNormEntry.value === 'true');
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to load config', 'error');
    }
  }, [toast]);

  /** Fetch models from API, cache for dropdown, and return as PaginatedResponse for DataTable. */
  const fetchModelsPage = useCallback(
    async (params: DataTableFetchParams): Promise<PaginatedResponse<ModelInfo>> => {
      const data: Array<ModelInfo> = await apiFetch('/api/admin/inference/models');
      setModels(data);

      // Client-side sort since the API returns all models in one page
      const { order, sort } = params;
      if (sort != null) {
        const key = sort as keyof ModelInfo;
        const dir: number = order === 'desc' ? -1 : 1;
        data.sort((a, b) => a[key].localeCompare(b[key]) * dir);
      }

      return {
        data,
        page: 1,
        pageSize: data.length,
        totalPages: 1,
        totalRows: data.length,
      };
    },
    [],
  );

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    try {
      const saveKey = (key: string, value: string): Promise<unknown> =>
        apiFetch(`/api/admin/config/${key}`, {
          body: JSON.stringify({ value }),
          method: 'PUT',
        });
      await Promise.all([
        saveKey('bedrockRegion', region),
        saveKey('bedrockDefaultModel', defaultModel),
        saveKey('summarizationModel', summarizationModel),
        saveKey('summarizationSystemPrompt', summSystemPrompt),
        saveKey('summarizationUserPrompt', summUserPrompt),
        saveKey('newsSummarizationModel', newsSummModel),
        saveKey('newsSummarizationSystemPrompt', newsSummSystemPrompt),
        saveKey('newsSummarizationUserPrompt', newsSummUserPrompt),
        saveKey('embeddingModel', embeddingModel),
        saveKey('embeddingDimensions', embeddingDimensions),
        saveKey('embeddingNormalize', String(embeddingNormalize)),
      ]);
      toast('AI settings saved', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to save', 'error');
    } finally {
      setSavingConfig(false);
    }
  }, [
    region,
    defaultModel,
    summarizationModel,
    summSystemPrompt,
    summUserPrompt,
    newsSummModel,
    newsSummSystemPrompt,
    newsSummUserPrompt,
    embeddingModel,
    embeddingDimensions,
    embeddingNormalize,
    toast,
  ]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const resp: InferenceResponse = await apiFetch('/api/admin/inference/test', {
        body: JSON.stringify({
          messages: [{ content: testPrompt, role: 'user' }],
          modelId: defaultModel || undefined,
          params: { maxTokens: 256, temperature: 0.7 },
        }),
        method: 'POST',
      });
      setTestResult(resp);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Inference failed', 'error');
    } finally {
      setTesting(false);
    }
  }, [defaultModel, testPrompt, toast]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          AI Settings
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Configure language model inference via AWS Bedrock.
        </p>
      </div>

      {/* Config Section */}
      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-lg font-medium">Bedrock Configuration</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="bedrock-region">AWS Region</Label>
            <Input id="bedrock-region" onChange={(e) => setRegion(e.target.value)} value={region} />
          </div>
          <div>
            <Label htmlFor="bedrock-model">Default Model ID</Label>
            <select
              className="flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              id="bedrock-model"
              onChange={(e) => setDefaultModel(e.target.value)}
              value={defaultModel}
            >
              {models.length === 0 && defaultModel && (
                <option value={defaultModel}>{defaultModel}</option>
              )}
              {models.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.provider} — {m.modelName} ({m.modelId})
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button className="mt-4" disabled={savingConfig} onClick={() => void handleSaveConfig()}>
          {savingConfig ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>

      {/* Summarization Model */}
      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-lg font-medium">Summarization Model</h2>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          Model used for batch attachment summarization in the ingestion pipeline.
        </p>
        <div className="space-y-3">
          {SUMMARIZATION_MODELS.map((m) => (
            <label
              className="flex cursor-pointer items-center gap-3 rounded-md border border-neutral-200 px-4 py-3 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              key={m.id}
              style={
                summarizationModel === m.id
                  ? {
                      backgroundColor: 'var(--color-blue-50)',
                      borderColor: 'var(--color-blue-500)',
                    }
                  : undefined
              }
            >
              <input
                checked={summarizationModel === m.id}
                className="h-4 w-4 accent-blue-600"
                name="summarization-model"
                onChange={() => setSummarizationModel(m.id)}
                type="radio"
                value={m.id}
              />
              <div>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="font-mono text-xs text-neutral-500">{m.id}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Prompt Templates */}
      {summMeta != null && (
        <PromptEditor
          defaultSystemPrompt={summMeta.defaultSystemPrompt}
          defaultUserPrompt={summMeta.defaultUserPrompt}
          description="Templates used when summarizing attachment text in the ingestion pipeline."
          onSystemPromptChange={setSummSystemPrompt}
          onUserPromptChange={setSummUserPrompt}
          systemPrompt={summSystemPrompt}
          title="Summarization Prompts"
          userPrompt={summUserPrompt}
          variables={summMeta.variables}
        />
      )}

      {/* News Summarization Model */}
      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-lg font-medium">News Summarization Model</h2>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          Model used for summarizing news articles in the ingestion pipeline.
        </p>
        <div className="space-y-3">
          {SUMMARIZATION_MODELS.map((m) => (
            <label
              className="flex cursor-pointer items-center gap-3 rounded-md border border-neutral-200 px-4 py-3 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              key={m.id}
              style={
                newsSummModel === m.id
                  ? {
                      backgroundColor: 'var(--color-blue-50)',
                      borderColor: 'var(--color-blue-500)',
                    }
                  : undefined
              }
            >
              <input
                checked={newsSummModel === m.id}
                className="h-4 w-4 accent-blue-600"
                name="news-summarization-model"
                onChange={() => setNewsSummModel(m.id)}
                type="radio"
                value={m.id}
              />
              <div>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="font-mono text-xs text-neutral-500">{m.id}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* News Summarization Prompts */}
      {newsSummMeta != null && (
        <PromptEditor
          defaultSystemPrompt={newsSummMeta.defaultSystemPrompt}
          defaultUserPrompt={newsSummMeta.defaultUserPrompt}
          description="Templates used when summarizing news articles in the ingestion pipeline."
          onSystemPromptChange={setNewsSummSystemPrompt}
          onUserPromptChange={setNewsSummUserPrompt}
          systemPrompt={newsSummSystemPrompt}
          title="News Summarization Prompts"
          userPrompt={newsSummUserPrompt}
          variables={newsSummMeta.variables}
        />
      )}

      {/* Embedding Configuration */}
      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-lg font-medium">Embedding Configuration</h2>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          Settings for vector embeddings used in semantic search.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="embedding-model">Embedding Model</Label>
            <Input
              id="embedding-model"
              onChange={(e) => setEmbeddingModel(e.target.value)}
              placeholder="e.g. amazon.titan-embed-text-v2:0"
              value={embeddingModel}
            />
          </div>
          <div>
            <Label htmlFor="embedding-dimensions">Dimensions</Label>
            <select
              className="flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              id="embedding-dimensions"
              onChange={(e) => setEmbeddingDimensions(e.target.value)}
              value={embeddingDimensions}
            >
              <option value="256">256</option>
              <option value="512">512</option>
              <option value="1024">1024</option>
            </select>
          </div>
          <div className="flex items-end gap-2 pb-1">
            <input
              checked={embeddingNormalize}
              className="h-4 w-4 accent-blue-600"
              id="embedding-normalize"
              onChange={(e) => setEmbeddingNormalize(e.target.checked)}
              type="checkbox"
            />
            <Label htmlFor="embedding-normalize">Normalize vectors</Label>
          </div>
        </div>
      </div>

      {/* Test Section */}
      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-lg font-medium">Test Inference</h2>
        <div className="flex gap-2">
          <Input
            className="flex-1"
            onChange={(e) => setTestPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void handleTest();
              }
            }}
            placeholder="Enter a test prompt..."
            value={testPrompt}
          />
          <Button disabled={testing || !testPrompt} onClick={() => void handleTest()}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {testResult && (
          <div className="mt-4 space-y-2">
            <div className="rounded bg-neutral-50 p-4 text-sm dark:bg-neutral-800">
              {testResult.content}
            </div>
            <div className="flex gap-3 text-xs text-neutral-500">
              <Badge variant="secondary">{testResult.modelId}</Badge>
              <span>{testResult.usage.totalTokens} tokens</span>
              <span>{testResult.latencyMs}ms</span>
              <span>{testResult.stopReason}</span>
            </div>
          </div>
        )}
      </div>

      {/* Available Models */}
      <div>
        <h2 className="mb-2 text-lg font-medium">Available Models</h2>
        <p className="mb-4 text-sm text-neutral-500">
          On-demand text models in {region || 'configured region'}.
        </p>
        <DataTable<ModelInfo>
          columns={modelColumns}
          defaultOrder="asc"
          defaultPageSize={25}
          defaultSort="provider"
          fetchData={fetchModelsPage}
          paramPrefix="m_"
        />
      </div>
    </div>
  );
}

export default function AiSettings() {
  return (
    <ToastProvider>
      <AiSettingsInner />
    </ToastProvider>
  );
}
