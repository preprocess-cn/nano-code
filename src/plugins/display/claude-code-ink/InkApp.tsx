import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput, useStdin, ThemeProvider, stringWidth, RawAnsi, useAnimationFrame } from '#src/plugins/display/claude-code-ink/ink.js';
import { AlternateScreen } from '#src/plugins/display/claude-code-ink/engine/components/AlternateScreen.js';
import ScrollBox, { type ScrollBoxHandle } from '#src/plugins/display/claude-code-ink/engine/components/ScrollBox.js';
import { useDeclaredCursor } from '#src/plugins/display/claude-code-ink/engine/hooks/use-declared-cursor.js';
import { ColorDiff } from '#src/plugins/display/claude-code-ink/color-diff.js';
import { Markdown, StreamingMarkdown } from '#src/plugins/display/claude-code-ink/components/Markdown.js';
import { BackgroundTaskBar } from '#src/plugins/display/claude-code-ink/components/BackgroundTaskBar.js';
import { AgentTrackerBar } from '#src/plugins/display/claude-code-ink/components/AgentTrackerBar.js';
import { SpinnerWithVerb } from '#src/plugins/display/claude-code-ink/SpinnerWithVerb.js';
import type { DiffHunk, ContextAnalysis } from '#src/core/contract.js';
import { QuestionsDialog } from './QuestionsDialog.js';
import { StatusBar } from './components/StatusBar.js';

export type PermissionResponse = 'allow_once' | 'always_allow' | 'deny';

export interface TextSegment {
  text: string;
  dim?: boolean;
}

export interface UIMessage {
  agentName: string;
  text: string;
  kind: 'stream' | 'thinking' | 'status' | 'info' | 'toolCall' | 'toolResult' | 'error' | 'userInput' | 'warn' | 'success' | 'turnComplete';
  segments?: TextSegment[];
  contextAnalysis?: ContextAnalysis;
  toolStatus?: 'running' | 'success' | 'error';
}


/**
 * Ink 插件内部用于追踪子 Agent 运行状态的接口。
 * 定义在此处而非 contract.ts，因为它是 Ink display 私有的 UI 数据类型。
 */
export interface AgentRuntimeState {
  /** 从 agentName 提取的类型名，如 'explore' */
  type: string;
  /** 完整 agentName，如 'explore_sync_abc123' */
  fullName: string;
  status: 'running' | 'completed' | 'error';
  startTime: number;
  endTime?: number;
  toolUseCount: number;
  lastToolName?: string;
  /** 任务描述（用户输入的 query） */
  query?: string;
}

/** CC 兼容的 8 色调色板（agent type 名 → 颜色） */
export const AGENT_COLORS: Record<string, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#eab308',
  purple: '#8b5cf6',
  orange: '#f97316',
  pink: '#ec4899',
  cyan: '#06b6d4',
};

/** 内置 agent 的预分配颜色（CC 风格：相同 type 的所有实例颜色一致） */
const BUILTIN_AGENT_COLORS: Record<string, string> = {
  explore: AGENT_COLORS.cyan,
};

/** 根据 agent type 名分配稳定颜色，默认 cyan（CC 的 DEFAULT_AGENT_THEME_COLOR） */
export function getAgentColor(type: string): string {
  return BUILTIN_AGENT_COLORS[type] || AGENT_COLORS.cyan;
}

export interface PermissionPrompt {
  toolName: string;
  displayName?: string;
  message: string;
  details?: string;
  diff?: DiffHunk[];
  filePath?: string;
}

export interface CommandSuggestion {
  name: string;
  description: string;
  type: 'builtin' | 'skill' | 'agent';
}

export interface BackgroundTaskInfo {
  taskId: string;
  agentName: string;
  status: 'running' | 'completed' | 'error';
  message: string;
}

export interface InkAppProps {
  greeting: string;
  messages: UIMessage[];
  inputBuffer: string;
  onInputChange: (text: string) => void;
  onInputSubmit: (text: string) => void;
  onExit: () => void;
  suggestions?: CommandSuggestion[];
  activeAgentName?: string;
  pendingPermission?: PermissionPrompt | null;
  onPermissionResponse?: (response: PermissionResponse) => void;
  pendingQuestions?: { questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string; preview?: string }>; multiSelect?: boolean }>; resolve: (answers: Record<string, string>) => void } | null;
  onQuestionsResponse?: (answers: Record<string, string>) => void;
  mode?: 'normal' | 'plan';
  taskCount?: number;
  backgroundTasks?: BackgroundTaskInfo[];
  /** 当前查看的 agent（非 main 时切换到对应 agent 的页面） */
  viewAgent?: string;
  /** 可用视图列表（@ 命令切换用） */
  viewAgents?: { name: string; label: string }[];
  /** 切换视图 */
  onViewAgentChange?: (name: string) => void;
  /** 返回主视图 */
  onViewAgentClear?: () => void;
  /** Shift+Tab 切换 normal/plan 模式 */
  onModeToggle?: () => void;

  /** 状态栏左侧段落（KEY: VALUE） */
  statusSegments?: Record<string, string>;
  /** 状态栏右侧通知消息 */
  notification?: { source: string; message: string } | null;

  /** LLM 执行状态 */
  llmStatus?: 'idle' | 'running';
  /** LLM 本轮开始时间戳 */
  llmStartTime?: number;
  /** LLM 本轮累积 token */
  turnTokens?: number;
  /** 最近一次 LLM 活动时间戳（流分片/工具调用），用于 stalled 检测 */
  llmLastTokenTime?: number;

  /** agentName → 颜色映射 */
  agentColorMap?: Record<string, string>;
  /** 子 Agent 运行时状态列表（由 index.ts 维护） */
  agentStates?: AgentRuntimeState[];
}

function AgentLabel({ agentName, color }: { agentName: string; color?: string }): React.ReactElement | null {
  if (agentName === 'main') return null;
  const agentColor = color || undefined;
  return React.createElement(
    Text,
    agentColor ? { color: agentColor } : { dimColor: true },
    `[${agentName}] `,
  );
}

