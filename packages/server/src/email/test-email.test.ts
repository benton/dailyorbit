import { describe, it, expect } from 'vitest';
import { renderTestEmail, type TestEmailInput } from './test-email.ts';
import type { SendMailInput } from './email-service.ts';

describe('renderTestEmail', () => {
  const input: TestEmailInput = {
    recipientName: 'Alice',
    recipientEmail: 'alice@example.com',
    appBaseUrl: 'https://dailyorbit.org',
  };

  it('should return correct subject line', () => {
    const result: SendMailInput = renderTestEmail(input);
    expect(result.subject).toBe('Daily Orbit — Test Email');
  });

  it('should address the recipient by name in text and html', () => {
    const result: SendMailInput = renderTestEmail(input);
    expect(result.text).toContain('Hi Alice,');
    expect(result.html).toContain('Hi Alice,');
  });

  it('should include the recipient email in the body', () => {
    const result: SendMailInput = renderTestEmail(input);
    expect(result.text).toContain('alice@example.com');
    expect(result.html).toContain('alice@example.com');
  });

  it('should include the app base URL as a link', () => {
    const result: SendMailInput = renderTestEmail(input);
    expect(result.text).toContain('https://dailyorbit.org');
    expect(result.html).toContain('href="https://dailyorbit.org"');
  });

  it('should set the to field to the recipient email', () => {
    const result: SendMailInput = renderTestEmail(input);
    expect(result.to).toBe('alice@example.com');
  });

  it('should escape HTML special characters in user-provided values', () => {
    const xssInput: TestEmailInput = {
      recipientName: '<script>alert("xss")</script>',
      recipientEmail: 'bob@example.com',
      appBaseUrl: 'https://dailyorbit.org',
    };
    const result: SendMailInput = renderTestEmail(xssInput);
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
  });
});
