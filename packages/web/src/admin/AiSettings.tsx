import type { ColumnDef } from '@tanstack/react-table';
import { ChevronDown, ChevronRight, Loader2, RotateCcw, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { ToastProvider, useToast } from '../ui/toast.tsx';

// ── Types ──────────────────────────────────────────────────────────

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

type TemplateVariable = {
  description: string;
  example: string;
  name: string;
  source: string;
};

type PromptSetDef = {
  category: string;
  defaultSystemPrompt: string;
  defaultUserPrompt: string;
  displayName: string;
  slug: string;
  systemPromptKey: string;
  userPromptKey: string;
  variables: Array<TemplateVariable>;
};

// ── Constants ──────────────────────────────────────────────────────

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

const CATEGORY_LABELS: Record<string, string> = {
  newspaper: 'Newspaper',
  pipeline: 'Pipeline',
  query: 'Search & Query',
};

// ── Unified Prompt Editor ──────────────────────────────────────────

type UnifiedPromptEditorProps = {
  configEntries: Array<ConfigEntry>;
  onSave: (key: string, value: string) => Promise<void>;
  promptSets: Array<PromptSetDef>;
};

function UnifiedPromptEditor({ configEntries, onSave, promptSets }: UnifiedPromptEditorProps) {
  const [searchParams] = useSearchParams();
  const initialSlug: string = searchParams.get('prompt') ?? promptSets[0]?.slug ?? '';
  const [selectedSlug, setSelectedSlug] = useState<string>(initialSlug);
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [userPrompt, setUserPrompt] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [varsOpen, setVarsOpen] = useState<boolean>(false);
  const { toast } = useToast();

  const selected: PromptSetDef | undefined = useMemo(
    () => promptSets.find((p: PromptSetDef) => p.slug === selectedSlug),
    [promptSets, selectedSlug],
  );

  // Group prompt sets by category for the dropdown
  const grouped: Array<{ category: string; label: string; sets: Array<PromptSetDef> }> =
    useMemo(() => {
      const categories: Array<string> = [
        ...new Set(promptSets.map((p: PromptSetDef) => p.category)),
      ];
      return categories.map((cat: string) => ({
        category: cat,
        label: CATEGORY_LABELS[cat] ?? cat,
        sets: promptSets.filter((p: PromptSetDef) => p.category === cat),
      }));
    }, [promptSets]);

  // Load current config values when selection changes
  useEffect(() => {
    if (selected == null) {
      return;
    }
    const sysEntry: ConfigEntry | undefined = configEntries.find(
      (e: ConfigEntry) => e.key === selected.systemPromptKey,
    );
    const userEntry: ConfigEntry | undefined = configEntries.find(
      (e: ConfigEntry) => e.key === selected.userPromptKey,
    );
    setSystemPrompt(sysEntry?.value ?? '');
    setUserPrompt(userEntry?.value ?? '');
    setVarsOpen(false);
  }, [selected, configEntries]);

  // Deep-link: update selection when ?prompt= query param changes
  useEffect(() => {
    const paramSlug: string | null = searchParams.get('prompt');
    if (paramSlug != null && promptSets.some((p: PromptSetDef) => p.slug === paramSlug)) {
      setSelectedSlug(paramSlug);
    }
  }, [searchParams, promptSets]);

  const isSystemDefault: boolean =
    selected != null && (systemPrompt === selected.defaultSystemPrompt || systemPrompt === '');
  const isUserDefault: boolean =
    selected != null && (userPrompt === selected.defaultUserPrompt || userPrompt === '');

  const handleSave = useCallback(async () => {
    if (selected == null) {
      return;
    }
    setSaving(true);
    try {
      const saves: Array<Promise<void>> = [];
      if (selected.systemPromptKey) {
        saves.push(onSave(selected.systemPromptKey, systemPrompt));
      }
      if (selected.userPromptKey) {
        saves.push(onSave(selected.userPromptKey, userPrompt));
      }
      await Promise.all(saves);
      toast(`Saved prompts for "${selected.displayName}"`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }, [selected, systemPrompt, userPrompt, onSave, toast]);

  if (selected == null) {
    return null;
  }

  return (
    <div className="rounded-theme border border-border-theme bg-surface-card">
      {/* Header with dropdown */}
      <div className="border-b border-border-theme px-6 py-4 dark:border-border-theme">
        <h2 className="mb-3 text-lg font-medium">Prompt Templates</h2>
        <p className="mb-3 text-sm text-on-surface-muted">
          Select an inference action to view and customize its prompts. Blank fields use the
          built-in default.
        </p>
        <select
          className="flex h-10 w-full rounded-theme border border-border-theme bg-surface-card px-3 py-2 text-sm text-on-surface"
          onChange={(e) => setSelectedSlug(e.target.value)}
          value={selectedSlug}
        >
          {grouped.map((group) => (
            <optgroup key={group.category} label={group.label}>
              {group.sets.map((ps: PromptSetDef) => (
                <option key={ps.slug} value={ps.slug}>
                  {ps.displayName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {(!isSystemDefault || !isUserDefault) && (
          <Badge className="mt-2" variant="secondary">
            customized
          </Badge>
        )}
      </div>

      {/* Prompt text areas */}
      <div className="space-y-6 px-6 pt-4 pb-6">
        {/* System Prompt */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label htmlFor="unified-system">System Prompt</Label>
            {!isSystemDefault && (
              <button
                className="flex items-center gap-1 text-xs text-on-surface-muted hover:text-on-surface"
                onClick={() => setSystemPrompt(selected.defaultSystemPrompt)}
                title="Reset to default"
                type="button"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>
          <textarea
            className="w-full rounded-theme border border-border-theme bg-white px-3 py-2 font-mono text-sm leading-relaxed dark:border-border-theme dark:bg-surface dark:text-on-surface"
            id="unified-system"
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={selected.defaultSystemPrompt}
            rows={8}
            value={systemPrompt}
          />
          {systemPrompt === '' && (
            <p className="mt-1 text-xs text-on-surface-muted">Blank = built-in default is used</p>
          )}
        </div>

        {/* User Prompt */}
        {selected.userPromptKey && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label htmlFor="unified-user">User Prompt Template</Label>
              {!isUserDefault && (
                <button
                  className="flex items-center gap-1 text-xs text-on-surface-muted hover:text-on-surface"
                  onClick={() => setUserPrompt(selected.defaultUserPrompt)}
                  title="Reset to default"
                  type="button"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </button>
              )}
            </div>
            <textarea
              className="w-full rounded-theme border border-border-theme bg-white px-3 py-2 font-mono text-sm leading-relaxed dark:border-border-theme dark:bg-surface dark:text-on-surface"
              id="unified-user"
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder={selected.defaultUserPrompt}
              rows={12}
              value={userPrompt}
            />
            {userPrompt === '' && (
              <p className="mt-1 text-xs text-on-surface-muted">Blank = built-in default is used</p>
            )}
          </div>
        )}

        {/* Variable Reference */}
        {selected.variables.length > 0 && (
          <div>
            <button
              className="flex items-center gap-2 text-sm font-medium text-on-surface-muted hover:text-on-surface"
              onClick={() => setVarsOpen(!varsOpen)}
              type="button"
            >
              {varsOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Available Variables
              <Badge variant="secondary">{selected.variables.length}</Badge>
            </button>

            {varsOpen && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-theme text-left text-xs font-medium tracking-wider text-on-surface-muted uppercase">
                      <th className="pr-4 pb-2">Variable</th>
                      <th className="pr-4 pb-2">Source</th>
                      <th className="pr-4 pb-2">Description</th>
                      <th className="pb-2">Example</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.variables.map((v: TemplateVariable) => (
                      <tr className="border-b border-border-theme" key={v.name}>
                        <td className="py-2 pr-4">
                          <code className="rounded bg-on-surface/10 px-1.5 py-0.5 font-mono text-xs">
                            {'{{' + v.name + '}}'}
                          </code>
                        </td>
                        <td className="py-2 pr-4 text-on-surface-muted">{v.source}</td>
                        <td className="py-2 pr-4">{v.description}</td>
                        <td className="py-2 font-mono text-xs text-on-surface-muted">
                          {v.example}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Save button */}
        <Button disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Saving...' : 'Save Prompts'}
        </Button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

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

  // News summarization model
  const [newsSummModel, setNewsSummModel] = useState<string>('');

  // Embedding config state
  const [embeddingModel, setEmbeddingModel] = useState<string>('');
  const [embeddingDimensions, setEmbeddingDimensions] = useState<string>('1024');
  const [embeddingNormalize, setEmbeddingNormalize] = useState<boolean>(true);

  // Newspaper model config
  const [newspaperCopyModel, setNewspaperCopyModel] = useState<string>('');
  const [newspaperImageModel, setNewspaperImageModel] = useState<string>('');

  // Prompt registry + config entries (for unified editor)
  const [promptSets, setPromptSets] = useState<Array<PromptSetDef>>([]);
  const [configEntries, setConfigEntries] = useState<Array<ConfigEntry>>([]);

  const fetchConfig = useCallback(async () => {
    try {
      const [entries, registry] = await Promise.all([
        apiFetch<Array<ConfigEntry>>('/api/admin/config'),
        apiFetch<Array<PromptSetDef>>('/api/admin/inference/prompt-templates'),
      ]);
      setConfigEntries(entries);
      setPromptSets(registry);

      const regionEntry: ConfigEntry | undefined = entries.find(
        (e: ConfigEntry) => e.key === 'bedrockRegion',
      );
      const modelEntry: ConfigEntry | undefined = entries.find(
        (e: ConfigEntry) => e.key === 'bedrockDefaultModel',
      );
      const summModelEntry: ConfigEntry | undefined = entries.find(
        (e: ConfigEntry) => e.key === 'summarizationModel',
      );
      const newsSummModelEntry: ConfigEntry | undefined = entries.find(
        (e: ConfigEntry) => e.key === 'newsSummarizationModel',
      );
      const newspaperCopyModelEntry: ConfigEntry | undefined = entries.find(
        (e: ConfigEntry) => e.key === 'newspaperCopyModel',
      );
      const newspaperImageModelEntry: ConfigEntry | undefined = entries.find(
        (e: ConfigEntry) => e.key === 'newspaperImageModel',
      );
      const embModelEntry: ConfigEntry | undefined = entries.find(
        (e: ConfigEntry) => e.key === 'embeddingModel',
      );
      const embDimEntry: ConfigEntry | undefined = entries.find(
        (e: ConfigEntry) => e.key === 'embeddingDimensions',
      );
      const embNormEntry: ConfigEntry | undefined = entries.find(
        (e: ConfigEntry) => e.key === 'embeddingNormalize',
      );

      if (regionEntry) {
        setRegion(regionEntry.value);
      }
      if (modelEntry) {
        setDefaultModel(modelEntry.value);
      }
      if (summModelEntry) {
        setSummarizationModel(summModelEntry.value);
      }
      if (newsSummModelEntry) {
        setNewsSummModel(newsSummModelEntry.value);
      }
      if (newspaperCopyModelEntry) {
        setNewspaperCopyModel(newspaperCopyModelEntry.value);
      }
      if (newspaperImageModelEntry) {
        setNewspaperImageModel(newspaperImageModelEntry.value);
      }
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

  const fetchModelsPage = useCallback(
    async (params: DataTableFetchParams): Promise<PaginatedResponse<ModelInfo>> => {
      const data: Array<ModelInfo> = await apiFetch('/api/admin/inference/models');
      setModels(data);

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

  /** Save a single config key, then refresh entries so the prompt editor stays in sync. */
  const saveConfigKey = useCallback(async (key: string, value: string): Promise<void> => {
    await apiFetch(`/api/admin/config/${key}`, {
      body: JSON.stringify({ value }),
      method: 'PUT',
    });
    // Update local config entries cache
    setConfigEntries((prev: Array<ConfigEntry>) => {
      const idx: number = prev.findIndex((e: ConfigEntry) => e.key === key);
      if (idx >= 0) {
        const updated: Array<ConfigEntry> = [...prev];
        updated[idx] = { ...updated[idx], value };
        return updated;
      }
      return [...prev, { description: '', encrypted: false, key, value }];
    });
  }, []);

  const handleSaveModels = useCallback(async () => {
    setSavingConfig(true);
    try {
      await Promise.all([
        saveConfigKey('bedrockRegion', region),
        saveConfigKey('bedrockDefaultModel', defaultModel),
        saveConfigKey('summarizationModel', summarizationModel),
        saveConfigKey('newsSummarizationModel', newsSummModel),
        saveConfigKey('newspaperCopyModel', newspaperCopyModel),
        saveConfigKey('newspaperImageModel', newspaperImageModel),
        saveConfigKey('embeddingModel', embeddingModel),
        saveConfigKey('embeddingDimensions', embeddingDimensions),
        saveConfigKey('embeddingNormalize', String(embeddingNormalize)),
      ]);
      toast('Model settings saved', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to save', 'error');
    } finally {
      setSavingConfig(false);
    }
  }, [
    region,
    defaultModel,
    summarizationModel,
    newsSummModel,
    newspaperCopyModel,
    newspaperImageModel,
    embeddingModel,
    embeddingDimensions,
    embeddingNormalize,
    saveConfigKey,
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
        <h1 className="text-2xl font-semibold text-on-surface">AI Settings</h1>
        <p className="mt-1 text-sm text-on-surface-muted">
          Configure language model inference via AWS Bedrock.
        </p>
      </div>

      {/* Bedrock Configuration */}
      <div className="rounded-theme border border-border-theme bg-surface-card p-6">
        <h2 className="mb-4 text-lg font-medium">Bedrock Configuration</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="bedrock-region">AWS Region</Label>
            <Input id="bedrock-region" onChange={(e) => setRegion(e.target.value)} value={region} />
          </div>
          <div>
            <Label htmlFor="bedrock-model">Default Model ID</Label>
            <select
              className="flex h-10 w-full rounded-theme border border-border-theme bg-surface-card px-3 py-2 text-sm text-on-surface"
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
      </div>

      {/* Model Selection */}
      <div className="rounded-theme border border-border-theme bg-surface-card p-6">
        <h2 className="mb-4 text-lg font-medium">Model Selection</h2>

        {/* Summarization Model */}
        <h3 className="mb-2 text-sm font-medium">Attachment Summarization</h3>
        <div className="mb-6 space-y-3">
          {SUMMARIZATION_MODELS.map((m) => (
            <label
              className="flex cursor-pointer items-center gap-3 rounded-theme border border-border-theme px-4 py-3 transition-colors hover:bg-on-surface/5"
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
                <div className="font-mono text-xs text-on-surface-muted">{m.id}</div>
              </div>
            </label>
          ))}
        </div>

        {/* News Summarization Model */}
        <h3 className="mb-2 text-sm font-medium">News Summarization</h3>
        <div className="mb-6 space-y-3">
          {SUMMARIZATION_MODELS.map((m) => (
            <label
              className="flex cursor-pointer items-center gap-3 rounded-theme border border-border-theme px-4 py-3 transition-colors hover:bg-on-surface/5"
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
                <div className="font-mono text-xs text-on-surface-muted">{m.id}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Newspaper Copy Model */}
        <h3 className="mb-2 text-sm font-medium">Newspaper Copy Generation</h3>
        <div className="mb-6 space-y-3">
          {SUMMARIZATION_MODELS.map((m) => (
            <label
              className="flex cursor-pointer items-center gap-3 rounded-theme border border-border-theme px-4 py-3 transition-colors hover:bg-on-surface/5"
              key={m.id}
              style={
                newspaperCopyModel === m.id
                  ? {
                      backgroundColor: 'var(--color-blue-50)',
                      borderColor: 'var(--color-blue-500)',
                    }
                  : undefined
              }
            >
              <input
                checked={newspaperCopyModel === m.id}
                className="h-4 w-4 accent-blue-600"
                name="newspaper-copy-model"
                onChange={() => setNewspaperCopyModel(m.id)}
                type="radio"
                value={m.id}
              />
              <div>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="font-mono text-xs text-on-surface-muted">{m.id}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Newspaper Image Model */}
        <h3 className="mb-2 text-sm font-medium">Newspaper Image Generation</h3>
        <div className="mb-6">
          <Input
            onChange={(e) => setNewspaperImageModel(e.target.value)}
            placeholder="e.g. amazon.nova-canvas-v1:0"
            value={newspaperImageModel}
          />
        </div>

        {/* Embedding Configuration */}
        <h3 className="mb-2 text-sm font-medium">Embeddings</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="embedding-model">Model</Label>
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
              className="flex h-10 w-full rounded-theme border border-border-theme bg-surface-card px-3 py-2 text-sm text-on-surface"
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

        <Button className="mt-6" disabled={savingConfig} onClick={() => void handleSaveModels()}>
          {savingConfig ? 'Saving...' : 'Save Model Settings'}
        </Button>
      </div>

      {/* Unified Prompt Editor */}
      {promptSets.length > 0 && (
        <UnifiedPromptEditor
          configEntries={configEntries}
          onSave={saveConfigKey}
          promptSets={promptSets}
        />
      )}

      {/* Test Inference */}
      <div className="rounded-theme border border-border-theme bg-surface-card p-6">
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
            <div className="rounded bg-surface p-4 text-sm dark:bg-on-surface/10">
              {testResult.content}
            </div>
            <div className="flex gap-3 text-xs text-on-surface-muted">
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
        <p className="mb-4 text-sm text-on-surface-muted">
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
