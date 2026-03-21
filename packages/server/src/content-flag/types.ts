export type ContentFlagSource = 'manual' | 'alert';

export type ContentFlagRow = {
  id: number;
  user_id: string;
  content_type: string;
  content_key: string;
  source: ContentFlagSource;
  saved_search_id: number;
  reason: string | null;
  created_at: string;
  dismissed_at: string | null;
};

export type CreateFlagInput = {
  content_type: string;
  content_key: string;
  source?: ContentFlagSource;
  saved_search_id?: number;
  reason?: string;
};

export type BulkFlagInput = {
  content_type: string;
  content_keys: string[];
  reason?: string;
};
