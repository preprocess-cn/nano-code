import { marked, type Token, type Tokens } from 'marked';
import stripAnsi from 'strip-ansi';
import { color } from '#src/plugins/display/claude-code-ink/design-system/color.js';
import { stringWidth } from '#src/plugins/display/claude-code-ink/engine/stringWidth.js';
import { supportsHyperlinks } from '#src/plugins/display/claude-code-ink/engine/supports-hyperlinks.js';

const EOL = '\n';

// Hardcoded ANSI SGR codes — chalk.level may be 0 in non-terminal envs,
// but we always need ANSI output for Ink's Ansi component to parse.
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';
const BOLD_OFF = '\x1b[22m';   // resets bold + dim
const ITALIC_OFF = '\x1b[23m';
const UNDERLINE_OFF = '\x1b[24m';

let markedConfigured = false;

export function configureMarked(): void {
  if (markedConfigured) return;
  markedConfigured = true;
  marked.use({
    tokenizer: {
      del() { return undefined; },
    },
  });
}

function createHyperlink(url: string, text?: string): string {
  const label = text ?? url;
  if (!supportsHyperlinks()) return label;
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

/**
 * Render markdown content as an ANSI string.
 */
export function applyMarkdown(
  content: string,
  theme: 'dark' | 'light',
): string {
  configureMarked();
  return marked
    .lexer(content)
    .map(t => formatToken(t, theme, 0, null, null))
    .join('')
    .trim();
}

export function formatToken(
  token: Token,
  theme: 'dark' | 'light',
  listDepth = 0,
  orderedListNumber: number | null = null,
  parent: Token | null = null,
): string {
  switch (token.type) {
    case 'blockquote': {
      const inner = (token.tokens ?? [])
        .map(t => formatToken(t, theme, 0, null, null))
        .join('');
      const bar = `${DIM}│${BOLD_OFF}`;
      return inner
        .split(EOL)
        .map(line =>
          stripAnsi(line).trim() ? `${bar} ${ITALIC}${line}${ITALIC_OFF}` : line,
        )
        .join(EOL);
    }

    case 'code': {
      return `${DIM}${token.text}${BOLD_OFF}${EOL}`;
    }

    case 'codespan': {
      return color('accent', theme)(token.text);
    }

    case 'em':
      return `${ITALIC}${
        (token.tokens ?? [])
          .map(t => formatToken(t, theme, 0, null, parent))
          .join('')
      }${ITALIC_OFF}`;

    case 'strong':
      return `${BOLD}${
        (token.tokens ?? [])
          .map(t => formatToken(t, theme, 0, null, parent))
          .join('')
      }${BOLD_OFF}`;

    case 'heading': {
      const content = (token.tokens ?? [])
        .map(t => formatToken(t, theme, 0, null, null))
        .join('');
      if (token.depth === 1) {
        return `${BOLD}${ITALIC}${UNDERLINE}${content}${UNDERLINE_OFF}${ITALIC_OFF}${BOLD_OFF}${EOL}${EOL}`;
      }
      return `${BOLD}${content}${BOLD_OFF}${EOL}${EOL}`;
    }

    case 'hr': {
      const width = Math.min(process.stdout.columns ?? 80, 40);
      return `${DIM}${'─'.repeat(width)}${BOLD_OFF}`;
    }

    case 'image':
      return token.href;

    case 'link': {
      if (token.href.startsWith('mailto:')) {
        return token.href.replace(/^mailto:/, '');
      }
      const linkText = (token.tokens ?? [])
        .map(t => formatToken(t, theme, 0, null, token))
        .join('');
      const plainText = stripAnsi(linkText);
      if (plainText && plainText !== token.href) {
        return createHyperlink(token.href, linkText);
      }
      return createHyperlink(token.href);
    }

    case 'list': {
      return token.items
        .map((item: Token, index: number) =>
          formatToken(
            item,
            theme,
            listDepth,
            token.ordered ? Number(token.start ?? 1) + index : null,
            token,
          ),
        )
        .join('');
    }

    case 'list_item':
      return (token.tokens ?? [])
        .map(t =>
          `${'  '.repeat(listDepth)}${formatToken(t, theme, listDepth + 1, orderedListNumber, token)}`,
        )
        .join('');

    case 'paragraph':
      return (
        (token.tokens ?? [])
          .map(t => formatToken(t, theme, 0, null, null))
          .join('') + EOL
      );

    case 'space':
      return EOL;

    case 'br':
      return EOL;

    case 'text':
      // Marker is added here (not in list_item) so it appears only once
      // even when the list_item has multiple child tokens (e.g. text + sub-list).
      if (parent?.type === 'list_item') {
        return `${orderedListNumber === null ? '-' : getListNumber(listDepth, orderedListNumber) + '.'} ${token.text}${EOL}`;
      }
      return token.text;

    case 'table':
      // Fallback ANSI table rendering (used when table token is not
      // intercepted by MarkdownBody's React component path).
      return renderTable(token as Tokens.Table, theme);

    case 'escape':
      return token.text;

    case 'def':
    case 'del':
    case 'html':
      return '';
  }
  return '';
}

function renderTable(tableToken: Tokens.Table, theme: 'dark' | 'light'): string {
  function displayText(tokens: Token[] | undefined): string {
    return stripAnsi(
      tokens?.map(t => formatToken(t, theme, 0, null, null)).join('') ?? '',
    );
  }

  function cellContent(tokens: Token[] | undefined): string {
    return tokens?.map(t => formatToken(t, theme, 0, null, null)).join('') ?? '';
  }

  const colWidths = tableToken.header.map((h, ci) => {
    let mw = stringWidth(displayText(h.tokens));
    for (const r of tableToken.rows) {
      mw = Math.max(mw, stringWidth(displayText(r[ci]?.tokens)));
    }
    return Math.max(mw, 3);
  });

  const tw = process.stdout.columns ?? 80;
  const totalW = colWidths.reduce((a, b) => a + b, 0) + colWidths.length * 3 + 1;
  if (totalW > tw && colWidths.length > 0) {
    const sorted = colWidths.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w);
    let rem = totalW - tw;
    for (const { w, i } of sorted) {
      if (rem <= 0) break;
      const shrink = Math.min(w - 3, rem);
      colWidths[i] -= shrink;
      rem -= shrink;
    }
  }

  let out = '';
  out += '| ';
  tableToken.header.forEach((h, ci) => {
    out += BOLD + padAligned(cellContent(h.tokens), stringWidth(displayText(h.tokens)), colWidths[ci]!, 'center') + BOLD_OFF + ' | ';
  });
  out = out.trimEnd() + EOL;
  out += '|';
  colWidths.forEach(w => { out += '-'.repeat(w + 2) + '|'; });
  out += EOL;
  tableToken.rows.forEach(row => {
    out += '| ';
    row.forEach((cell, ci) => {
      out += padAligned(cellContent(cell.tokens), stringWidth(displayText(cell.tokens)), colWidths[ci]!, tableToken.align?.[ci] ?? 'left') + ' | ';
    });
    out = out.trimEnd() + EOL;
  });
  return out + EOL;
}

export function padAligned(
  content: string,
  displayWidth: number,
  targetWidth: number,
  align: 'left' | 'center' | 'right' | null | undefined,
): string {
  const pad = Math.max(0, targetWidth - displayWidth);
  if (align === 'center') {
    const l = Math.floor(pad / 2);
    return ' '.repeat(l) + content + ' '.repeat(pad - l);
  }
  if (align === 'right') return ' '.repeat(pad) + content;
  return content + ' '.repeat(pad);
}

function numberToLetter(n: number): string {
  let r = '';
  while (n > 0) { n--; r = String.fromCharCode(97 + (n % 26)) + r; n = Math.floor(n / 26); }
  return r;
}

const ROMAN_VALUES: ReadonlyArray<[number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
  [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
  [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

function numberToRoman(n: number): string {
  let r = '';
  for (const [v, numeral] of ROMAN_VALUES) { while (n >= v) { r += numeral; n -= v; } }
  return r;
}

function getListNumber(listDepth: number, orderedListNumber: number): string {
  switch (listDepth) {
    case 0: case 1: return orderedListNumber.toString();
    case 2: return numberToLetter(orderedListNumber);
    case 3: return numberToRoman(orderedListNumber);
    default: return orderedListNumber.toString();
  }
}
