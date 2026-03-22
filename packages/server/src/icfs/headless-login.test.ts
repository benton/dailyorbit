import { describe, expect, it } from 'vitest';
import { formatCookieOutput } from './headless-login.ts';

describe('formatCookieOutput', () => {
  it('formats Playwright cookies into CookieOutput JSON with 30-min expiry', () => {
    const mockCookies = [
      {
        name: 'JSESSIONID',
        value: 'abc123',
        domain: 'fccprod.servicenowservices.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
      },
      {
        name: 'glide_user_route',
        value: 'xyz',
        domain: 'fccprod.servicenowservices.com',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax' as const,
      },
    ];
    const now = new Date('2026-03-21T12:00:00Z');

    const result = formatCookieOutput(mockCookies, now);

    expect(result).toEqual({
      cookies: 'JSESSIONID=abc123; glide_user_route=xyz',
      extractedAt: '2026-03-21T12:00:00.000Z',
      expiresAt: '2026-03-21T12:30:00.000Z',
      cookieCount: 2,
    });
  });

  it('filters out cookies not matching the ServiceNow domain', () => {
    const mixedCookies = [
      {
        name: 'JSESSIONID',
        value: 'abc123',
        domain: 'fccprod.servicenowservices.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
      },
      {
        name: 'okta_session',
        value: 'zzz',
        domain: 'fcc-ext.okta.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
      },
    ];
    const now = new Date('2026-03-21T12:00:00Z');

    const result = formatCookieOutput(mixedCookies, now);

    expect(result).toEqual({
      cookies: 'JSESSIONID=abc123',
      extractedAt: '2026-03-21T12:00:00.000Z',
      expiresAt: '2026-03-21T12:30:00.000Z',
      cookieCount: 1,
    });
  });

  it('throws when no cookies match the ServiceNow domain', () => {
    const emptyCookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Lax';
    }> = [];

    expect(() => formatCookieOutput(emptyCookies, new Date())).toThrow(
      /no ServiceNow cookies/i,
    );
  });
});