/** 工具调用状态指示器 — CC black-circle 风格 */
function ToolCallIndicator({ status }: { status: 'running' | 'success' | 'error' }): React.ReactElement {
  const [ref, time] = useAnimationFrame(status === 'running' ? 300 : null);
  const isBlinking = status === 'running' && Math.floor(time / 300) % 2 === 0;

  if (status === 'running') {
    return React.createElement(
      Box,
      { ref, minWidth: 2 },
      React.createElement(Text, null, isBlinking ? '●' : ' '),
    );
  }
  return React.createElement(
    Box,
    { minWidth: 2 },
    React.createElement(Text, { color: status === 'success' ? '#22c55e' : '#ef4444' }, '●'),
  );
}

const DIM_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#f97316', '#ef4444'];
const DIM_BLOCK = '■';

function ContextVis({ analysis }: { analysis: ContextAnalysis }): React.ReactElement {
  const cols = process.stdout.columns ?? 80;
  // Available squares: reserve ~4 cols for left padding, each block is '■ ' = 2 chars
  const blockCount = Math.max(4, Math.floor((cols - 4) / 2));
  const tokensPerBlock = analysis.contextWindow / blockCount;

  // Build block segments
  const segments: { color: string; count: number; label: string }[] = [];
  let filled = 0;
  for (const dim of analysis.dimensions) {
    if (dim.tokens <= 0) continue;
    const count = Math.max(1, Math.round(dim.tokens / tokensPerBlock));
    segments.push({ color: DIM_COLORS[segments.length % DIM_COLORS.length], count, label: dim.name });
    filled += count;
  }
  // Cap to blockCount
  if (filled > blockCount) {
    // Scale down proportionally
    const scale = blockCount / filled;
    let adjusted = 0;
    for (const seg of segments) {
      seg.count = Math.max(1, Math.round(seg.count * scale));
      adjusted += seg.count;
    }
    // Trim overflow
    while (adjusted > blockCount && segments.length > 0) {
      const last = segments[segments.length - 1];
      if (last.count > 1) { last.count--; adjusted--; }
      else break;
    }
    filled = adjusted;
  }
  const free = Math.max(0, blockCount - filled);

  // Legend items
  const legendItems = analysis.dimensions.filter(d => d.tokens > 0);
  const legendChildren = legendItems.map((dim, i) => {
    const pctStr = dim.percentage > 0 ? dim.percentage.toFixed(1) : '-';
    return React.createElement(
      Box,
      { key: dim.name, marginRight: 2 },
      React.createElement(Text, { color: DIM_COLORS[i % DIM_COLORS.length] }, DIM_BLOCK),
      React.createElement(Text, null, ` ${dim.name}: ${dim.tokens.toLocaleString()} (${pctStr}%)`),
    );
  });

  // Block rows
  const blockChildren: React.ReactElement[] = [];
  let segIdx = 0;
  let remaining = segments.length > 0 ? segments[0].count : 0;
  for (let i = 0; i < blockCount; i++) {
    while (segIdx < segments.length && remaining <= 0) {
      segIdx++;
      remaining = segIdx < segments.length ? segments[segIdx].count : 0;
    }
    if (segIdx < segments.length) {
      const color = segments[segIdx].color;
      blockChildren.push(React.createElement(Text, { key: i, color }, DIM_BLOCK));
      remaining--;
    } else {
      blockChildren.push(React.createElement(Text, { key: i, dimColor: true }, '·'));
    }
  }

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingY: 1 },
    // Color block bar
    React.createElement(Box, { flexDirection: 'row', gap: 0 }, ...blockChildren),
    // Spacer
    React.createElement(Box, { height: 1 }),
    // Legend
    React.createElement(Box, { flexDirection: 'row', flexWrap: 'wrap' }, ...legendChildren),
    // Summary line
    React.createElement(
      Text,
      { dimColor: true },
      `${analysis.modelName} · ${analysis.totalTokens.toLocaleString()} / ${analysis.contextWindow.toLocaleString()} tokens (${analysis.percentage}%)${analysis.usageSource === 'api' ? ' · API 实际' : ''}${analysis.freeTokens > 0 ? ` · ${analysis.freeTokens.toLocaleString()} free` : ''}`,
    ),
  );
}

function MessageItem({ msg, agentColorMap }: { msg: UIMessage; agentColorMap?: Record<string, string> }): React.ReactElement {
  const agentLabelColor = agentColorMap?.[msg.agentName];

  // Context analysis visualization
  if (msg.contextAnalysis) {
    return React.createElement(ContextVis, { analysis: msg.contextAnalysis });
  }

  const isThink = msg.kind === 'thinking';

  if (msg.kind === 'stream') {
    const label = msg.agentName !== 'main'
      ? React.createElement(AgentLabel, { agentName: msg.agentName, color: agentLabelColor })
      : React.createElement(Text, { color: '#a78bfa' }, '● ');
    return React.createElement(
      Box,
      { flexDirection: 'row' },
      label,
      React.createElement(StreamingMarkdown, { children: msg.text }),
    );
  }

  if (isThink) {
    const label = msg.agentName !== 'main'
      ? React.createElement(AgentLabel, { agentName: msg.agentName, color: agentLabelColor })
      : React.createElement(Text, { dimColor: true }, '○ ');
    return React.createElement(
      Box,
      { flexDirection: 'row' },
      label,
      React.createElement(Markdown, { dimColor: true, children: msg.text }),
    );
  }

  if (msg.kind === 'userInput') {
    return React.createElement(
      Box,
      { flexDirection: 'row', backgroundColor: '#252542' },
      React.createElement(Text, { color: '#6b7280' }, '❯ '),
      React.createElement(Text, null, msg.text),
    );
  }

  if (msg.kind === 'info') {
    const label = msg.agentName !== 'main'
      ? React.createElement(AgentLabel, { agentName: msg.agentName, color: agentLabelColor })
      : null;
    return React.createElement(
      Box,
      { flexDirection: 'row' },
      label,
      React.createElement(Text, { dim: true }, msg.text),
    );
  }

  // 工具调用 — 使用 toolStatus 状态指示器
  if (msg.kind === 'toolCall' && msg.toolStatus) {
    const isRunning = msg.toolStatus === 'running';
    return React.createElement(
      Box,
      { flexDirection: 'row', alignItems: 'center' },
      React.createElement(ToolCallIndicator, { status: msg.toolStatus }),
      React.createElement(
        Text,
        { dimColor: !isRunning },
        msg.text,
      ),
    );
  }

  // 完成时间戳（仅同一行，不占用额外行空间）
  if (msg.kind === 'turnComplete') {
    return React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { dimColor: true, color: '#6b7280' }, msg.text),
    );
  }

  const colorMap: Record<string, string | undefined> = {
    toolCall: '#fbbf24',
    toolResult: '#10b981',
    error: '#ef4444',
    warn: '#fbbf24',
    success: '#10b981',
    userInput: undefined,
  };

  const baseColor = colorMap[msg.kind];
  const textProps: Record<string, unknown> = {};
  if (baseColor) textProps.color = baseColor;

  return React.createElement(
    Box,
    null,
    React.createElement(
      Text,
      textProps,
      React.createElement(AgentLabel, { agentName: msg.agentName, color: agentLabelColor }),
      msg.text,
    ),
  );
}

