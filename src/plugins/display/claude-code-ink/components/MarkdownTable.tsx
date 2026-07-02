import React from 'react';
import type { Token, Tokens } from 'marked';
import stripAnsi from 'strip-ansi';
import { stringWidth } from '#src/plugins/display/claude-code-ink/engine/stringWidth.js';
import { wrapAnsi } from '#src/plugins/display/claude-code-ink/engine/wrapAnsi.js';
import { Ansi } from '#src/plugins/display/claude-code-ink/engine/Ansi.js';
import { formatToken, padAligned } from '#src/plugins/display/claude-code-ink/utils/markdown.js';

/** Margin to prevent overflow from layout race conditions. */
const SAFETY_MARGIN = 4;

/** Minimum column width. */
const MIN_COLUMN_WIDTH = 3;

/** Max row lines before switching to vertical format. */
const MAX_ROW_LINES = 4;

const ANSI_BOLD_START = '\x1b[1m';
const ANSI_BOLD_END = '\x1b[22m';

interface Props {
  token: Tokens.Table;
  forceWidth?: number;
}

function wrapText(text: string, width: number, options?: {
  hard?: boolean;
}): string[] {
  if (width <= 0) return [text];
  const trimmed = text.trimEnd();
  const wrapped = wrapAnsi(trimmed, width, {
    hard: options?.hard ?? false,
    trim: false,
    wordWrap: true,
  });
  const lines = wrapped.split('\n').filter(l => l.length > 0);
  return lines.length > 0 ? lines : [''];
}

