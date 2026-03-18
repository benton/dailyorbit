import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Quick check for whether a string contains HTML tags.
 */
export function containsHtml(text: string): boolean {
  return /<[a-zA-Z]/.test(text);
}

/**
 * Convert an HTML string to Markdown. Returns the input unchanged if it
 * contains no HTML tags (safe to re-run / idempotent).
 *
 * Handles: a, p, br, h1-h6, strong/b, em/i, ul/ol/li, blockquote, pre/code.
 * Strips: script, style, noscript.
 * Everything else: extract text content.
 */
export function htmlToMarkdown(html: string): string {
  if (!containsHtml(html)) {
    return html;
  }

  const root: HTMLElement = parse(html);

  // Strip non-content elements
  for (const selector of ['script', 'style', 'noscript']) {
    for (const el of root.querySelectorAll(selector)) {
      el.remove();
    }
  }

  const result: string = convertNode(root);

  // Collapse excessive whitespace: 3+ newlines → 2, trailing spaces on lines
  return result
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function convertNode(node: HTMLElement): string {
  const parts: string[] = [];

  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      // Text node
      parts.push(child.text);
    } else if (child.nodeType === 1) {
      const el: HTMLElement = child as HTMLElement;
      parts.push(convertElement(el));
    }
  }

  return parts.join('');
}

function convertElement(el: HTMLElement): string {
  const tag: string = el.tagName?.toLowerCase() ?? '';

  switch (tag) {
    case 'a': {
      const href: string = el.getAttribute('href') ?? '';
      const text: string = convertNode(el).trim();
      if (href && text) {
        return `[${text}](${href})`;
      }
      return text;
    }

    case 'p':
    case 'div':
      return `\n\n${convertNode(el)}\n\n`;

    case 'br':
      return '\n';

    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level: number = parseInt(tag[1]!, 10);
      const prefix: string = '#'.repeat(level);
      return `\n\n${prefix} ${convertNode(el).trim()}\n\n`;
    }

    case 'strong':
    case 'b':
      return `**${convertNode(el)}**`;

    case 'em':
    case 'i':
      return `*${convertNode(el)}*`;

    case 'ul':
      return `\n\n${convertList(el, false)}\n\n`;

    case 'ol':
      return `\n\n${convertList(el, true)}\n\n`;

    case 'li':
      return convertNode(el).trim();

    case 'blockquote':
      return `\n\n${convertNode(el).trim().replace(/^/gm, '> ')}\n\n`;

    case 'pre': {
      const code: string = convertNode(el).trim();
      return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
    }

    case 'code':
      return `\`${convertNode(el)}\``;

    default:
      return convertNode(el);
  }
}

function convertList(el: HTMLElement, ordered: boolean): string {
  const items: string[] = [];
  let index: number = 1;

  for (const child of el.childNodes) {
    if (child.nodeType === 1) {
      const childEl: HTMLElement = child as HTMLElement;
      if (childEl.tagName?.toLowerCase() === 'li') {
        const prefix: string = ordered ? `${String(index)}. ` : '- ';
        items.push(`${prefix}${convertNode(childEl).trim()}`);
        index++;
      }
    }
  }

  return items.join('\n');
}
