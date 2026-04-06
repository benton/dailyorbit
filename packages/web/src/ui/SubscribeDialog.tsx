import { Link } from 'react-router';
import { Button } from './button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog.tsx';

type SubscribeDialogProps = {
  message: string;
  onClose: () => void;
  open: boolean;
};

export function SubscribeDialog({ message, onClose, open }: SubscribeDialogProps) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subscribers Only</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose} size="sm" variant="outline">
            Close
          </Button>
          <Link to="/about">
            <Button size="sm">Learn More</Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
