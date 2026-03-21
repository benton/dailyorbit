export type DigestItem = {
  key: string;
  title: string;
  url: string;
};

export type DigestSearchGroup = {
  searchName: string;
  contentType: string;
  items: DigestItem[];
};

export type DigestInput = {
  userName: string;
  matches: DigestSearchGroup[];
};

export type DigestOutput = {
  subject: string;
  text: string;
  html: string;
};

export function renderAlertDigest(input: DigestInput): DigestOutput {
  const totalItems: number = input.matches.reduce(
    (sum: number, g: DigestSearchGroup) => sum + g.items.length,
    0,
  );

  const plural: string = totalItems !== 1 ? 's' : '';
  const subject: string = `Daily Orbit: ${String(totalItems)} new item${plural} matching your alerts`;

  // Plain text
  const textSections: string[] = input.matches.map(
    (group: DigestSearchGroup) => {
      const items: string = group.items
        .map((item: DigestItem) => `  - ${item.title} (${item.url})`)
        .join('\n');
      return `${group.searchName} (${String(group.items.length)} new):\n${items}`;
    },
  );
  const text: string = [
    `Hi ${input.userName},`,
    '',
    `You have ${String(totalItems)} new item${plural} matching your saved searches:`,
    '',
    ...textSections,
    '',
    '— The Daily Orbit',
  ].join('\n');

  // HTML
  const htmlSections: string = input.matches
    .map((group: DigestSearchGroup) => {
      const items: string = group.items
        .map(
          (item: DigestItem) =>
            `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></li>`,
        )
        .join('\n');
      return `<h2 style="margin: 16px 0 8px; font-size: 16px;">${escapeHtml(group.searchName)} (${String(group.items.length)} new)</h2>\n<ul>${items}</ul>`;
    })
    .join('\n');

  const html: string = [
    '<div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">',
    `<p>Hi ${escapeHtml(input.userName)},</p>`,
    `<p>You have <strong>${String(totalItems)}</strong> new item${plural} matching your saved searches:</p>`,
    htmlSections,
    '<hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;" />',
    '<p style="color: #888; font-size: 12px;">The Daily Orbit — FCC IBFS Explorer</p>',
    '</div>',
  ].join('\n');

  return { subject, text, html };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
