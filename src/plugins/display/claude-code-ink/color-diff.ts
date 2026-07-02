import { diffArrays } from 'diff';
import { extname } from 'path';
import hljs from 'highlight.js';
import type { DiffHunk } from '#src/core/contract.js';

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript',
  '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.jsonc': 'json',
  '.py': 'python', '.pyi': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java', '.kt': 'kotlin',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'html', '.htm': 'xml',
  '.xml': 'xml', '.svg': 'xml',
  '.md': 'markdown', '.mdx': 'markdown',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml', '.ini': 'ini',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.sql': 'sql',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.vue': 'xml',
  '.svelte': 'xml',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.lua': 'lua',
  '.dart': 'dart',
  '.dockerfile': 'dockerfile',
  '.tf': 'hcl', '.tfvars': 'hcl',
};

function detectLanguage(filePath: string): string | undefined {
  const ext = extname(filePath).toLowerCase();
  if (LANG_MAP[ext]) return LANG_MAP[ext];
  const base = filePath.toLowerCase();
  if (base.endsWith('dockerfile') || base.endsWith('dockerfile')) return 'dockerfile';
  if (base.endsWith('makefile')) return 'makefile';
  return undefined;
}

// ---------------------------------------------------------------------------
// ANSI escape helpers
// ---------------------------------------------------------------------------

interface Rgb { r: number; g: number; b: number }

function bgEscape(c: Rgb): string {
  return `\x1b[48;2;${c.r};${c.g};${c.b}m`;
}

function fgEscape(c: Rgb): string {
  return `\x1b[38;2;${c.r};${c.g};${c.b}m`;
}

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

// Diff colors (Claude Code dark theme)
const DIFF_ADDED: Rgb = { r: 105, g: 219, b: 124 };       // #69db7c
const DIFF_ADDED_WORD: Rgb = { r: 47, g: 157, b: 68 };     // #2f9d44
const DIFF_REMOVED: Rgb = { r: 255, g: 168, b: 180 };      // #ffa8b4
const DIFF_REMOVED_WORD: Rgb = { r: 209, g: 69, b: 75 };    // #d1454b

// Syntax scope → foreground RGB (Monokai Extended, measured from syntect output)
const SCOPE_FG: Record<string, Rgb> = {
  'keyword': { r: 249, g: 38, b: 114 },
  'string': { r: 230, g: 219, b: 116 },
  'number': { r: 190, g: 132, b: 255 },
  'literal': { r: 190, g: 132, b: 255 },
  'type': { r: 166, g: 226, b: 46 },
  'built_in': { r: 166, g: 226, b: 46 },
  'title': { r: 166, g: 226, b: 46 },
  'comment': { r: 117, g: 113, b: 94 },
  'meta': { r: 248, g: 248, b: 242 },
  'params': { r: 253, g: 151, b: 31 },
  'attr': { r: 166, g: 226, b: 46 },
  'selector-class': { r: 166, g: 226, b: 46 },
  'selector-tag': { r: 249, g: 38, b: 114 },
  'selector-attr': { r: 166, g: 226, b: 46 },
  'selector-pseudo': { r: 166, g: 226, b: 46 },
  'variable': { r: 248, g: 248, b: 242 },
  'regexp': { r: 230, g: 219, b: 116 },
  'subst': { r: 248, g: 248, b: 242 },
  'name': { r: 248, g: 248, b: 242 },
  'operator': { r: 249, g: 38, b: 114 },
  'punctuation': { r: 248, g: 248, b: 242 },
  'doctag': { r: 230, g: 219, b: 116 },
  'section': { r: 230, g: 219, b: 116 },
  'strong': { r: 249, g: 38, b: 114 },
  'emphasis': { r: 248, g: 248, b: 242 },
  'addition': { r: 166, g: 226, b: 46 },
  'deletion': { r: 249, g: 38, b: 114 },
};

// Fallback foreground (terminal default)
const DEFAULT_FG: Rgb = { r: 248, g: 248, b: 242 };

// ---------------------------------------------------------------------------
// highlight.js HTML output → ANSI string
// ---------------------------------------------------------------------------

