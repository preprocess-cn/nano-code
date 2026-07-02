import React, { useMemo, useRef } from 'react';
import { marked, type Token, type Tokens } from 'marked';
import { Ansi, Box } from '#src/plugins/display/claude-code-ink/ink.js';
import { configureMarked, formatToken } from '#src/plugins/display/claude-code-ink/utils/markdown.js';
import { MarkdownTable } from '#src/plugins/display/claude-code-ink/components/MarkdownTable.js';

// React.memo wrapping breaks JSX prop inference for Ansi
const AnsiBox = Ansi as React.FC<{ children?: string; dimColor?: boolean }>;

// Fast path: skip marked.lexer if no MD syntax chars
const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;

function hasMarkdownSyntax(s: string): boolean {
  return MD_SYNTAX_RE.test(s.length > 500 ? s.slice(0, 500) : s);
}

// Simple content hash for token cache (DJB2)
function hashContent(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

// Module-level token cache — avoids re-parsing identical content
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, Token[]>();

function cachedLexer(content: string): Token[] {
  if (!hasMarkdownSyntax(content)) {
    return [{
      type: 'paragraph',
      raw: content,
      text: content,
      tokens: [{ type: 'text', raw: content, text: content }],
    } as Token];
  }
  const key = hashContent(content);
  const hit = tokenCache.get(key);
  if (hit) {
    // MRU promotion
    tokenCache.delete(key);
    tokenCache.set(key, hit);
    return hit;
  }
  const tokens = marked.lexer(content);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const first = tokenCache.keys().next().value;
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(key, tokens);
  return tokens;
}

interface Props {
  children: string;
  dimColor?: boolean;
}

/**
 * Splits tokens into tables (React component) and non-tables (ANSI string).
 */
function MarkdownBody({ children, dimColor }: Props): React.ReactNode {
  const elements = useMemo(() => {
    configureMarked();
    const tokens = cachedLexer(children);
    const els: React.ReactNode[] = [];
    let nonTableAcc = '';

    function flushNonTable() {
      if (nonTableAcc) {
        els.push(
          React.createElement(AnsiBox, { key: els.length, dimColor }, nonTableAcc.trim()),
        );
        nonTableAcc = '';
      }
    }

    for (const token of tokens) {
      if (token.type === 'table') {
        flushNonTable();
        els.push(
          React.createElement(MarkdownTable, { key: els.length, token: token as Tokens.Table }),
        );
      } else {
        nonTableAcc += formatToken(token, 'dark', 0, null, null);
      }
    }
    flushNonTable();
    return els;
  }, [children, dimColor]);

  return React.createElement(Box, { flexDirection: 'column', gap: 1 }, ...elements);
}

/**
 * Renders markdown text. Tables are rendered as React components with
 * proper flexbox layout; other content is rendered as ANSI strings.
 */
export function Markdown({ children, dimColor }: Props): React.ReactNode {
  return React.createElement(MarkdownBody, { children, dimColor });
}

/**
 * Renders markdown during streaming by splitting at the last top-level
 * block boundary. Everything before is stable (memoized, never re-parsed),
 * only the final block is re-parsed per delta.
 */
export function StreamingMarkdown({ children }: { children: string }): React.ReactNode {
  configureMarked();

  const stablePrefixRef = useRef('');

  // Reset if text was replaced (unmount between turns resets this)
  if (!children.startsWith(stablePrefixRef.current)) {
    stablePrefixRef.current = '';
  }

  // Lex only from current boundary — O(unstable length), not O(full text)
  const boundary = stablePrefixRef.current.length;
  const tokens = marked.lexer(children.substring(boundary));

  // Last non-space token is the growing block; everything before is final
  let lastContentIdx = tokens.length - 1;
  while (lastContentIdx >= 0 && tokens[lastContentIdx]!.type === 'space') {
    lastContentIdx--;
  }
  let advance = 0;
  for (let i = 0; i < lastContentIdx; i++) {
    advance += tokens[i]!.raw.length;
  }
  if (advance > 0) {
    stablePrefixRef.current = children.substring(0, boundary + advance);
  }

  const stablePrefix = stablePrefixRef.current;
  const unstableSuffix = children.substring(stablePrefix.length);

  return React.createElement(
    Box,
    { flexDirection: 'column', gap: 1 },
    stablePrefix ? React.createElement(Markdown, { children: stablePrefix }) : null,
    unstableSuffix ? React.createElement(Markdown, { children: unstableSuffix }) : null,
  );
}
