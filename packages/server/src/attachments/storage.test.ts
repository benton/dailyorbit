import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachmentStorageKey,
  downloadFile,
  normalizeDownloadUrl,
  SessionExpiredError,
} from './storage.ts';

describe('attachmentStorageKey', () => {
  const cases: Array<{
    subsystem: string;
    hyphenated: string;
    key: number;
    extension: string;
    expected: string;
  }> = [
    {
      subsystem: 'SAT',
      hyphenated: 'SAT-STA-20230614-00142',
      key: 22902690,
      extension: 'pdf',
      expected: 'SAT/SAT-STA-20230614-00142/22902690.pdf',
    },
    {
      subsystem: 'SES',
      hyphenated: 'SES-LOA-20240101-00001',
      key: 99999,
      extension: 'html',
      expected: 'SES/SES-LOA-20240101-00001/99999.html',
    },
    {
      subsystem: 'SAT',
      hyphenated: 'SAT-LOA-20200101-00001',
      key: 123,
      extension: 'bin',
      expected: 'SAT/SAT-LOA-20200101-00001/123.bin',
    },
  ];

  it.each(cases)(
    'builds key $expected',
    ({ subsystem, hyphenated, key, extension, expected }) => {
      const result: string = attachmentStorageKey(
        subsystem,
        hyphenated,
        key,
        extension,
      );
      expect(result).toEqual(expected);
    },
  );

  it('key components are deterministic — same inputs always produce same output', () => {
    const a: string = attachmentStorageKey(
      'SAT',
      'SAT-LOA-20200101-00001',
      123,
      'pdf',
    );
    const b: string = attachmentStorageKey(
      'SAT',
      'SAT-LOA-20200101-00001',
      123,
      'pdf',
    );
    expect(a).toEqual(b);
  });
});

describe('normalizeDownloadUrl', () => {
  it('appends .pdf to URLs without it', () => {
    expect(
      normalizeDownloadUrl(
        'https://fcc.report/IBFS/SAT-STA-20230614-00142/22902690',
      ),
    ).toEqual('https://fcc.report/IBFS/SAT-STA-20230614-00142/22902690.pdf');
  });

  it('leaves URLs that already end in .pdf unchanged', () => {
    const url: string =
      'https://fcc.report/IBFS/SAT-STA-20230614-00142/22902690.pdf';
    expect(normalizeDownloadUrl(url)).toEqual(url);
  });
});

describe('downloadFile session-expiry detection', () => {
  const SERVICENOW_URL: string =
    'https://fccprod.servicenowservices.com/sys_attachment.do?sys_id=abc123';
  const AUTH_COOKIES: string = 'BIGipServer=abc; glide_session=xyz';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns HTML content when response is a legitimate FCC filing form', async () => {
    const fccFormHtml: string = `<HTML><HEAD><BODY>
      <table><tr><td align="right">Approved by OMB<BR>3060-0678</td></tr>
      <tr><td><div id="MENU_DESC" class="FreeForm">
      Date & Time Filed: Dec 21 2009 12:09:14:233PM<br>
      File Number: SES-MFS-20091221-01618</div></td></tr></table>
      <FORM ACTION="dumpit.hts" NAME="TFORM" METHOD="POST">
      <strong>FCC APPLICATION FOR SPACE AND EARTH STATION</strong>
      </FORM></BODY></HTML>`;

    const response: Response = new Response(fccFormHtml, {
      status: 200,
      headers: { 'content-type': 'text/html;charset=UTF-8' },
    });
    vi.mocked(fetch).mockResolvedValueOnce(response);

    const result = await downloadFile(SERVICENOW_URL, {
      cookies: AUTH_COOKIES,
    });
    expect(result.contentType).toEqual('text/html;charset=UTF-8');
    expect(result.fileSizeBytes).toBeGreaterThan(0);
    expect(result.buffer.toString('utf-8')).toContain('FCC APPLICATION');
  });

  it('throws SessionExpiredError when response contains ServiceNow nav frame', async () => {
    const navFrameHtml: string = `<html><head><script>
      var defined_url = 'nav_to.do?uri=sys_attachment.do';
      window.location.href = '/login.do?sysparm_url=icfs';
      </script></head><body></body></html>`;

    const response: Response = new Response(navFrameHtml, {
      status: 200,
      headers: { 'content-type': 'text/html;charset=UTF-8' },
    });
    vi.mocked(fetch).mockResolvedValueOnce(response);

    await expect(
      downloadFile(SERVICENOW_URL, { cookies: AUTH_COOKIES }),
    ).rejects.toThrow(SessionExpiredError);
  });

  it('throws SessionExpiredError when response contains Okta login page', async () => {
    const oktaHtml: string = `<html><head>
      <script src="https://ok1static.oktacdn.com/signin-widget/js/main.js"></script>
      </head><body><div id="okta-login-container"></div></body></html>`;

    const response: Response = new Response(oktaHtml, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    vi.mocked(fetch).mockResolvedValueOnce(response);

    await expect(
      downloadFile(SERVICENOW_URL, { cookies: AUTH_COOKIES }),
    ).rejects.toThrow(SessionExpiredError);
  });

  it('does not check session expiry for unauthenticated downloads', async () => {
    const htmlBody: string =
      '<html><body><script>nav_to.do?uri=login</script></body></html>';
    const response: Response = new Response(htmlBody, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    vi.mocked(fetch).mockResolvedValueOnce(response);

    // Unauthenticated (no cookies) — should NOT throw SessionExpiredError
    const result = await downloadFile(
      'https://fcc.report/IBFS/SAT-STA-20230614-00142/22902690.pdf',
    );
    expect(result.buffer.toString('utf-8')).toContain('nav_to.do');
  });

  it('returns binary PDF content without session-expiry check', async () => {
    const pdfMagic: Buffer = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
    const response: Response = new Response(pdfMagic, {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
    vi.mocked(fetch).mockResolvedValueOnce(response);

    const result = await downloadFile(SERVICENOW_URL, {
      cookies: AUTH_COOKIES,
    });
    expect(result.contentType).toEqual('application/pdf');
    expect(result.fileSizeBytes).toEqual(4);
  });
});