interface SelectOption<T = string> {
  label: string;
  value: T;
}

function Select<T>({ options, onChange, onCancel }: {
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [focusedIndex, setFocusedIndex] = useState(0);

  useInput((_input: string, key: {
    upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean;
  }) => {
    if (key.upArrow) {
      setFocusedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setFocusedIndex(i => Math.min(options.length - 1, i + 1));
    } else if (key.return) {
      onChange(options[focusedIndex].value);
    } else if (key.escape) {
      onCancel();
    }
  });

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    ...options.map((opt, i) => {
      const isFocused = i === focusedIndex;
      return React.createElement(
        Box,
        { key: i, flexDirection: 'row' },
        React.createElement(Text, {
          color: isFocused ? '#10b981' : undefined,
          dimColor: !isFocused,
        }, isFocused ? `● ${opt.label}` : `○ ${opt.label}`),
      );
    }),
  );
}

function DiffView({ hunks, filePath }: { hunks: DiffHunk[]; filePath: string }): React.ReactElement | null {
  const dim = false; // Always show full color for permission review
  const lines = useMemo(() => {
    const cd = new ColorDiff(hunks, filePath);
    return cd.render('dark', process.stdout.columns ?? 80, dim);
  }, [hunks, filePath, dim]);

  if (!lines || lines.length === 0) return null;

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'dashed',
      borderColor: '#6b7280',
      borderLeft: false,
      borderRight: false,
      marginY: 1,
    },
    React.createElement(
      Box,
      { flexDirection: 'column', paddingX: 1 },
      React.createElement(RawAnsi, { lines, width: (process.stdout.columns ?? 80) - 8 }),
    ),
  );
}

function PermissionDialog({
  toolName, displayName, message, details, diff, filePath, onResponse,
}: PermissionPrompt & { onResponse: (response: PermissionResponse) => void }): React.ReactElement {
  const options: SelectOption<PermissionResponse>[] = [
    { label: '批准 (Yes)', value: 'allow_once' },
    { label: '始终允许 (Always Allow)', value: 'always_allow' },
    { label: '拒绝 (No)', value: 'deny' },
  ];

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: '#fbbf24',
      borderLeft: false,
      borderRight: false,
      borderBottom: false,
      marginTop: 1,
    },
    // Title section — matches Claude Code PermissionDialog structure
    React.createElement(
      Box,
      { flexDirection: 'column', paddingX: 1 },
      React.createElement(Text, { bold: true, color: '#fbbf24' }, displayName ?? toolName),
      React.createElement(Text, { dimColor: true }, message),
    ),
    // Details (optional) — command content
    details
      ? React.createElement(
          Box,
          { flexDirection: 'column', paddingX: 2, paddingY: 1 },
          React.createElement(Text, { dimColor: true }, details.split('\n').slice(0, 5).join('\n')),
        )
      : null,
    // Diff view (optional) — file edit/write diff
    diff && filePath
      ? React.createElement(
          Box,
          { flexDirection: 'column', paddingX: 1 },
          React.createElement(DiffView, { hunks: diff, filePath }),
        )
      : null,
    // Select options + hint
    React.createElement(
      Box,
      { flexDirection: 'column', paddingX: 1 },
      <Select<PermissionResponse>
        options={options}
        onChange={(value) => onResponse(value)}
        onCancel={() => onResponse('deny')}
      />,
      React.createElement(Box, { marginTop: 1 },
        React.createElement(Text, { dimColor: true }, 'Esc to cancel'),
      ),
    ),
  );
}

function filterSuggestions(suggestions: CommandSuggestion[], query: string): CommandSuggestion[] {
  if (!query) return suggestions.slice().sort((a, b) => a.name.localeCompare(b.name));
  const lower = query.toLowerCase();
  const ranked = suggestions.map(s => {
    const nl = s.name.toLowerCase();
    const dl = s.description.toLowerCase();
    let rank: number;
    if (nl === lower) rank = 0;
    else if (nl.startsWith(lower)) rank = 1;
    else if (nl.includes(lower)) rank = 2;
    else if (dl.includes(lower)) rank = 3;
    else rank = 99;
    return { s, rank };
  });
  return ranked
    .filter(r => r.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.s.name.localeCompare(b.s.name))
    .map(r => r.s);
}

