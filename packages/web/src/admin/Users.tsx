import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { Button } from '../ui/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog.tsx';
import { Input } from '../ui/input.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.tsx';

type UserRecord = {
  banned: boolean;
  banReason: string | null;
  createdAt: string;
  email: string;
  id: string;
  name: string;
  role: string;
};

export default function Users() {
  const [users, setUsers] = useState<Array<UserRecord>>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data: Array<UserRecord> = await apiFetch<Array<UserRecord>>('/api/admin/users');
      setUsers(data);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const handleDisable = async (id: string) => {
    await apiFetch(`/api/admin/users/${id}/disable`, { method: 'PUT' });
    void fetchUsers();
  };

  const handleEnable = async (id: string) => {
    await apiFetch(`/api/admin/users/${id}/enable`, { method: 'PUT' });
    void fetchUsers();
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    void fetchUsers();
  };

  const handleSetRole = async (id: string, role: string) => {
    await apiFetch(`/api/admin/users/${id}/role`, {
      body: JSON.stringify({ role }),
      method: 'PUT',
    });
    void fetchUsers();
  };

  const [sendingEmailTo, setSendingEmailTo] = useState<string | null>(null);

  const handleSendTestEmail = async (id: string) => {
    setSendingEmailTo(id);
    try {
      await apiFetch(`/api/admin/users/${id}/send-test-email`, { method: 'POST' });
    } finally {
      setSendingEmailTo(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-on-surface-muted">Loading users...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-on-surface">Users</h1>
        <CreateUserDialog onCreated={fetchUsers} />
      </div>

      <div className="rounded-theme border border-border-theme">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell className="h-24 text-center text-on-surface-muted" colSpan={6}>
                  No users.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user: UserRecord) => (
                <TableRow key={user.id}>
                  <TableCell className="font-mono text-xs">{user.email}</TableCell>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.role === 'admin'
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                          : 'bg-on-surface/10 text-on-surface '
                      }`}
                    >
                      {user.role}
                    </span>
                  </TableCell>
                  <TableCell>
                    {user.banned ? (
                      <span className="text-xs text-red-600 dark:text-red-400">
                        Disabled{user.banReason != null ? `: ${user.banReason}` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-green-600 dark:text-green-400">Active</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-on-surface-muted">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {user.banned ? (
                        <Button
                          onClick={() => void handleEnable(user.id)}
                          size="sm"
                          variant="ghost"
                        >
                          Enable
                        </Button>
                      ) : (
                        <Button
                          onClick={() => void handleDisable(user.id)}
                          size="sm"
                          variant="ghost"
                        >
                          Disable
                        </Button>
                      )}
                      <Button
                        disabled={sendingEmailTo === user.id}
                        onClick={() => void handleSendTestEmail(user.id)}
                        size="sm"
                        variant="ghost"
                      >
                        {sendingEmailTo === user.id ? 'Sending...' : 'Test Email'}
                      </Button>
                      <Button
                        onClick={() =>
                          void handleSetRole(user.id, user.role === 'admin' ? 'user' : 'admin')
                        }
                        size="sm"
                        variant="ghost"
                      >
                        {user.role === 'admin' ? 'Demote' : 'Promote'}
                      </Button>
                      <ResetPasswordDialog userId={user.id} />
                      <DeleteUserDialog
                        onConfirm={() => void handleDelete(user.id)}
                        userName={user.name}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CreateUserDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [role, setRole] = useState<string>('user');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    try {
      await apiFetch('/api/admin/users', {
        body: JSON.stringify({ email, name, password, role }),
        method: 'POST',
      });
      setOpen(false);
      setEmail('');
      setName('');
      setPassword('');
      setRole('user');
      onCreated();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to create user');
    }
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm">Create User</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>Add a new user account.</DialogDescription>
        </DialogHeader>
        {error != null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="space-y-3">
          <Input
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            value={email}
          />
          <Input onChange={(e) => setName(e.target.value)} placeholder="Name" value={name} />
          <Input
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            type="password"
            value={password}
          />
          <select
            className="flex h-9 w-full rounded-theme border border-border-theme bg-transparent px-3 py-1 text-sm dark:border-border-theme"
            onChange={(e) => setRole(e.target.value)}
            value={role}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={() => void handleSubmit()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ userId }: { userId: string }) {
  const [open, setOpen] = useState<boolean>(false);
  const [password, setPassword] = useState<string>('');

  const handleSubmit = async () => {
    await apiFetch(`/api/admin/users/${userId}/reset-password`, {
      body: JSON.stringify({ password }),
      method: 'POST',
    });
    setOpen(false);
    setPassword('');
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Reset PW
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>Enter a new password for this user.</DialogDescription>
        </DialogHeader>
        <Input
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          type="password"
          value={password}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={() => void handleSubmit()}>Reset</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({ onConfirm, userName }: { onConfirm: () => void; userName: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive">
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete User</DialogTitle>
          <DialogDescription>
            Permanently delete {userName}? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={onConfirm} variant="destructive">
              Delete
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
