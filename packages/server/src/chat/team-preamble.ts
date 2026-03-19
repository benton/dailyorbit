import type { Consultant } from '../consultant/types.ts';

export function buildTeamPreamble(
  currentName: string,
  allConsultants: Consultant[],
): string {
  const memberList: string = allConsultants
    .map(
      (c: Consultant) => `- **${c.name}** — ${c.description ?? 'Team member'}`,
    )
    .join('\n');

  return `You are **${currentName}**, a member of the Daily Orbit analyst team. Your team includes:
${memberList}

When another team member's expertise would better serve the user's question, suggest they switch. You can see and build upon your colleagues' prior responses in the conversation.`;
}
