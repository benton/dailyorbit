import { describe, expect, it } from 'vitest';
import { buildTeamPreamble } from './team-preamble.ts';
import type { Consultant } from '../consultant/types.ts';

describe('buildTeamPreamble', () => {
  const CONSULTANTS: Consultant[] = [
    {
      id: 1, name: 'General Analyst', slug: 'general-analyst',
      description: 'Balanced Q&A', systemPrompt: '', modelId: null,
      temperature: null, maxResponseTokens: null, icon: '🔍',
      color: '#3B82F6', sortOrder: 0, enabled: true,
      archivedAt: null, createdAt: '', updatedAt: '',
    },
    {
      id: 2, name: 'Regulatory Strategist', slug: 'regulatory-strategist',
      description: 'Legal precedent and timelines', systemPrompt: '', modelId: null,
      temperature: null, maxResponseTokens: null, icon: '⚖️',
      color: '#8B5CF6', sortOrder: 1, enabled: true,
      archivedAt: null, createdAt: '', updatedAt: '',
    },
  ];

  it('includes the current consultant name and all team members', () => {
    const preamble = buildTeamPreamble('General Analyst', CONSULTANTS);
    expect(preamble).toContain('You are **General Analyst**');
    expect(preamble).toContain('**General Analyst**');
    expect(preamble).toContain('**Regulatory Strategist**');
    expect(preamble).toContain('Balanced Q&A');
    expect(preamble).toContain('Legal precedent and timelines');
  });

  it('includes the collaboration instruction', () => {
    const preamble = buildTeamPreamble('General Analyst', CONSULTANTS);
    expect(preamble).toContain('colleagues');
  });
});
