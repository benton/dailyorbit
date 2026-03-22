import { useState } from 'react';
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

type SaveSearchModalProps = {
  onClose: () => void;
  onSave: (name: string) => void;
  open: boolean;
};

export function SaveSearchModal({ onClose, onSave, open }: SaveSearchModalProps) {
  const [name, setName] = useState<string>('');

  const handleSave = () => {
    const trimmed: string = name.trim();
    if (trimmed === '') {return;}
    onSave(trimmed);
    setName('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setName('');
      onClose();
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save Search</DialogTitle>
          <DialogDescription>
            Give this search a name so you can quickly re-run it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="saved-search-name">Name</Label>
          <Input
            id="saved-search-name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {handleSave();}
            }}
            placeholder="e.g. SpaceX SAT filings"
            value={name}
          />
        </div>
        <DialogFooter>
          <Button onClick={onClose} size="sm" variant="outline">
            Cancel
          </Button>
          <Button disabled={name.trim() === ''} onClick={handleSave} size="sm">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
