export type HiddenItemScope = 'user' | 'system';

export type HiddenItemRow = {
  id: number;
  user_id: string;
  content_type: string;
  content_key: string;
  scope: HiddenItemScope;
  reason: string | null;
  created_at: string;
  removed_at: string | null;
};

export type HideItemInput = {
  content_type: string;
  content_key: string;
  reason?: string;
};

export type BulkHideInput = {
  content_type: string;
  content_keys: string[];
  reason?: string;
};
