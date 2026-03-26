import { useCallback, useEffect, useState } from 'react';
import type { Consultant } from '../chat/types.ts';
import {
  archiveConsultantAdmin,
  createConsultantAdmin,
  fetchAllConsultants,
  updateConsultantAdmin,
} from '../chat/api.ts';

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
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

function consultantToForm(c: Consultant): ConsultantForm {
  return {
    color: c.color ?? '',
    description: c.description ?? '',
    enabled: c.enabled,
    icon: c.icon ?? '',
    maxResponseTokens: c.maxResponseTokens != null ? String(c.maxResponseTokens) : '',
    modelId: c.modelId ?? '',
    name: c.name,
    slug: c.slug,
    sortOrder: c.sortOrder,
    systemPrompt: c.systemPrompt,
    temperature: c.temperature != null ? String(c.temperature) : '',
  };
}

function formToPayload(form: ConsultantForm): Partial<Consultant> {
  return {
    color: form.color || null,
    description: form.description || null,
    enabled: form.enabled,
    icon: form.icon || null,
    maxResponseTokens: form.maxResponseTokens !== '' ? Number(form.maxResponseTokens) : null,
    modelId: form.modelId || null,
    name: form.name,
    slug: form.slug,
    sortOrder: form.sortOrder,
    systemPrompt: form.systemPrompt,
    temperature: form.temperature !== '' ? Number(form.temperature) : null,
  };
}

export default function ConsultantAdmin() {
  const [consultants, setConsultants] = useState<Array<Consultant>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<ConsultantForm>(EMPTY_FORM);
  const [saving, setSaving] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    try {
      const data: Array<Consultant> = await fetchAllConsultants();
      setConsultants(data);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to load');
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
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Save failed');
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
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Archive failed');
    }
  };

  const handleToggleEnabled = async (c: Consultant): Promise<void> => {
    try {
      await updateConsultantAdmin(c.id, { enabled: !c.enabled });
      await refresh();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Toggle failed');
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

  const updateField = <K extends keyof ConsultantForm>(key: K, value: ConsultantForm[K]): void => {
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
    return <p className="text-sm text-on-surface-muted">Loading...</p>;
  }

  const active: Array<Consultant> = consultants.filter((c) => c.archivedAt == null);
  const archived: Array<Consultant> = consultants.filter((c) => c.archivedAt != null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-on-surface">Consultants</h2>
        <button
          className="rounded-theme bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          onClick={() => (showForm ? setShowForm(false) : startAdd())}
          type="button"
        >
          {showForm ? 'Cancel' : 'Add Consultant'}
        </button>
      </div>

      {error != null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Add / Edit form */}
      {showForm && (
        <div className="rounded-theme border border-border-theme p-4 dark:border-border-theme">
          <h3 className="mb-3 text-sm font-semibold text-on-surface">
            {editId != null ? 'Edit Consultant' : 'New Consultant'}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Name"
              value={form.name}
            />
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => updateField('slug', e.target.value)}
              placeholder="Slug"
              value={form.slug}
            />
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Description"
              value={form.description}
            />
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => updateField('modelId', e.target.value)}
              placeholder="Model ID (blank = default)"
              value={form.modelId}
            />
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => updateField('icon', e.target.value)}
              placeholder="Icon (emoji)"
              value={form.icon}
            />
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => updateField('color', e.target.value)}
              placeholder="Color (hex)"
              type="color"
              value={form.color || '#6366f1'}
            />
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => updateField('temperature', e.target.value)}
              placeholder="Temperature (blank = default)"
              step="0.1"
              type="number"
              value={form.temperature}
            />
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => updateField('maxResponseTokens', e.target.value)}
              placeholder="Max response tokens (blank = no limit)"
              type="number"
              value={form.maxResponseTokens}
            />
            <input
              className="rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => updateField('sortOrder', Number(e.target.value))}
              placeholder="Sort order"
              type="number"
              value={form.sortOrder}
            />
            <label className="flex items-center gap-2 text-sm text-on-surface">
              <input
                checked={form.enabled}
                onChange={(e) => updateField('enabled', e.target.checked)}
                type="checkbox"
              />
              Enabled
            </label>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-on-surface-muted">
              System Prompt
            </label>
            <textarea
              className="w-full rounded-theme border border-border-theme bg-surface-card px-2 py-1 text-sm"
              onChange={(e) => updateField('systemPrompt', e.target.value)}
              placeholder="System prompt..."
              rows={6}
              value={form.systemPrompt}
            />
          </div>
          <button
            className="mt-3 rounded-theme bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            disabled={
              saving ||
              form.name.trim() === '' ||
              form.slug.trim() === '' ||
              form.systemPrompt.trim() === ''
            }
            onClick={() => void handleSave()}
            type="button"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {/* Active consultants table */}
      <div className="overflow-x-auto rounded-theme border border-border-theme">
        <table className="min-w-full text-sm">
          <thead className="bg-surface text-left text-xs text-on-surface-muted dark:bg-on-surface/10 dark:text-on-surface-muted">
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
          <tbody className="divide-y divide-border-theme">
            {active.map((c: Consultant) => (
              <tr key={c.id}>
                <td className="px-3 py-2 text-lg">{c.icon ?? '—'}</td>
                <td className="px-3 py-2 font-medium text-on-surface">
                  {c.name}
                  {c.description != null && (
                    <div className="truncate text-xs text-on-surface-muted">{c.description}</div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-on-surface-muted">{c.slug}</td>
                <td className="px-3 py-2 text-xs text-on-surface-muted">
                  {c.modelId ?? 'default'}
                </td>
                <td className="px-3 py-2">
                  <button
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.enabled
                        ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                        : 'bg-on-surface/10 text-on-surface-muted dark:bg-on-surface/10 dark:text-on-surface-muted'
                    }`}
                    onClick={() => void handleToggleEnabled(c)}
                    type="button"
                  >
                    {c.enabled ? 'On' : 'Off'}
                  </button>
                </td>
                <td className="px-3 py-2 text-xs text-on-surface-muted">{c.sortOrder}</td>
                <td className="px-3 py-2">
                  <button
                    className="mr-2 text-xs text-on-surface-muted hover:underline dark:text-on-surface-muted"
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
                <td className="px-3 py-4 text-center text-on-surface-muted" colSpan={7}>
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
          <h3 className="mb-2 text-sm font-semibold text-on-surface-muted">
            Archived ({String(archived.length)})
          </h3>
          <div className="overflow-x-auto rounded-theme border border-border-theme">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-border-theme">
                {archived.map((c: Consultant) => (
                  <tr className="opacity-60" key={c.id}>
                    <td className="px-3 py-2 text-lg">{c.icon ?? '—'}</td>
                    <td className="px-3 py-2 text-on-surface-muted">{c.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-on-surface-muted">{c.slug}</td>
                    <td className="px-3 py-2 text-xs text-on-surface-muted">
                      Archived{' '}
                      {c.archivedAt != null ? new Date(c.archivedAt).toLocaleDateString() : ''}
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
