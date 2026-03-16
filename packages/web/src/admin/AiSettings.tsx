import type { ColumnDef } from '@tanstack/react-table';
import { Loader2, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import { DataTable, type PaginatedResponse } from '../ui/DataTable.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { ToastProvider, useToast } from '../ui/toast.tsx';

type ModelInfo = {
  modelId: string;
  modelName: string;
  provider: string;
};

type InferenceResponse = {
  content: string;
  modelId: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  stopReason: string;
  latencyMs: number;
};

type ConfigEntry = {
  key: string;
  value: string;
  description: string;
  encrypted: boolean;
};

const modelColumns: Array<ColumnDef<ModelInfo, unknown>> = [
  { accessorKey: 'provider', header: 'Provider', size: 150 },
  { accessorKey: 'modelName', header: 'Name', size: 250 },
  {
    accessorKey: 'modelId',
    header: 'Model ID',
    size: 400,
    cell: ({ getValue }) => (
      <span className="font-mono text-sm">{getValue() as string}</span>
    ),
  },
];

function AiSettingsInner() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  const [testPrompt, setTestPrompt] = useState<string>('Say hello in one sentence.');
  const [testResult, setTestResult] = useState<InferenceResponse | null>(null);
  const [testing, setTesting] = useState<boolean>(false);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const { toast } = useToast();

  const fetchConfig = useCallback(async () => {
    try {
      const entries: ConfigEntry[] = await apiFetch('/api/admin/config');
      const regionEntry = entries.find((e) => e.key === 'bedrockRegion');
      const modelEntry = entries.find((e) => e.key === 'bedrockDefaultModel');
      if (regionEntry) setRegion(regionEntry.value);
      if (modelEntry) setDefaultModel(modelEntry.value);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load config', 'error');
    }
  }, [toast]);

  /** Fetch models from API, cache for dropdown, and return as PaginatedResponse for DataTable. */
  const fetchModelsPage = useCallback(async (): Promise<PaginatedResponse<ModelInfo>> => {
    const data: ModelInfo[] = await apiFetch('/api/admin/inference/models');
    setModels(data);
    return {
      data,
      page: 1,
      pageSize: data.length,
      totalRows: data.length,
      totalPages: 1,
    };
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    try {
      await Promise.all([
        apiFetch('/api/admin/config/bedrockRegion', {
          method: 'PUT',
          body: JSON.stringify({ value: region }),
        }),
        apiFetch('/api/admin/config/bedrockDefaultModel', {
          method: 'PUT',
          body: JSON.stringify({ value: defaultModel }),
        }),
      ]);
      toast('AI settings saved', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSavingConfig(false);
    }
  }, [region, defaultModel, toast]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const resp: InferenceResponse = await apiFetch('/api/admin/inference/test', {
        method: 'POST',
        body: JSON.stringify({
          modelId: defaultModel || undefined,
          messages: [{ role: 'user', content: testPrompt }],
          params: { maxTokens: 256, temperature: 0.7 },
        }),
      });
      setTestResult(resp);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Inference failed', 'error');
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
            <Input
              id="bedrock-region"
              onChange={(e) => setRegion(e.target.value)}
              value={region}
            />
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

      {/* Test Section */}
      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-lg font-medium">Test Inference</h2>
        <div className="flex gap-2">
          <Input
            className="flex-1"
            onChange={(e) => setTestPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleTest(); }}
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
          fetchData={fetchModelsPage}
          defaultSort="provider"
          defaultOrder="asc"
          defaultPageSize={25}
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
