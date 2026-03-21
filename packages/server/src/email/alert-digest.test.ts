import { describe, it, expect } from 'vitest';
import { renderAlertDigest, type DigestInput } from './alert-digest.ts';

describe('alert digest renderer', () => {
  const input: DigestInput = {
    userName: 'Alice',
    matches: [
      {
        searchName: 'SAT filings',
        contentType: 'filing',
        items: [
          {
            key: 'SAT-LOA-20260321-00001',
            title: 'SpaceX Inc — SAT LOA',
            url: '/filings/SAT-LOA-20260321-00001',
          },
          {
            key: 'SAT-MOD-20260321-00002',
            title: 'ViaSat — SAT MOD',
            url: '/filings/SAT-MOD-20260321-00002',
          },
        ],
      },
      {
        searchName: 'Spectrum news',
        contentType: 'news',
        items: [
          {
            key: '42',
            title: 'FCC Approves New Spectrum Sharing Rules',
            url: '/news/42',
          },
        ],
      },
    ],
  };

  it('should render text with all matches grouped by search', () => {
    const { text } = renderAlertDigest(input);
    expect(text).toContain('SAT filings');
    expect(text).toContain('SAT-LOA-20260321-00001');
    expect(text).toContain('Spectrum news');
    expect(text).toContain('FCC Approves New Spectrum Sharing Rules');
  });

  it('should render HTML with all matches grouped by search', () => {
    const { html } = renderAlertDigest(input);
    expect(html).toContain('<h2');
    expect(html).toContain('SAT filings');
    expect(html).toContain('href=');
  });

  it('should include the user name in the greeting', () => {
    const { text, html } = renderAlertDigest(input);
    expect(text).toContain('Alice');
    expect(html).toContain('Alice');
  });

  it('should generate a subject line with total count', () => {
    const { subject } = renderAlertDigest(input);
    expect(subject).toContain('3');
  });

  it('should handle singular item count in subject', () => {
    const singleInput: DigestInput = {
      userName: 'Bob',
      matches: [
        {
          searchName: 'Test',
          contentType: 'filing',
          items: [{ key: 'X', title: 'Only One', url: '/filings/X' }],
        },
      ],
    };
    const { subject } = renderAlertDigest(singleInput);
    expect(subject).toContain('1 new item matching');
    expect(subject).not.toContain('items');
  });

  it('should escape HTML special characters in content', () => {
    const xssInput: DigestInput = {
      userName: '<script>alert("xss")</script>',
      matches: [
        {
          searchName: 'Test & "Quotes"',
          contentType: 'filing',
          items: [
            {
              key: 'X',
              title: '<b>bold</b>',
              url: '/filings/X?a=1&b=2',
            },
          ],
        },
      ],
    };
    const { html } = renderAlertDigest(xssInput);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});
