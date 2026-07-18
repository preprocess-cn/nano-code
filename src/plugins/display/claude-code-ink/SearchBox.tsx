import React from 'react';
import { Box, Text, stringWidth } from '#src/plugins/display/claude-code-ink/ink.js';
import { useDeclaredCursor } from '#src/plugins/display/claude-code-ink/engine/hooks/use-declared-cursor.js';

export interface SearchBoxProps {
  /** 当前搜索查询文本 */
  query: string;
  /** 光标位置（字符偏移） */
  cursorPos: number;
  /** 总匹配数 */
  matchCount: number;
  /** 当前匹配索引（0-based） */
  currentMatch: number;
}

/**
 * 搜索输入栏 — 替代 PromptInput，显示在底部 border box 中。
 *
 * Layout:
 *   /> query_text_here         current/total  [Esc]
 */
export function SearchBox({
  query,
  cursorPos,
  matchCount,
  currentMatch,
}: SearchBoxProps): React.ReactElement {
  // Terminal 光标定位到查询文本中的 cursorPos 位置
  const visualCol = stringWidth(query.slice(0, cursorPos));
  const cursorRef = useDeclaredCursor({
    line: 0,
    column: visualCol + 3, // " /> " = 3 列便宜
    active: true,
  });

  const matchStr = `${currentMatch + 1}/${matchCount}`;

  return React.createElement(
    Box,
    { ref: cursorRef, flexDirection: 'row', flexGrow: 1, alignItems: 'center' },
    React.createElement(Text, { bold: true, color: '#7c3aed' }, ' /> '),
    React.createElement(
      Box,
      { flexGrow: 1 },
      React.createElement(Text, null, query || ' '),
    ),
    React.createElement(Text, { dimColor: true }, `  ${matchStr}`),
    React.createElement(Text, { dimColor: true, color: '#6b7280' }, '  [Esc]'),
  );
}
