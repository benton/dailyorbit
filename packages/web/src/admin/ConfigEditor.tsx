import { Pencil } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.tsx';
import { ToastProvider, useToast } from '../ui/toast.tsx';

type ConfigEntry = {
  description: string;
  encrypted: boolean;
  key: string;
  value: string;
};

function ConfigEditorInner() {
  const [entries, setEntries] = useState<Array<ConfigEntry>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [editEntry, setEditEntry] = useState<ConfigEntry | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const { toast } = useToast();

  const fetchConfig = useCallback(async () => {
    try {
      const data: Array<ConfigEntry> = await apiFetch<Array<ConfigEntry>>('/api/admin/config');
      setEntries(data);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to load config', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const handleEdit = useCallback((entry: ConfigEntry) => {
    setEditEntry(entry);
    setEditValue(entry.encrypted ? '' : entry.value);
  }, []);

  const handleSave = useCallback(async () => {
    if (editEntry == null) {
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/config/${editEntry.key}`, {
        body: JSON.stringify({ value: editValue }),
        method: 'PUT',
      });
      toast(`Updated "${editEntry.key}"`, 'success');
      setEditEntry(null);
      await fetchConfig();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }, [editEntry, editValue, fetchConfig, toast]);

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading configuration...</p>;
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Configuration
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          View and edit application configuration values.
        </p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.key}>
                <TableCell className="font-mono text-sm">{entry.key}</TableCell>
                <TableCell className="text-neutral-500 dark:text-neutral-400">
                  {entry.description}
                </TableCell>
                <TableCell>
                  {entry.encrypted ? (
                    <Badge variant="secondary">encrypted</Badge>
                  ) : (
                    <span className="font-mono text-sm">{entry.value}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button onClick={() => handleEdit(entry)} size="icon" variant="ghost">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setEditEntry(null);
          }
        }}
        open={editEntry != null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editEntry?.key}</DialogTitle>
            <DialogDescription>{editEntry?.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="config-value">Value</Label>
            <Input
              id="config-value"
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleSave();
                }
              }}
              placeholder={editEntry?.encrypted ? 'Enter new value' : undefined}
              type={editEntry?.encrypted ? 'password' : 'text'}
              value={editValue}
            />
          </div>
          <DialogFooter>
            <Button disabled={saving} onClick={() => void handleSave()}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function ConfigEditor() {
  return (
    <ToastProvider>
      <ConfigEditorInner />
    </ToastProvider>
  );
}
