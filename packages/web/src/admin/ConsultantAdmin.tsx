import { useCallback, useEffect, useState } from 'react';
import {
  archiveConsultantAdmin,
  createConsultantAdmin,
  fetchAllConsultants,
  updateConsultantAdmin,
} from '../chat/api.ts';
import type { Consultant } from '../chat/types.ts';

type ConsultantForm = {
  color: string;
  description: string;
  enabled: boolean;
  icon: string;
  maxResponseTokens: string;
  modelId: string;
  name: string;
  slug: string;
  sortOrder: number;
  systemPrompt: string;
  temperature: string;
};

const EMPTY_FORM: ConsultantForm = {
  color: '',
  description: '',
  enabled: true,
  icon: '',
  maxResponseTokens: '',
  modelId: '',
  name: '',
  slug: '',
  sortOrder: 0,
  systemPrompt: '',
  temperature: '',
};

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function consultantToForm(c: Consultant): ConsultantForm {
  return {
    color: c.color ?? '',
    description: c.description ?? '',
    enabled: c.enabled,
    icon: c.icon ?? '',
    maxResponseTokens:
      c.maxResponseTokens != null ? String(c.maxResponseTokens) : '',
    modelId: c.modelId ?? '',
    name: c.name,
    slug: c.slug,
    sortOrder: c.sortOrder,
    systemPrompt: c.systemPrompt,
    temperature: c.temperature != null ? String(c.temperature) : '',
  };
}

function formToPayload(
  form: ConsultantForm,
): Partial<Consultant> {
  return {
    color: form.color || null,
    description: form.description || null,
    enabled: form.enabled,
    icon: form.icon || null,
    maxResponseTokens:
      form.maxResponseTokens !== ''
        ? Number(form.maxResponseTokens)
        : null,
    modelId: form.modelId || null,
    name: form.name,
    slug: form.slug,
    sortOrder: form.sortOrder,
    systemPrompt: form.systemPrompt,
    temperature:
      form.temperature !== '' ? Number(form.temperature) : null,
  };
}

export default function ConsultantAdmin() {
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<ConsultantForm>(EMPTY_FORM);
  const [saving, setSaving] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    try {
      const data: Consultant[] = await fetchAllConsultants();
      setConsultants(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const payload: Partial<Consultant> = formToPayload(form);
      if (editId != null) {
        await updateConsultantAdmin(editId, payload);
      } else {
        await createConsultantAdmin(payload);
      }
      setShowForm(false);
      setEditId(null);
      setForm(EMPTY_FORM);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id: number): Promise<void> => {
    if (!confirm('Archive this consultant? Existing conversations will be preserved.')) {
      return;
    }
    try {
      await archiveConsultantAdmin(id);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Archive failed');
    }
  };

  const handleToggleEnabled = async (c: Consultant): Promise<void> => {
    try {
      await updateConsultantAdmin(c.id, { enabled: !c.enabled });
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    }
  };

  const startEdit = (c: Consultant): void => {
    setEditId(c.id);
    setForm(consultantToForm(c));
    setShowForm(true);
  };

  const startAdd = (): void => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const updateField = <K extends keyof ConsultantForm>(
    key: K,
    value: ConsultantForm[K],
  ): void => {
    setForm((prev) => {
      const next: ConsultantForm = { ...prev, [key]: value };
      // Auto-generate slug from name when adding new
      if (key === 'name' && editId == null) {
        next.slug = toSlug(value as string);
      }
      return next;
    });
  };

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading...</p>;
  }

  const active: Consultant[] = consultants.filter(
    (c) => c.archivedAt == null,
  );
  const archived: Consultant[] = consultants.filter(
    (c) => c.archivedAt != null,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
          Consultants
        </h2>
        <button
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          onClick={() => (showForm ? setShowForm(false) : startAdd())}
          type="button"
        >
          {showForm ? 'Cancel' : 'Add Consultant'}
        </button>
      </div>

      {error != null && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
          <h3 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            {editId != null ? 'Edit Consultant' : 'New Consultant'}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Name"
              value={form.name}
            />
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => updateField('slug', e.target.value)}
              placeholder="Slug"
              value={form.slug}
            />
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Description"
              value={form.description}
            />
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => updateField('modelId', e.target.value)}
              placeholder="Model ID (blank = default)"
              value={form.modelId}
            />
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => updateField('icon', e.target.value)}
              placeholder="Icon (emoji)"
              value={form.icon}
            />
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => updateField('color', e.target.value)}
              placeholder="Color (hex)"
              type="color"
              value={form.color || '#6366f1'}
            />
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => updateField('temperature', e.target.value)}
              placeholder="Temperature (blank = default)"
              step="0.1"
              type="number"
              value={form.temperature}
            />
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => updateField('maxResponseTokens', e.target.value)}
              placeholder="Max response tokens (blank = no limit)"
              type="number"
              value={form.maxResponseTokens}
            />
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => updateField('sortOrder', Number(e.target.value))}
              placeholder="Sort order"
              type="number"
              value={form.sortOrder}
            />
            <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                checked={form.enabled}
                onChange={(e) => updateField('enabled', e.target.checked)}
                type="checkbox"
              />
              Enabled
            </label>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              System Prompt
            </label>
            <textarea
              className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
              onChange={(e) => updateField('systemPrompt', e.target.value)}
              placeholder="System prompt..."
              rows={6}
              value={form.systemPrompt}
            />
          </div>
          <button
            className="mt-3 rounded-md bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            disabled={
              saving || form.name.trim() === '' || form.slug.trim() === '' || form.systemPrompt.trim() === ''
            }
            onClick={() => void handleSave()}
            type="button"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {/* Active consultants table */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <tr>
              <th className="px-3 py-2">Icon</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">Enabled</th>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {active.map((c: Consultant) => (
              <tr key={c.id}>
                <td className="px-3 py-2 text-lg">{c.icon ?? '—'}</td>
                <td className="px-3 py-2 font-medium text-neutral-900 dark:text-neutral-100">
                  {c.name}
                  {c.description != null && (
                    <div className="truncate text-xs text-neutral-400">
                      {c.description}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">
                  {c.slug}
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {c.modelId ?? 'default'}
                </td>
                <td className="px-3 py-2">
                  <button
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.enabled
                        ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                        : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                    }`}
                    onClick={() => void handleToggleEnabled(c)}
                    type="button"
                  >
                    {c.enabled ? 'On' : 'Off'}
                  </button>
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {c.sortOrder}
                </td>
                <td className="px-3 py-2">
                  <button
                    className="mr-2 text-xs text-neutral-600 hover:underline dark:text-neutral-400"
                    onClick={() => startEdit(c)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => void handleArchive(c.id)}
                    type="button"
                  >
                    Archive
                  </button>
                </td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr>
                <td
                  className="px-3 py-4 text-center text-neutral-400"
                  colSpan={7}
                >
                  No consultants configured
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Archived section */}
      {archived.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral-500">
            Archived ({String(archived.length)})
          </h3>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {archived.map((c: Consultant) => (
                  <tr className="opacity-60" key={c.id}>
                    <td className="px-3 py-2 text-lg">{c.icon ?? '—'}</td>
                    <td className="px-3 py-2 text-neutral-500">{c.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-neutral-400">
                      {c.slug}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-400">
                      Archived{' '}
                      {c.archivedAt != null
                        ? new Date(c.archivedAt).toLocaleDateString()
                        : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
