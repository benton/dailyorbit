import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { unhideAll } from '../lib/hidden-items.ts';
import { useSettings } from '../lib/settings-context.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';

type UserProfile = {
  createdAt: string;
  email: string;
  gravatarUrl: string;
  id: string;
  name: string;
  role: string;
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [editName, setEditName] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const { settings, updateSetting } = useSettings();

  const fetchProfile = useCallback(async () => {
    try {
      const data: UserProfile = await apiFetch<UserProfile>('/api/user/profile');
      setProfile(data);
      setEditName(data.name);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const handleSaveName = async () => {
    if (editName === profile?.name) {
      return;
    }
    setSaving(true);
    try {
      const updated: UserProfile = await apiFetch<UserProfile>('/api/user/profile', {
        body: JSON.stringify({ name: editName }),
        method: 'PATCH',
      });
      setProfile(updated);
    } catch {
      // handled silently
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading profile...</p>;
  }

  if (profile == null) {
    return <p className="text-sm text-red-600">Failed to load profile.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Profile</h1>

      <div className="flex items-start gap-6 rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900">
        <img alt="Avatar" className="h-32 w-32 rounded-full" src={profile.gravatarUrl} />
        <div className="flex-1 space-y-4">
          <div>
            <p className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
              {profile.name}
            </p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{profile.email}</p>
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  profile.role === 'admin'
                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                    : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300'
                }`}
              >
                {profile.role}
              </span>
              <span className="ml-2">
                Member since {new Date(profile.createdAt).toLocaleDateString()}
              </span>
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Display Name
            </label>
            <div className="flex gap-2">
              <Input onChange={(e) => setEditName(e.target.value)} value={editName} />
              <Button
                disabled={saving || editName === profile.name}
                onClick={() => void handleSaveName()}
                size="sm"
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-4 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
          Preferences
        </h2>
        <div className="space-y-4">
          <ToggleRow
            checked={settings?.emailDailyOrbit ?? false}
            description="Email me when new content matches my alert searches"
            label="Email Alerts"
            onChange={(v: boolean) => updateSetting('emailDailyOrbit', v)}
          />
          <ToggleRow
            checked={settings?.wideView ?? false}
            description="Use a wider page layout for more content"
            label="Wide View"
            onChange={(v: boolean) => updateSetting('wideView', v)}
          />
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-4 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
          Hidden Items
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Unhide All Items
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Make all your personally hidden filings and news items visible again
            </p>
          </div>
          <Button
            className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800"
            onClick={() => {
              if (
                !confirm(
                  'Unhide all hidden items? This will make all your personally hidden filings and news items visible again.',
                )
              ) {
                return;
              }
              void unhideAll().then((count: number) => {
                alert(`${String(count)} item(s) unhidden.`);
              });
            }}
            size="sm"
          >
            Unhide All
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{label}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{description}</p>
      </div>
      <button
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
          checked ? 'bg-neutral-900 dark:bg-neutral-100' : 'bg-neutral-200 dark:bg-neutral-700'
        }`}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform dark:bg-neutral-900 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
