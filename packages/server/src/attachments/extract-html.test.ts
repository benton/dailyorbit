import { describe, expect, it } from 'vitest';
import { extractTextFromHtml, looksLikeAuthError } from './extract-html.ts';

describe('extractTextFromHtml', () => {
  it('extracts text from a simple HTML document', () => {
    const html: string = `
      <html><body>
        <h1>Application for Satellite License</h1>
        <p>Filed by EchoStar Corporation on 2024-01-15.</p>
      </body></html>`;
    const result = extractTextFromHtml(html);
    expect(result.status).toEqual('extracted');
    expect(result.text).toContain('Application for Satellite License');
    expect(result.text).toContain('EchoStar Corporation');
    expect(result.pageCount).toEqual(1);
  });

  it('extracts text from FCC OMB form HTML with tables', () => {
    const html: string = `
      <html><body>
        <h2>FCC Form 312 - Schedule S</h2>
        <table>
          <tr><th>Field</th><th>Value</th></tr>
          <tr><td>Applicant Name</td><td>Hughes Network Systems, LLC</td></tr>
          <tr><td>Call Sign</td><td>S2946</td></tr>
          <tr><td>Orbital Location</td><td>95.0 W.L.</td></tr>
          <tr><td>Frequency Band</td><td>Ka-band (18.3-18.8 GHz)</td></tr>
        </table>
      </body></html>`;
    const result = extractTextFromHtml(html);
    expect(result.status).toEqual('extracted');
    expect(result.text).toContain('Hughes Network Systems');
    expect(result.text).toContain('Ka-band');
  });

  it('strips script and style elements', () => {
    const html: string = `
      <html>
        <head><style>body { color: red; }</style></head>
        <body>
          <script>alert('xss')</script>
          <noscript>Enable JavaScript</noscript>
          <p>This is the actual content of the FCC filing document that we want to extract.</p>
        </body>
      </html>`;
    const result = extractTextFromHtml(html);
    expect(result.status).toEqual('extracted');
    expect(result.text).not.toContain('color: red');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('Enable JavaScript');
    expect(result.text).toContain('actual content');
  });

  it('returns skipped_no_text for HTML with insufficient text content', () => {
    const html: string = '<html><body><p>Hi</p></body></html>';
    const result = extractTextFromHtml(html);
    expect(result.status).toEqual('skipped_no_text');
  });

  it('returns skipped_no_text for HTML containing only script and style', () => {
    const html: string = `
      <html><body>
        <script>var x = 1;</script>
        <style>.foo { display: none; }</style>
      </body></html>`;
    const result = extractTextFromHtml(html);
    expect(result.status).toEqual('skipped_no_text');
  });

  it('decodes HTML entities correctly', () => {
    const html: string = `
      <html><body>
        <p>Filing for satellite license &mdash; frequencies &gt; 12 GHz &amp; orbital slots &lt; 100&deg; W.L.</p>
      </body></html>`;
    const result = extractTextFromHtml(html);
    expect(result.status).toEqual('extracted');
    expect(result.text).toContain('—');
    expect(result.text).toContain('&');
    expect(result.text).not.toContain('&amp;');
  });

  it('collapses excessive whitespace', () => {
    const html: string = `
      <html><body>
        <p>First paragraph of the satellite application filing narrative.</p>


        <p>Second paragraph with additional details about the filing requirements.</p>
      </body></html>`;
    const result = extractTextFromHtml(html);
    expect(result.status).toEqual('extracted');
    // Should not have 3+ consecutive newlines
    expect(result.text).not.toMatch(/\n{3,}/);
  });

  it('handles HTML without a body tag', () => {
    const html: string =
      '<div><p>This document contains important satellite filing information and technical data.</p></div>';
    const result = extractTextFromHtml(html);
    expect(result.status).toEqual('extracted');
    expect(result.text).toContain('satellite filing information');
  });
});

describe('looksLikeAuthError', () => {
  it('detects "Webpage not available" stub', () => {
    const html: string =
      '<html><body><h1>Webpage not available</h1></body></html>';
    expect(looksLikeAuthError(html, 80)).toEqual(true);
  });

  it('detects "Auth Failed" stub', () => {
    const html: string = '<html><body>Auth Failed</body></html>';
    expect(looksLikeAuthError(html, 50)).toEqual(true);
  });

  it('detects "Could not resolve host" stub', () => {
    const html: string =
      '<html><body>Could not resolve host: licensing.fcc.gov</body></html>';
    expect(looksLikeAuthError(html, 100)).toEqual(true);
  });

  it('returns false for files exceeding size threshold', () => {
    const html: string = '<html><body>Webpage not available</body></html>';
    expect(looksLikeAuthError(html, 600)).toEqual(false);
  });

  it('returns false for real FCC content', () => {
    const html: string = `
      <html><body>
        <h1>FCC Application Form 312</h1>
        <p>This application is filed pursuant to Section 25.115 of the Commission's rules.</p>
      </body></html>`;
    expect(looksLikeAuthError(html, 200)).toEqual(false);
  });

  it('detects "403 Forbidden" stub', () => {
    const html: string = '<html><body><h1>403 Forbidden</h1></body></html>';
    expect(looksLikeAuthError(html, 60)).toEqual(true);
  });
});