function AgentHeader({ name, state, color }: { name: string; state?: AgentRuntimeState; color?: string }): React.ReactElement {
  const agentColor = color || '#06b6d4';
  const statusText = state
    ? state.status === 'running'
      ? `运行中 · ${state.toolUseCount}工具`
      : state.status === 'completed'
        ? `完成 · ${state.toolUseCount}工具`
        : '错误'
    : '';
  return React.createElement(
    Box,
    { flexDirection: 'row', paddingX: 1, marginTop: 1 },
    React.createElement(Box, { flexDirection: 'row', flexGrow: 1 },
      React.createElement(Text, null, 'Viewing '),
      React.createElement(Text, { color: agentColor, bold: true }, `@${name}`),
      statusText
        ? React.createElement(Text, { dimColor: true }, `  ·  ${statusText}`)
        : null,
    ),
    React.createElement(Text, { dimColor: true, color: '#6b7280' }, 'Esc to return'),
  );
}

// Convert display width to character position within a line (used for multi-line cursor column preservation)
function charIdxAtWidth(line: string, targetWidth: number): number {
  let w = 0;
  for (let i = 0; i < line.length; i++) {
    if (w >= targetWidth) return i;
    w += stringWidth(line[i]);
  }
  return line.length;
}

// Compute character offset in input from (lineIndex, column) where lineIndex is \n-based
function offsetFromLineCol(lines: string[], lineIdx: number, col: number): number {
  let off = 0;
  for (let i = 0; i < lineIdx; i++) off += lines[i].length + 1;
  return off + col;
}

