import type { Consultant, Conversation, ConversationWithMessages } from './types.ts';
import { apiFetch } from '../lib/api.ts';

export async function fetchConsultants(): Promise<Array<Consultant>> {
  return apiFetch<Array<Consultant>>('/api/consultants');
}

export async function fetchConversations(): Promise<Array<Conversation>> {
  return apiFetch<Array<Conversation>>('/api/conversations');
}

export async function fetchConversation(id: string): Promise<ConversationWithMessages> {
  return apiFetch<ConversationWithMessages>(`/api/conversations/${id}`);
}

export async function createConversation(consultantId: number): Promise<Conversation> {
  return apiFetch<Conversation>('/api/conversations', {
    body: JSON.stringify({ consultantId }),
    method: 'POST',
  });
}

export async function renameConversation(id: string, title: string): Promise<Conversation> {
  return apiFetch<Conversation>(`/api/conversations/${id}`, {
    body: JSON.stringify({ title }),
    method: 'PUT',
  });
}

export async function deleteConversation(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/conversations/${id}`, {
    method: 'DELETE',
  });
}

// Admin
export async function fetchAllConsultants(): Promise<Array<Consultant>> {
  return apiFetch<Array<Consultant>>('/api/admin/consultants');
}

export async function createConsultantAdmin(data: Partial<Consultant>): Promise<Consultant> {
  return apiFetch<Consultant>('/api/admin/consultants', {
    body: JSON.stringify(data),
    method: 'POST',
  });
}

export async function updateConsultantAdmin(
  id: number,
  data: Partial<Consultant>,
): Promise<Consultant> {
  return apiFetch<Consultant>(`/api/admin/consultants/${id}`, {
    body: JSON.stringify(data),
    method: 'PUT',
  });
}

export async function archiveConsultantAdmin(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/admin/consultants/${id}`, {
    method: 'DELETE',
  });
}