function hljsHtmlToAnsi(html: string): string {
  // highlight.js output: <span class="hljs-keyword">import</span> ...
  const parts: string[] = [];
  let rest = html;
  let defaultFg = true;

  while (rest.length > 0) {
    const tagStart = rest.indexOf('<span class="');
    if (tagStart === -1) {
      // Remainder is plain text
      if (defaultFg) {
        parts.push(rest);
      } else {
        parts.push(fgEscape(DEFAULT_FG) + rest);
      }
      break;
    }

    // Emit text before this tag
    if (tagStart > 0) {
      const pre = rest.slice(0, tagStart);
      if (defaultFg) {
        parts.push(pre);
      } else {
        parts.push(fgEscape(DEFAULT_FG) + pre);
      }
      defaultFg = true;
    }

    // Find the span class
    const classEnd = rest.indexOf('">', tagStart);
    const classStr = rest.slice(tagStart + 16, classEnd).split(' ')[0]!;
    const scope = classStr.replace('hljs-', '');

    // Find the closing </span>
    const closeTag = '</span>';
    const closeIdx = rest.indexOf(closeTag, classEnd);
    const text = rest.slice(classEnd + 2, closeIdx);

    const color = SCOPE_FG[scope];
    if (color) {
      parts.push(fgEscape(color) + text);
      defaultFg = false;
    } else {
      parts.push(text);
      defaultFg = true;
    }

    rest = rest.slice(closeIdx + closeTag.length);
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Code highlighting
// ---------------------------------------------------------------------------

function highlightCode(code: string, lang: string | undefined): string {
  if (!lang) return code;

  let result: { value: string };
  try {
    if (hljs.getLanguage(lang)) {
      result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
    } else {
      result = hljs.highlightAuto(code);
    }
  } catch {
    return code;
  }

  return hljsHtmlToAnsi(result.value);
}

// ---------------------------------------------------------------------------
// Word-level diff (aligns with Claude Code fallback)
// ---------------------------------------------------------------------------

interface Range { start: number; end: number }

const CHANGE_THRESHOLD = 0.4;

function wordDiffStrings(oldStr: string, newStr: string): [Range[], Range[]] {
  const oldTokens = tokenize(oldStr);
  const newTokens = tokenize(newStr);
  const ops = diffArrays(oldTokens, newTokens);

  const totalLen = oldStr.length + newStr.length;
  let changedLen = 0;
  const oldRanges: Range[] = [];
  const newRanges: Range[] = [];
  let oldOff = 0;
  let newOff = 0;

  for (const op of ops) {
    const len = op.value.reduce((s: number, t: string) => s + t.length, 0);
    if (op.removed) {
      changedLen += len;
      oldRanges.push({ start: oldOff, end: oldOff + len });
      oldOff += len;
    } else if (op.added) {
      changedLen += len;
      newRanges.push({ start: newOff, end: newOff + len });
      newOff += len;
    } else {
      oldOff += len;
      newOff += len;
    }
  }

  if (totalLen > 0 && changedLen / totalLen > CHANGE_THRESHOLD) {
    return [[], []];
  }
  return [oldRanges, newRanges];
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/[\p{L}\p{N}_]/u.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[\p{L}\p{N}_]/u.test(text[j]!)) j++;
      tokens.push(text.slice(i, j));
      i = j;
    } else if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      tokens.push(text.slice(i, j));
      i = j;
    } else {
      const cp = text.codePointAt(i)!;
      const len = cp > 0xffff ? 2 : 1;
      tokens.push(text.slice(i, i + len));
      i += len;
    }
  }
  return tokens;
}

type Marker = '+' | '-' | ' ';

function findAdjacentPairs(markers: Marker[]): [number, number][] {
  const pairs: [number, number][] = [];
  let i = 0;
  while (i < markers.length) {
    if (markers[i] === '-') {
      const delStart = i;
      let delEnd = i;
      while (delEnd < markers.length && markers[delEnd] === '-') delEnd++;
      let addEnd = delEnd;
      while (addEnd < markers.length && markers[addEnd] === '+') addEnd++;
      const delCount = delEnd - delStart;
      const addCount = addEnd - delEnd;
      if (delCount > 0 && addCount > 0) {
        const n = Math.min(delCount, addCount);
        for (let k = 0; k < n; k++) {
          pairs.push([delStart + k, delEnd + k]);
        }
        i = addEnd;
      } else {
        i = delEnd;
      }
    } else {
      i++;
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Line wrapping
// ---------------------------------------------------------------------------

function stringWidth(s: string): number {
  // Simple implementation: count characters, treat CJK as width 2
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff01 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x2fffd) || (cp >= 0x30000 && cp <= 0x3fffd))) {
      w += 2;
    } else if (ch === '\x1b') {
      // Skip ANSI escape sequences in width calculation
      // They shouldn't be here at this point, but be safe
    } else {
      w += 1;
    }
  }
  return w;
}

function wrapToWidth(line: string, width: number): string[] {
  if (width <= 0) return [line];
  const result: string[] = [];

  // Split off ANSI escapes to measure content width
  let current = '';
  let currentW = 0;
  let i = 0;
  while (i < line.length) {
    // Check for ANSI escape sequence
    if (line[i] === '\x1b') {
      const escEnd = line.indexOf('m', i);
      if (escEnd !== -1) {
        const esc = line.slice(i, escEnd + 1);
        current += esc;
        i = escEnd + 1;
        continue;
      }
    }

    const ch = line[i]!;
    const cw = stringWidth(ch);
    if (currentW + cw > width) {
      if (currentW === 0) {
        // Force at least one char on empty line
        current += ch;
        currentW += cw;
        i++;
      }
      result.push(current);
      current = '';
      currentW = 0;
    } else {
      current += ch;
      currentW += cw;
      i++;
    }
  }
  if (currentW > 0) result.push(current);
  return result.length > 0 ? result : [''];
}

// ---------------------------------------------------------------------------
// ColorDiff
// ---------------------------------------------------------------------------