function AppContent(props: InkAppProps): React.ReactElement {
  const { messages, onInputSubmit, onExit, greeting, pendingPermission, onPermissionResponse, pendingQuestions, onQuestionsResponse, activeAgentName, viewAgent, onViewAgentClear, onViewAgentChange, mode, agentColorMap, agentStates, llmStatus, llmStartTime, turnTokens, llmLastTokenTime } = props;
  const { setRawMode } = useStdin();
  const [input, setInput] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [focusMode, setFocusMode] = useState<'input' | 'agent-list'>('input');
  const [trackerIndex, setTrackerIndex] = useState(0);
  const draftRef = useRef('');
  const desiredColumnRef = useRef<number | null>(null);
  const [, setScrollTick] = useState(0);
  const scrollRef = useRef<ScrollBoxHandle>(null);
  const [suggestionFiltered, setSuggestionFiltered] = useState<CommandSuggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [isSuggestionOpen, setIsSuggestionOpen] = useState(false);

  // Filter suggestions when input or the full list changes
  useEffect(() => {
    const suggestions = props.suggestions ?? [];
    const viewAgents = props.viewAgents ?? [];
    if (input.startsWith('/') && suggestions.length > 0) {
      const query = input.slice(1).toLowerCase();
      const filtered = filterSuggestions(suggestions, query);
      setSuggestionFiltered(filtered);
      setSelectedSuggestionIndex(0);
      setIsSuggestionOpen(true);
    } else if (input.startsWith('@') && viewAgents.length > 0) {
      const query = input.slice(1).toLowerCase();
      const filtered = viewAgents
        .filter(v => v.name.toLowerCase().includes(query) || v.label.toLowerCase().includes(query))
        .map(v => ({ name: v.name, description: v.label, type: 'agent' as const }));
      setSuggestionFiltered(filtered);
      setSelectedSuggestionIndex(0);
      setIsSuggestionOpen(true);
    } else {
      setIsSuggestionOpen(false);
      setSuggestionFiltered([]);
    }
  }, [input, props.suggestions, props.viewAgents]);

  // Collect user input messages for up/down history navigation
  const userMessages = useMemo(
    () => messages.filter(m => m.kind === 'userInput'),
    [messages],
  );

  // Raw mode: useLayoutEffect so it's set synchronously during commit
  useLayoutEffect(() => {
    setRawMode(true);
  }, [setRawMode]);

  // Max input height: at least 3 lines, at most ~50% of terminal rows
  const maxInputLines = Math.max(3, Math.floor((process.stdout.rows ?? 24) / 2) - 5);

  // Multi-line input: split by \n into separate Text elements inside a column
  // Box (right after "> " prompt). renderedLines is the visible viewport slice
  // (last maxInputLines lines). cursorLine/Column are relative to the column Box.
  const inputLines = input.length === 0 ? [' '] : input.split('\n');
  const renderedLines = inputLines.length > maxInputLines
    ? inputLines.slice(inputLines.length - maxInputLines)
    : inputLines;
  const renderOffset = inputLines.length - renderedLines.length;

  const beforeCursor = input.slice(0, cursorPos);
  const lastNl = beforeCursor.lastIndexOf('\n');
  // \n-based line index (used by up/down arrow navigation)
  const cursorLine = lastNl === -1 ? 0 : beforeCursor.split('\n').length - 1;
  const logicalColumn = stringWidth(beforeCursor.slice(lastNl + 1));

  // Soft-wrap aware cursor position for terminal cursor placement.
  // Effective input width: terminal columns minus padding (1 per side) and prompt ("> " = 2)
  const inputWidth = Math.max(1, (process.stdout.columns ?? 80) - 4);
  const linesBefore = beforeCursor.split('\n');
  let visualLine = 0;
  for (let i = 0; i < linesBefore.length - 1; i++) {
    visualLine += Math.max(1, Math.ceil(stringWidth(linesBefore[i]) / inputWidth));
  }
  visualLine += Math.floor(logicalColumn / inputWidth);
  const cursorColumn = logicalColumn % inputWidth;
  const declaredCursorLine = Math.max(0, visualLine - renderOffset);
  const cursorRef = useDeclaredCursor({
    line: declaredCursorLine,
    column: cursorColumn,
    active: true,
  });

  // Subscribe to scroll position changes (for floating header)
  useEffect(() => {
    const h = scrollRef.current;
    if (!h) return;
    return h.subscribe(() => setScrollTick(n => n + 1));
  }, []);

  // 查看的 agent 执行完毕时自动回退到主视图（类似 CC 的 useTeammateViewAutoExit）
  useEffect(() => {
    if (!viewAgent) return;
    const state = (agentStates ?? []).find(s => s.fullName === viewAgent);
    if (!state || state.status === 'completed' || state.status === 'error') {
      onViewAgentClear?.();
    }
  }, [viewAgent, agentStates, onViewAgentClear]);

  // Dynamic border color based on input prefix and view mode
  const isAtPrefix = input.startsWith('@');
  const inputBorderColor = viewAgent && !isAtPrefix && input.length > 0
    ? '#ef4444' // agent view + non-@ content = red (disabled)
    : isAtPrefix
      ? '#7c3aed' // @ command mode (purple)
      : input.startsWith('!')
        ? '#ff0087' // bash mode (pink, matches Claude Code bashBorder)
        : input.startsWith('/')
          ? '#7c3aed' // slash/command mode (accent purple)
          : mode === 'plan'
            ? '#f59e0b' // plan mode (amber, matches PLAN indicator)
            : '#6b7280'; // normal mode (gray)

  // Show terminal cursor — Ink hides it in componentDidMount (parent class
  // component), which runs after useLayoutEffect but BEFORE useEffect.
  // useEffect runs after the full commit phase, guaranteeing cursor visibility.
  useEffect(() => {
    process.stdout.write('\x1B[?25h');
  }, []);

  // Scroll indicator when user scrolls back (always rendered as 1-row Box
  // for layout stability — empty when at bottom).
  // Uses each message's estimated line height to map scrollTop to the correct
  // message, then searches backward for the nearest userInput to show as context.
  const h = scrollRef.current;
  let scrollHeader: React.ReactElement | null = null;
  if (h && !h.isSticky()) {
    const scrollTop = h.getScrollTop();
    const scrollHeight = h.getScrollHeight();
    const viewportHeight = h.getViewportHeight();
    const maxScroll = scrollHeight - viewportHeight;
    if (maxScroll > 0 && scrollHeight > 0) {
      const termWidth = process.stdout.columns ?? 80;
      // Estimate rendered line count per message from text content
      const heights = messages.map(msg => {
        const lines = msg.text.split('\n');
        let total = 0;
        for (const line of lines) {
          total += Math.max(1, Math.ceil((line.length || 1) / termWidth));
        }
        return total;
      });
      const totalEstimated = heights.reduce((a, b) => a + b, 0);
      if (totalEstimated > 0) {
        // Normalize scrollTop to estimated line-coordinate space so the
        // mapping is accurate regardless of Yoga scrollHeight vs estimation.
        const normScrollTop = scrollTop * (totalEstimated / scrollHeight);
        // Find which message contains the current scrollTop position
        let acc = 0;
        let targetIdx = heights.length - 1;
        for (let i = 0; i < heights.length; i++) {
          acc += heights[i];
          if (acc > normScrollTop) {
            targetIdx = i;
            break;
          }
        }
        // Walk backward from target to find the nearest userInput
        let userMsg: UIMessage | null = null;
        for (let i = targetIdx; i >= 0; i--) {
          if (messages[i].kind === 'userInput') {
            userMsg = messages[i];
            break;
          }
        }
        if (userMsg) {
          const txt = userMsg.text.length > 42 ? userMsg.text.slice(0, 42) + '…' : userMsg.text;
          scrollHeader = React.createElement(
            Box,
            { height: 1, paddingLeft: 1 },
            React.createElement(Text, { dimColor: true, bold: true }, '↑ ' + txt),
          );
        }
      }
    }
  }
  // Always render a header row (even if empty) to prevent layout shift
  // when scrollHeader appears/disappears.
  const headerRow = scrollHeader ?? React.createElement(Box, { height: 1 });

  useInput((_input: string, key: {
    escape: boolean; ctrl: boolean; shift: boolean; meta: boolean; return: boolean; backspace: boolean;
    upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean;
    delete: boolean; pageUp: boolean; pageDown: boolean;
    wheelUp: boolean; wheelDown: boolean; tab: boolean;
  }) => {
    // Any dialog active: ESC/Ctrl+C cancels the ReAct process
    if ((pendingPermission && onPermissionResponse) || (pendingQuestions && onQuestionsResponse)) {
      if (key.ctrl && _input === 'c') {
        if (pendingPermission && onPermissionResponse) onPermissionResponse('deny');
        if (pendingQuestions && onQuestionsResponse) onQuestionsResponse({});
        onExit();
        return;
      }
      if (key.escape) {
        if (pendingPermission && onPermissionResponse) {
          onPermissionResponse('deny');
          onExit();
        }
        // For questions, ESC is handled contextually by QuestionsDialog
        return;
      }
    }

    // When permission dialog is active, suppress normal input handling
    // (PermissionDialog has its own useInput for Allow/Deny)
    if (pendingPermission && onPermissionResponse) {
      if (key.pageUp || key.wheelUp) {
        scrollRef.current?.scrollTo(Math.max(0, (scrollRef.current.getScrollTop() ?? 0) - 6));
        return;
      }
      if (key.pageDown || key.wheelDown) {
        const sbr = scrollRef.current;
        if (sbr) {
          const st = sbr.getScrollTop() + 6;
          const maxScroll = Math.max(0, sbr.getScrollHeight() - sbr.getViewportHeight());
          sbr.scrollTo(Math.min(st, maxScroll));
        }
        return;
      }
      return; // suppress all other input
    }
    // When questions dialog is active, suppress normal input
    // (QuestionsDialog has its own useInput)
    if (pendingQuestions && onQuestionsResponse) {
      return;
    }

    const sb = scrollRef.current;

    // Page Up / Wheel Up: scroll back in history
    if (key.pageUp || key.wheelUp) {
      sb?.scrollTo(Math.max(0, (sb.getScrollTop() ?? 0) - 6));
      return;
    }
    // Page Down / Wheel Down: scroll forward in history
    if (key.pageDown || key.wheelDown) {
      if (sb) {
        const st = sb.getScrollTop() + 6;
        const maxScroll = Math.max(0, sb.getScrollHeight() - sb.getViewportHeight());
        sb.scrollTo(Math.min(st, maxScroll));
      }
      return;
    }

    // Shift+Tab: toggle normal/plan mode
    if (key.shift && key.tab) {
      props.onModeToggle?.();
      return;
    }

    // ── Suggestion popup keyboard navigation ──
    if (isSuggestionOpen) {
      // Up: previous suggestion
      if (key.upArrow) {
        setSelectedSuggestionIndex(i => Math.max(0, i - 1));
        return;
      }
      // Down: next suggestion
      if (key.downArrow) {
        setSelectedSuggestionIndex(i => Math.min(suggestionFiltered.length - 1, i + 1));
        return;
      }
      // Tab: complete with selected suggestion (insert name, stay editing)
      if (key.tab) {
        const selected = suggestionFiltered[selectedSuggestionIndex];
        if (selected) {
          const prefix = isAtPrefix ? '@' : '/';
          setInput(prefix + selected.name + ' ');
          setCursorPos(selected.name.length + 2);
        }
        setIsSuggestionOpen(false);
        return;
      }
      // Escape: close popup
      if (key.escape) {
        setIsSuggestionOpen(false);
        return;
      }
      // Enter: complete + submit (/) or switch view (@)
      if (key.return) {
        // Shift+Enter bypasses suggestion popup → insert newline
        if (key.shift) {
          setInput(prev => prev.slice(0, cursorPos) + '\n' + prev.slice(cursorPos));
          setCursorPos(p => p + 1);
          return;
        }
        // Backslash + Enter bypasses suggestion popup → insert newline
        if (cursorPos > 0 && input[cursorPos - 1] === '\\') {
          setInput(prev => prev.slice(0, cursorPos - 1) + '\n' + prev.slice(cursorPos));
          return;
        }
        const selected = suggestionFiltered[selectedSuggestionIndex];
        if (selected) {
          if (isAtPrefix) {
            // @ 模式：切换视图
            onViewAgentChange?.(selected.name);
            setInput('');
            setCursorPos(0);
            setIsSuggestionOpen(false);
          } else {
            const completed = '/' + selected.name + ' ';
            onInputSubmit(completed.trim());
            setInput('');
            setCursorPos(0);
            setHistoryIdx(-1);
            draftRef.current = '';
          }
          return;
        }
        // No selection: fall through to normal submit
      }
    }

    // Tab 切换焦点：输入 ↔ Agent 列表（CC 兼容）
    if (key.tab && !key.shift) {
      if (focusMode === 'agent-list') {
        setFocusMode('input');
        return;
      }
      // 仅在 suggestion 弹窗关闭且有 running agent 时切换焦点
      if (!isSuggestionOpen && agentStates && agentStates.some(s => s.type && s.fullName !== 'main' && s.status === 'running')) {
        setFocusMode('agent-list');
        setTrackerIndex(0);
        return;
      }
    }

    // ── Agent 列表焦点模式键盘导航 ──
    const trackerStates = (agentStates ?? [])
      .filter(s => s.type && s.fullName !== 'main' && s.status === 'running');
    if (focusMode === 'agent-list') {
      if (key.escape) {
        setFocusMode('input');
        setTrackerIndex(0);
        return;
      }
      if (key.upArrow) {
        setTrackerIndex(i => i <= 0 ? trackerStates.length : i - 1);
        return;
      }
      if (key.downArrow) {
        setTrackerIndex(i => i >= trackerStates.length ? 0 : i + 1);
        return;
      }
      if (key.return) {
        if (trackerIndex === 0) {
          // Main 行选中：回到主视图
          if (viewAgent) onViewAgentClear?.();
          setFocusMode('input');
          return;
        }
        const target = trackerStates[trackerIndex - 1];
        if (target && onViewAgentChange) {
          onViewAgentChange(target.fullName);
        }
        setFocusMode('input');
        return;
      }
      // Type-to-exit: 可打印字符回到输入模式（CC 兼容）
      if (_input && !key.ctrl && !key.meta) {
        setFocusMode('input');
        // 不 return，让字符落到输入处理逻辑，直接插入输入框
      } else {
        return; // 焦点在 agent 列表时屏蔽其他非打印按键
      }
    }

    // Up arrow: multi-line line-up, then input history
    if (key.upArrow) {
      if (viewAgent) {
        // Agent 视图中上箭头切换到前一个 agent
        const agents = props.viewAgents ?? [];
        const currentIdx = agents.findIndex(a => a.name === viewAgent);
        if (currentIdx > 0) {
          onViewAgentChange?.(agents[currentIdx - 1].name);
        }
        return;
      }
      // 多行输入：先尝试在行间移动
      const lines = input.split('\n');
      if (lines.length > 1 && cursorLine > 0) {
        if (desiredColumnRef.current === null) {
          desiredColumnRef.current = logicalColumn;
        }
        const targetLine = cursorLine - 1;
        const targetDisplayWidth = stringWidth(lines[targetLine]);
        const clampedWidth = Math.min(desiredColumnRef.current, targetDisplayWidth);
        const targetCol = charIdxAtWidth(lines[targetLine], clampedWidth);
        setCursorPos(offsetFromLineCol(lines, targetLine, targetCol));
        return;
      }
      // 首行：输入历史
      if (userMessages.length === 0) return;
      if (historyIdx === -1) {
        draftRef.current = input;
      }
      const newIdx = historyIdx === -1
        ? userMessages.length - 1
        : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      const text = userMessages[newIdx]!.text;
      setInput(text);
      setCursorPos(text.length);
      desiredColumnRef.current = null;
      return;
    }

    // Down arrow: multi-line line-down, then input history
    if (key.downArrow) {
      if (viewAgent) {
        // Agent 视图中下箭头切换到后一个 agent
        const agents = props.viewAgents ?? [];
        const currentIdx = agents.findIndex(a => a.name === viewAgent);
        if (currentIdx < agents.length - 1) {
          onViewAgentChange?.(agents[currentIdx + 1].name);
        }
        return;
      }
      // 多行输入：先尝试在行间移动
      const lines = input.split('\n');
      if (lines.length > 1 && cursorLine < lines.length - 1) {
        if (desiredColumnRef.current === null) {
          desiredColumnRef.current = logicalColumn;
        }
        const targetLine = cursorLine + 1;
        const targetDisplayWidth = stringWidth(lines[targetLine]);
        const clampedWidth = Math.min(desiredColumnRef.current, targetDisplayWidth);
        const targetCol = charIdxAtWidth(lines[targetLine], clampedWidth);
        setCursorPos(offsetFromLineCol(lines, targetLine, targetCol));
        return;
      }
      // 末行：输入历史
      if (historyIdx >= 0) {
        const newIdx = historyIdx + 1;
        if (newIdx >= userMessages.length) {
          setHistoryIdx(-1);
          setInput(draftRef.current);
          setCursorPos(draftRef.current.length);
        } else {
          setHistoryIdx(newIdx);
          const text = userMessages[newIdx]!.text;
          setInput(text);
          setCursorPos(text.length);
        }
        desiredColumnRef.current = null;
      }
      return;
    }

    // Reset history browsing when user types or moves cursor
    if (historyIdx >= 0) {
      setHistoryIdx(-1);
    }

    // Left arrow: move cursor left
    if (key.leftArrow) {
      desiredColumnRef.current = null;
      setCursorPos(p => Math.max(0, p - 1));
      return;
    }

    // Right arrow: move cursor right
    if (key.rightArrow) {
      desiredColumnRef.current = null;
      setCursorPos(p => Math.min(input.length, p + 1));
      return;
    }

    // Ctrl+C / Escape：agent 视图中 Esc 返回主视图，主视图中 Esc 无效果（类似 vim 的 ESC 仅退出编辑模式）
    if (key.escape) {
      if (viewAgent) {
        onViewAgentClear?.();
        return;
      }
      return;
    }
    if (key.ctrl && _input === 'c') {
      onExit();
      return;
    }
    if (key.return) {
      // Shift+Enter (modifyOtherKeys / CSI u) → insert newline
      if (key.shift) {
        setInput(prev => prev.slice(0, cursorPos) + '\n' + prev.slice(cursorPos));
        setCursorPos(p => p + 1);
        return;
      }

      // Backslash + Enter: delete \ and insert \n (Claude Code convention)
      if (cursorPos > 0 && input[cursorPos - 1] === '\\') {
        setInput(prev => prev.slice(0, cursorPos - 1) + '\n' + prev.slice(cursorPos));
        return;
      }

      const trimmed = input.trim();
      if (!trimmed) return;

      // Agent 视图中 @ 开头的输入 → 切换视图
      if (viewAgent && trimmed.startsWith('@')) {
        const target = trimmed.slice(1);
        onViewAgentChange?.(target || 'main');
        setInput('');
        setCursorPos(0);
        return;
      }
      // Agent 视图中非 @ 输入 → 忽略（禁用状态）
      if (viewAgent && !trimmed.startsWith('@')) {
        return;
      }

      // 主视图正常提交
      onInputSubmit(trimmed);
      setInput('');
      setCursorPos(0);
      setHistoryIdx(-1);
      draftRef.current = '';
      return;
    }
    // Backspace: delete character before cursor
    if (key.backspace) {
      if (cursorPos > 0) {
        setInput(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos(p => p - 1);
      }
      return;
    }
    // Delete: delete character after cursor
    if (key.delete) {
      if (cursorPos < input.length) {
        setInput(prev => prev.slice(0, cursorPos) + prev.slice(cursorPos + 1));
      }
      return;
    }
    // Accept any printable input — insert at cursor position
    if (_input) {
      desiredColumnRef.current = null;
      setInput(prev => prev.slice(0, cursorPos) + _input + prev.slice(cursorPos));
      setCursorPos(p => p + _input.length);
    }
  });

  // Scrollable suggestion window
  const SUGGESTION_VISIBLE_COUNT = 8;
  const suggestionWindowStart = isSuggestionOpen && suggestionFiltered.length > SUGGESTION_VISIBLE_COUNT
    ? Math.max(0, Math.min(
        selectedSuggestionIndex - Math.floor(SUGGESTION_VISIBLE_COUNT / 2),
        suggestionFiltered.length - SUGGESTION_VISIBLE_COUNT,
      ))
    : 0;
  const visibleSuggestions = isSuggestionOpen
    ? suggestionFiltered.slice(suggestionWindowStart, suggestionWindowStart + SUGGESTION_VISIBLE_COUNT)
    : [];

  // Welcome screen when no messages yet
  if (messages.length === 0) {
    return React.createElement(
      AlternateScreen,
      null,
      React.createElement(
        Box,
        { flexDirection: 'column', height: '100%', overflow: 'hidden' },
        React.createElement(
          Box,
          { flexDirection: 'column', flexGrow: 1, justifyContent: 'flexStart' },
          React.createElement(Box, { height: 1 }),
          React.createElement(Text, { bold: true, color: '#00aaff' }, '  █   █   ██   █   █   ██           ██    ██   ██    ████'),
          React.createElement(Text, { bold: true, color: '#00aaff' }, '  ██  █  █  █  ██  █  █  █         █     █  █  █  █  █   '),
          React.createElement(Text, { bold: true, color: '#00aaff' }, '  █ █ █  ████  █ █ █  █  █   ███   █     █  █  █  █  ███ '),
          React.createElement(Text, { bold: true, color: '#00aaff' }, '  █  ██  █  █  █  ██  █  █         █     █  █  █  █  █   '),
          React.createElement(Text, { bold: true, color: '#00aaff' }, '  █   █  █  █  █   █   ██           ██    ██   ██    ████'),
          React.createElement(Box, { height: 1 }),
          React.createElement(Text, { dimColor: true }, `  ${greeting}`),
          React.createElement(Text, { dimColor: true }, '  输入 exit 或 quit 退出'),
        ),
        React.createElement(
          Box,
          { flexDirection: 'column', flexShrink: 0, paddingLeft: 1, paddingRight: 1, paddingBottom: 1 },
          React.createElement(
            Box,
            {
              flexDirection: 'row',
              alignItems: 'flex-start',
              borderStyle: 'round',
              borderColor: inputBorderColor,
              borderLeft: false, borderRight: false, borderBottom: true,
              width: '100%',
            },
            React.createElement(Text, { bold: true, color: '#9ca3af' }, '> '),
            React.createElement(
              Box,
              { ref: cursorRef, flexDirection: 'column', flexGrow: 1 },
              ...renderedLines.map((line, i) =>
                React.createElement(Text, { key: i }, line || ' '),
              ),
            ),
          ),
          // Suggestion popup
          isSuggestionOpen && suggestionFiltered.length > 0
            ? React.createElement(
                Box,
                { flexDirection: 'column', paddingLeft: 2, paddingTop: 1 },
                ...visibleSuggestions.map((s, i) => {
                  const actualIndex = suggestionWindowStart + i;
                  const isFocused = actualIndex === selectedSuggestionIndex;
                  return React.createElement(Text, {
                    key: s.name,
                    color: isFocused ? '#7c3aed' : s.type === 'agent' ? '#06b6d4' : undefined,
                    dimColor: !isFocused,
                  }, `${isFocused ? '● ' : '○ '}${isAtPrefix ? '@' : '/'}${s.name}  ${s.type === 'agent' ? '[agent] ' : ''}${s.description}`);
                }),
              )
            : null,
          React.createElement(StatusBar, {
            segments: props.statusSegments,
            notification: props.notification,
            llmStatus: props.llmStatus,
            llmStartTime: props.llmStartTime,
            turnTokens: props.turnTokens,
          }),
        ),
      ),
    );
  }

  // Normal conversation view
  // Two-sibling layout (ref: Claude Code FullscreenLayout):
  // - Scroll container: flexGrow=1 — ScrollBox wraps messages
  // - Bottom area: flexShrink=0 — always visible, never compressed
  return React.createElement(
    AlternateScreen,
    null,
    // Scroll container (header + ScrollBox) — clips overflow, grows to fill space
    React.createElement(
      Box,
      { flexDirection: 'column', flexGrow: 1, overflow: 'hidden', paddingLeft: 1, paddingRight: 1 },
      headerRow,
      React.createElement(
        ScrollBox,
        { ref: scrollRef, flexGrow: 1, stickyScroll: true, paddingTop: 1 },
        ...messages.map((msg, i) =>
          React.createElement(MessageItem, { key: i, msg, agentColorMap }),
        ),
        llmStatus === 'running' && llmStartTime && llmStartTime > 0
          ? React.createElement(SpinnerWithVerb, {
              key: '__spinner__',
              startTime: llmStartTime,
              tokens: turnTokens ?? 0,
              lastTokenTime: llmLastTokenTime ?? llmStartTime,
            })
          : null,
      ),
    ),
    // Agent header — shown when user has switched to an agent
    activeAgentName
      ? React.createElement(AgentHeader, {
          name: activeAgentName,
          color: agentColorMap?.[activeAgentName],
        })
      : null,
    // Bottom area — flexShrink=0 prevents Yoga from compressing it
    // Claude Code style: bottom-border row for prompt + input + suggestions
    React.createElement(
      Box,
      { flexDirection: 'column', flexShrink: 0, paddingLeft: 1, paddingRight: 1, paddingBottom: 1, marginTop: 1 },
      // Mode indicator bar — now part of StatusBar
      React.createElement(BackgroundTaskBar, { tasks: props.backgroundTasks ?? [] }),
      // Prompt input
      React.createElement(
        Box,
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          borderStyle: 'round',
          borderColor: inputBorderColor,
          borderLeft: false, borderRight: false, borderBottom: true,
          width: '100%',
        },
        React.createElement(Text, { bold: true, color: '#9ca3af' }, '> '),
        React.createElement(
          Box,
          { ref: cursorRef, flexDirection: 'column', flexGrow: 1 },
          ...renderedLines.map((line, i) =>
            React.createElement(Text, { key: i }, line || ' '),
          ),
        ),
      ),
      // Suggestion popup
      isSuggestionOpen && suggestionFiltered.length > 0
        ? React.createElement(
            Box,
            { flexDirection: 'column', paddingLeft: 2, paddingTop: 1 },
            ...visibleSuggestions.map((s, i) => {
              const actualIndex = suggestionWindowStart + i;
              const isFocused = actualIndex === selectedSuggestionIndex;
              const suggestionPrefix = isAtPrefix ? '@' : '/';
              return React.createElement(Text, {
                key: s.name,
                color: isFocused ? '#7c3aed' : s.type === 'agent' ? '#06b6d4' : undefined,
                dimColor: !isFocused,
              }, `${isFocused ? '● ' : '○ '}${suggestionPrefix}${s.name}  ${s.type === 'agent' ? '[agent] ' : ''}${s.description}`);
            }),
          )
        : null,
      // Agent 视图提示
      viewAgent
        ? React.createElement(
            Text,
            { dim: true },
            'Agent 视图 · ↑↓ 切换Agent · Esc 返回',
          )
        : null,
      // 权限/问题弹窗（固定在 bottom 区域，不随消息滚动）
      pendingPermission && onPermissionResponse
        ? React.createElement(PermissionDialog, {
            ...pendingPermission,
            onResponse: onPermissionResponse,
          })
        : null,
      pendingQuestions && onQuestionsResponse
        ? React.createElement(QuestionsDialog, {
            questions: pendingQuestions.questions,
            onResponse: onQuestionsResponse,
          })
        : null,
      // Agent 任务面板（CoordinatorTaskPanel 等效，显示在 PromptInput 下方）
      React.createElement(AgentTrackerBar, {
        states: props.agentStates ?? [],
        agentColorMap: props.agentColorMap,
        selectedIndex: trackerIndex,
        currentView: viewAgent,
        focusMode,
      }),
      React.createElement(StatusBar, {
        segments: props.statusSegments,
        notification: props.notification,
        llmStatus: props.llmStatus,
        llmStartTime: props.llmStartTime,
        turnTokens: props.turnTokens,
      }),
    ),
  );
}

export function InkApp(props: InkAppProps): React.ReactElement {
  return React.createElement(
    ThemeProvider,
    { initialState: 'dark' },
    React.createElement(AppContent, { ...props }),
  );
}
