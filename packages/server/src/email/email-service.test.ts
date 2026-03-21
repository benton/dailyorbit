import { describe, it, expect } from 'vitest';
import { createEmailService, type EmailService } from './email-service.ts';

describe('email service', () => {
  it('should create a service instance without throwing', () => {
    const service: EmailService = createEmailService({ transport: 'test' });
    expect(service).toBeDefined();
    expect(service.sendMail).toBeDefined();
  });

  it('should send mail via test transport and return envelope info', async () => {
    const service: EmailService = createEmailService({ transport: 'test' });
    const result = await service.sendMail({
      to: 'user@example.com',
      subject: 'Test Alert',
      text: 'You have 3 new matches.',
      html: '<p>You have <b>3</b> new matches.</p>',
    });
    // jsonTransport returns a message object with envelope
    expect(result.envelope.to).toContain('user@example.com');
    expect(result.envelope.from).toBe('alerts@daily-orbit.example.com');
  });

  it('should use custom sender address when configured', async () => {
    const service: EmailService = createEmailService({
      transport: 'test',
      senderAddress: 'custom@example.com',
    });
    const result = await service.sendMail({
      to: 'user@example.com',
      subject: 'Test',
      text: 'test',
      html: '<p>test</p>',
    });
    expect(result.envelope.from).toBe('custom@example.com');
  });
});