export class ColorDiff {
  private hunks: DiffHunk[];
  private filePath: string;

  constructor(hunks: DiffHunk[], filePath: string) {
    this.hunks = hunks;
    this.filePath = filePath;
  }

  render(_themeName: string, width: number, dim: boolean): string[] | null {
    const lang = detectLanguage(this.filePath);

    // Collect all entries (line + marker + number)
    interface Entry {
      lineNumber: number;
      marker: Marker;
      code: string;
    }

    const entries: Entry[] = [];
    for (const hunk of this.hunks) {
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      for (const dline of hunk.lines) {
        let lineNumber = 0;
        switch (dline.type) {
          case 'add':
            lineNumber = newLine++;
            break;
          case 'remove':
            lineNumber = oldLine++;
            break;
          case 'context':
            lineNumber = newLine;
            oldLine++;
            newLine++;
            break;
        }
        entries.push({
          lineNumber,
          marker: dline.type === 'add' ? '+' : dline.type === 'remove' ? '-' : ' ',
          code: dline.content,
        });
      }
    }

    // Max line number width
    const maxDigits = String(
      Math.max(...entries.map(e => e.lineNumber), 0),
    ).length;
    const effectiveWidth = Math.max(20, width - maxDigits - 2 - 1);

    // Word-diff ranges
    const ranges: Range[][] = entries.map(() => []);
    if (!dim) {
      const markers = entries.map(e => e.marker);
      for (const [delIdx, addIdx] of findAdjacentPairs(markers)) {
        const [delR, addR] = wordDiffStrings(
          entries[delIdx]!.code,
          entries[addIdx]!.code,
        );
        ranges[delIdx] = delR;
        ranges[addIdx] = addR;
      }
    }

    // Render each line
    const maxLineNum = Math.max(...entries.map(e => e.lineNumber), 0);
    const numWidth = String(maxLineNum).length;

    const out: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const { lineNumber, marker, code } = entries[i]!;
      const range = ranges[i]!;
      const bgColor = marker === '+' ? DIFF_ADDED : marker === '-' ? DIFF_REMOVED : null;

      // Build line with line number, marker, and syntax-highlighted code
      const lineNumStr = String(lineNumber).padStart(numWidth);
      const linePrefix = dim ? DIM : RESET;

      // Line number + marker (left column)
      const gutter = ` ${lineNumStr} ${marker} `;

      // Code part: syntax highlight, then apply word-diff colors
      let codeAnsi = dim ? DIM : RESET;
      codeAnsi += bgColor ? bgEscape(bgColor) : '';

      if (range.length > 0) {
        // Word-level diff: different bg for changed words
        const wordBg = marker === '-' ? DIFF_REMOVED_WORD : DIFF_ADDED_WORD;
        const baseBg = bgColor!;
        let pos = 0;
        let ri = 0;
        while (pos < code.length) {
          const r = range[ri];
          if (r && pos >= r.start && pos < r.end) {
            // Changed word — use darker bg
            const end = r.end;
            const chunk = code.slice(pos, end);
            codeAnsi += bgEscape(wordBg) + chunk + bgEscape(baseBg);
            pos = end;
            ri++;
          } else if (r && pos < r.start) {
            const end = r.start;
            const chunk = highlightCode(code.slice(pos, end), lang);
            codeAnsi += chunk;
            pos = end;
          } else {
            const chunk = highlightCode(code.slice(pos), lang);
            codeAnsi += chunk;
            pos = code.length;
          }
        }
      } else {
        codeAnsi += highlightCode(code, lang);
      }

      const fullLine = linePrefix + gutter + codeAnsi + RESET;
      out.push(...wrapToWidth(fullLine, width));
    }

    return out.length > 0 ? out : null;
  }
}

// ---------------------------------------------------------------------------
// ColorFile (new file — all-add display, no diff markers)
// ---------------------------------------------------------------------------

export class ColorFile {
  private code: string;
  private filePath: string;

  constructor(code: string, filePath: string) {
    this.code = code;
    this.filePath = filePath;
  }

  render(_themeName: string, width: number, dim: boolean): string[] | null {
    const lang = detectLanguage(this.filePath);
    const lines = this.code.split('\n');

    const maxDigits = String(lines.length).length;
    const numWidth = maxDigits;

    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lineNumStr = String(i + 1).padStart(numWidth);
      const gutter = ` ${lineNumStr}  `;
      const codeAnsi = highlightCode(lines[i]!, lang);
      const fullLine = (dim ? DIM : RESET) + gutter + codeAnsi + RESET;
      out.push(...wrapToWidth(fullLine, width));
    }

    return out.length > 0 ? out : null;
  }
}

// ---------------------------------------------------------------------------
// getSyntaxTheme — API parity with Claude Code
// ---------------------------------------------------------------------------

export function getSyntaxTheme(themeName: string): { theme: string; source: string | null } {
  if (themeName.includes('dark')) return { theme: 'Monokai Extended', source: null };
  return { theme: 'GitHub', source: null };
}
