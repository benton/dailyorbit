import type { SendMailInput } from './email-service.ts';

export type TestEmailInput = {
  recipientName: string;
  recipientEmail: string;
  appBaseUrl: string;
};

export function renderTestEmail(input: TestEmailInput): SendMailInput {
  const text: string = [
    `Hi ${input.recipientName},`,
    '',
    'This is a test email from Daily Orbit.',
    '',
    'If you received this message, email delivery is working correctly',
    `for your account (${input.recipientEmail}).`,
    '',
    `Visit Daily Orbit: ${input.appBaseUrl}`,
    '',
    '— The Daily Orbit',
  ].join('\n');

  const html: string = [
    '<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">',
    '  <h1 style="font-size: 20px; margin: 0 0 16px;">Daily Orbit — Test Email</h1>',
    `  <p>Hi ${escapeHtml(input.recipientName)},</p>`,
    '  <p>This is a test email from <strong>Daily Orbit</strong>.</p>',
    '  <p>If you received this message, email delivery is working correctly',
    `  for your account (<code>${escapeHtml(input.recipientEmail)}</code>).</p>`,
    '  <div style="margin: 24px 0; padding: 16px; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #4f46e5;">',
    '    <p style="margin: 0; font-size: 14px; color: #374151;">',
    '      You can expect to receive alert digests here when new items match your saved searches.',
    '    </p>',
    '  </div>',
    `  <p><a href="${escapeHtml(input.appBaseUrl)}" style="color: #4f46e5;">Open Daily Orbit</a></p>`,
    '  <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;" />',
    '  <p style="color: #888; font-size: 12px;">The Daily Orbit — FCC IBFS Explorer</p>',
    '</div>',
  ].join('\n');

  return {
    to: input.recipientEmail,
    subject: 'Daily Orbit — Test Email',
    text,
    html,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