export function MarkdownTable({ token, forceWidth }: Props): React.ReactNode {
  const terminalWidth = forceWidth ?? (process.stdout.columns ?? 80);

  function formatCell(tokens: Token[] | undefined): string {
    return tokens?.map(t => formatToken(t, 'dark', 0, null, null)).join('') ?? '';
  }

  function getPlainText(tokens: Token[] | undefined): string {
    return stripAnsi(formatCell(tokens));
  }

  function getMinWidth(tokens: Token[] | undefined): number {
    const text = getPlainText(tokens);
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return MIN_COLUMN_WIDTH;
    return Math.max(...words.map(w => stringWidth(w)), MIN_COLUMN_WIDTH);
  }

  function getIdealWidth(tokens: Token[] | undefined): number {
    return Math.max(stringWidth(getPlainText(tokens)), MIN_COLUMN_WIDTH);
  }

  // Step 1: Min and ideal column widths
  const minWidths = token.header.map((h, ci) => {
    let mw = getMinWidth(h.tokens);
    for (const row of token.rows) mw = Math.max(mw, getMinWidth(row[ci]?.tokens));
    return mw;
  });
  const idealWidths = token.header.map((h, ci) => {
    let mw = getIdealWidth(h.tokens);
    for (const row of token.rows) mw = Math.max(mw, getIdealWidth(row[ci]?.tokens));
    return mw;
  });

  // Step 2: Available width
  const numCols = token.header.length;
  const borderOverhead = 1 + numCols * 3;
  const availableWidth = Math.max(
    terminalWidth - borderOverhead - SAFETY_MARGIN,
    numCols * MIN_COLUMN_WIDTH,
  );

  // Step 3: Distribute column widths
  const totalMin = minWidths.reduce((s, w) => s + w, 0);
  const totalIdeal = idealWidths.reduce((s, w) => s + w, 0);

  let needsHardWrap = false;
  let columnWidths: number[];

  if (totalIdeal <= availableWidth) {
    columnWidths = idealWidths;
  } else if (totalMin <= availableWidth) {
    const extra = availableWidth - totalMin;
    const overflows = idealWidths.map((iw, i) => iw - minWidths[i]!);
    const totalOverflow = overflows.reduce((s, o) => s + o, 0);
    columnWidths = minWidths.map((min, i) => {
      if (totalOverflow === 0) return min;
      return min + Math.floor(overflows[i]! / totalOverflow * extra);
    });
  } else {
    needsHardWrap = true;
    const scale = availableWidth / totalMin;
    columnWidths = minWidths.map(w => Math.max(Math.floor(w * scale), MIN_COLUMN_WIDTH));
  }

  // Step 4: Check if we need vertical format
  function calcMaxRowLines(): number {
    let max = 1;
    for (let i = 0; i < token.header.length; i++) {
      const c = formatCell(token.header[i]!.tokens);
      max = Math.max(max, wrapText(c, columnWidths[i]!, { hard: needsHardWrap }).length);
    }
    for (const row of token.rows) {
      for (let i = 0; i < row.length; i++) {
        const c = formatCell(row[i]?.tokens);
        max = Math.max(max, wrapText(c, columnWidths[i]!, { hard: needsHardWrap }).length);
      }
    }
    return max;
  }

  const maxRowLines = calcMaxRowLines();
  const useVerticalFormat = maxRowLines > MAX_ROW_LINES;

  // Render a single row as multi-line ANSI strings
  function renderRowLines(cells: Array<{ tokens?: Token[] }>, isHeader: boolean): string[] {
    const cellLines = cells.map((cell, ci) => {
      return wrapText(formatCell(cell.tokens), columnWidths[ci]!, { hard: needsHardWrap });
    });

    const maxLines = Math.max(...cellLines.map(ll => ll.length), 1);
    const offsets = cellLines.map(ll => Math.floor((maxLines - ll.length) / 2));

    const result: string[] = [];
    for (let li = 0; li < maxLines; li++) {
      let line = '│';
      for (let ci = 0; ci < cells.length; ci++) {
        const ll = cellLines[ci]!;
        const off = offsets[ci]!;
        const contentIdx = li - off;
        const text = contentIdx >= 0 && contentIdx < ll.length ? ll[contentIdx]! : '';
        const w = columnWidths[ci]!;
        const align = isHeader ? 'center' : (token.align?.[ci] ?? 'left');
        line += ' ' + padAligned(text, stringWidth(text), w, align) + ' │';
      }
      result.push(line);
    }
    return result;
  }

  function renderBorderLine(type: 'top' | 'middle' | 'bottom'): string {
    const [left, mid, cross, right] = {
      top: ['┌', '─', '┬', '┐'],
      middle: ['├', '─', '┼', '┤'],
      bottom: ['└', '─', '┴', '┘'],
    }[type] as [string, string, string, string];

    let line = left;
    columnWidths.forEach((w, ci) => {
      line += mid.repeat(w + 2);
      line += ci < columnWidths.length - 1 ? cross : right;
    });
    return line;
  }

  // Vertical format for narrow terminals
  function renderVerticalFormat(): string {
    const lines: string[] = [];
    const headers = token.header.map(h => getPlainText(h.tokens));
    const separatorWidth = Math.min(terminalWidth - 1, 40);
    const separator = '─'.repeat(separatorWidth);
    const wrapIndent = '  ';

    token.rows.forEach((row, ri) => {
      if (ri > 0) lines.push(separator);
      row.forEach((cell, ci) => {
        const label = headers[ci] || `Column ${ci + 1}`;
        const rawValue = formatCell(cell.tokens).trimEnd();
        const value = rawValue.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
        const firstLineWidth = terminalWidth - stringWidth(label) - 3;
        const subWidth = terminalWidth - wrapIndent.length - 1;
        const firstPass = wrapText(value, Math.max(firstLineWidth, 10));
        const firstLine = firstPass[0] || '';
        let wrappedValue: string[];
        if (firstPass.length <= 1 || subWidth <= firstLineWidth) {
          wrappedValue = firstPass;
        } else {
          const remaining = firstPass.slice(1).map(l => l.trim()).join(' ');
          wrappedValue = [firstLine, ...wrapText(remaining, subWidth)];
        }
        lines.push(`${ANSI_BOLD_START}${label}:${ANSI_BOLD_END} ${wrappedValue[0] || ''}`);
        for (let i = 1; i < wrappedValue.length; i++) {
          const l = wrappedValue[i]!;
          if (!l.trim()) continue;
          lines.push(`${wrapIndent}${l}`);
        }
      });
    });
    return lines.join('\n');
  }

  if (useVerticalFormat) {
    return React.createElement(Ansi, null, renderVerticalFormat());
  }

  const tableLines: string[] = [];
  tableLines.push(renderBorderLine('top'));
  tableLines.push(...renderRowLines(token.header, true));
  tableLines.push(renderBorderLine('middle'));
  token.rows.forEach((row, ri) => {
    tableLines.push(...renderRowLines(row, false));
    if (ri < token.rows.length - 1) tableLines.push(renderBorderLine('middle'));
  });
  tableLines.push(renderBorderLine('bottom'));

  // Safety check for terminal resize races
  const maxLineWidth = Math.max(...tableLines.map(l => stringWidth(stripAnsi(l))));
  if (maxLineWidth > terminalWidth - SAFETY_MARGIN) {
    return React.createElement(Ansi, null, renderVerticalFormat());
  }

  return React.createElement(Ansi, null, tableLines.join('\n'));
}
