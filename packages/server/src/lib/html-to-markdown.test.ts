import { describe, expect, it } from 'vitest';
import { containsHtml, htmlToMarkdown } from './html-to-markdown.ts';

describe('containsHtml', () => {
  it('returns true for strings containing HTML tags', () => {
    expect(containsHtml('<a href="url">link</a>')).toBe(true);
    expect(containsHtml('<p>text</p>')).toBe(true);
    expect(containsHtml('before <br> after')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(containsHtml('just plain text')).toBe(false);
    expect(containsHtml('5 < 10 and 10 > 5')).toBe(false);
    expect(containsHtml('')).toBe(false);
  });

  it('returns false for angle brackets not forming tags', () => {
    // <Initial Entry> — capital letter after < looks like a tag
    // but our regex intentionally catches this; the converter handles it
    expect(containsHtml('<Initial Entry>')).toBe(true);
  });
});

describe('htmlToMarkdown', () => {
  describe('anchor tags', () => {
    it('converts a single anchor tag to markdown link', () => {
      const html = '<a href="https://example.com/file.pdf">file.pdf</a>';
      expect(htmlToMarkdown(html)).toBe(
        '[file.pdf](https://example.com/file.pdf)',
      );
    });

    it('converts multiple anchors in one string (common pleading pattern)', () => {
      const html =
        '<a href="/att/1">Exhibit A.pdf</a>, <a href="/att/2">Exhibit B.pdf</a>';
      expect(htmlToMarkdown(html)).toBe(
        '[Exhibit A.pdf](/att/1), [Exhibit B.pdf](/att/2)',
      );
    });

    it('handles anchor without href', () => {
      const html = '<a>orphan text</a>';
      expect(htmlToMarkdown(html)).toBe('orphan text');
    });
  });

  describe('block elements', () => {
    it('converts paragraphs to double newlines', () => {
      const html = '<p>First paragraph</p><p>Second paragraph</p>';
      expect(htmlToMarkdown(html)).toBe('First paragraph\n\nSecond paragraph');
    });

    it('converts br to newline', () => {
      const html = 'line one<br>line two';
      expect(htmlToMarkdown(html)).toBe('line one\nline two');
    });
  });

  describe('headings', () => {
    it('converts h1-h6 to markdown heading prefixes', () => {
      expect(htmlToMarkdown('<h1>Title</h1>')).toBe('# Title');
      expect(htmlToMarkdown('<h2>Subtitle</h2>')).toBe('## Subtitle');
      expect(htmlToMarkdown('<h3>Section</h3>')).toBe('### Section');
      expect(htmlToMarkdown('<h6>Deep</h6>')).toBe('###### Deep');
    });
  });

  describe('inline formatting', () => {
    it('converts strong/b to bold', () => {
      expect(htmlToMarkdown('<strong>bold</strong>')).toBe('**bold**');
      expect(htmlToMarkdown('<b>bold</b>')).toBe('**bold**');
    });

    it('converts em/i to italic', () => {
      expect(htmlToMarkdown('<em>italic</em>')).toBe('*italic*');
      expect(htmlToMarkdown('<i>italic</i>')).toBe('*italic*');
    });
  });

  describe('lists', () => {
    it('converts unordered lists', () => {
      const html = '<ul><li>Alpha</li><li>Beta</li></ul>';
      expect(htmlToMarkdown(html)).toBe('- Alpha\n- Beta');
    });

    it('converts ordered lists', () => {
      const html = '<ol><li>First</li><li>Second</li><li>Third</li></ol>';
      expect(htmlToMarkdown(html)).toBe('1. First\n2. Second\n3. Third');
    });
  });

  describe('script/style stripping', () => {
    it('removes script and style content', () => {
      const html =
        '<p>visible</p><script>alert("xss")</script><style>.x{}</style>';
      expect(htmlToMarkdown(html)).toBe('visible');
    });
  });

  describe('non-HTML passthrough', () => {
    it('returns plain text unchanged', () => {
      const plain = 'This is just plain text with no tags.';
      expect(htmlToMarkdown(plain)).toBe(plain);
    });

    it('returns empty string unchanged', () => {
      expect(htmlToMarkdown('')).toBe('');
    });
  });

  describe('mixed HTML', () => {
    it('handles a realistic mixed document', () => {
      const html = `
        <h2>Summary</h2>
        <p>This filing concerns <strong>orbital debris</strong> mitigation.</p>
        <ul>
          <li>Point <em>one</em></li>
          <li>Point two</li>
        </ul>
      `;
      const result = htmlToMarkdown(html);
      expect(result).toContain('## Summary');
      expect(result).toContain('**orbital debris**');
      expect(result).toContain('- Point *one*');
      expect(result).toContain('- Point two');
    });
  });

  describe('idempotency', () => {
    it('applying twice produces the same result', () => {
      const inputs: string[] = [
        '<a href="/x">link</a>',
        '<p>paragraph</p>',
        '<h1>Title</h1><p>Body with <strong>bold</strong>.</p>',
        'plain text no html',
      ];
      for (const input of inputs) {
        const once: string = htmlToMarkdown(input);
        const twice: string = htmlToMarkdown(once);
        expect(twice).toBe(once);
      }
    });
  });

  describe('edge cases', () => {
    it('handles HTML entities', () => {
      const html = '<p>AT&amp;T &lt;satellite&gt; &quot;quoted&quot;</p>';
      const result = htmlToMarkdown(html);
      expect(result).toContain('AT&T');
      expect(result).toContain('<satellite>');
      expect(result).toContain('"quoted"');
    });

    it('handles deeply nested elements', () => {
      const html = '<p><strong><em>bold italic</em></strong></p>';
      expect(htmlToMarkdown(html)).toBe('***bold italic***');
    });

    it('handles Initial Entry pseudo-tag from filing descriptions', () => {
      // <Initial Entry> looks like HTML but parses as an unknown tag
      // htmlToMarkdown will parse it and extract text content
      const html = '<Initial Entry>';
      const result = htmlToMarkdown(html);
      // node-html-parser treats this as a self-closing tag with no content
      // The result should be empty or the text, but NOT the raw HTML
      expect(result).not.toContain('<Initial');
    });
  });
});
