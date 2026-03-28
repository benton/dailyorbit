import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
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
    return <p className="text-sm text-on-surface-muted">Loading profile...</p>;
  }

  if (profile == null) {
    return <p className="text-sm text-red-600">Failed to load profile.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-on-surface">Profile</h1>

      <div className="flex items-start gap-6 rounded-theme border border-border-theme bg-surface-card p-6">
        <img alt="Avatar" className="h-32 w-32 rounded-full" src={profile.gravatarUrl} />
        <div className="flex-1 space-y-4">
          <div>
            <p className="text-lg font-medium text-on-surface">{profile.name}</p>
            <p className="text-sm text-on-surface-muted">{profile.email}</p>
            <p className="mt-1 text-xs text-on-surface-muted/70">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  profile.role === 'admin'
                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                    : 'bg-surface text-on-surface'
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
            <label className="text-sm font-medium text-on-surface">Display Name</label>
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
    </div>
  );
}
