import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, type ErrorInfo } from 'react';
import { Box, Text, useInput, useStdin, ThemeProvider, stringWidth, RawAnsi, useBlink } from '#src/plugins/display/claude-code-ink/ink.js';
import { AlternateScreen } from '#src/plugins/display/claude-code-ink/engine/components/AlternateScreen.js';
import ScrollBox, { type ScrollBoxHandle } from '#src/plugins/display/claude-code-ink/engine/components/ScrollBox.js';
import { useDeclaredCursor } from '#src/plugins/display/claude-code-ink/engine/hooks/use-declared-cursor.js';
import { ColorDiff } from '#src/plugins/display/claude-code-ink/color-diff.js';
import { Markdown, StreamingMarkdown } from '#src/plugins/display/claude-code-ink/components/Markdown.js';
import { BackgroundTaskBar } from '#src/plugins/display/claude-code-ink/components/BackgroundTaskBar.js';
import { AgentTrackerBar } from '#src/plugins/display/claude-code-ink/components/AgentTrackerBar.js';
import { AgentPillBar } from '#src/plugins/display/claude-code-ink/components/AgentPillBar.js';
import { SpinnerWithVerb } from '#src/plugins/display/claude-code-ink/SpinnerWithVerb.js';
import type { DiffHunk, ContextAnalysis } from '#src/core/contract.js';
import { QuestionsDialog } from './QuestionsDialog.js';
import { StatusBar } from './components/StatusBar.js';
import { useSearchHighlight } from '#src/plugins/display/claude-code-ink/engine/hooks/use-search-highlight.js';
import { VirtualMessageList, type JumpHandle, type MessageActionsNav } from './components/VirtualMessageList.js';
import { ScrollChromeContext, type StickyPrompt } from './components/ScrollChromeContext.js';
import { StickyPromptHeaderRow } from './components/StickyPromptHeader.js';
import { InputArea } from './components/InputArea.js';
import { debugLog } from '#src/plugins/display/claude-code-ink/utils/debugLog.js';
import { logManager } from '#src/utils/logger.js';

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
  /** 本轮 token 消耗 */
  tokens: number;
  lastToolName?: string;
  /** 任务描述（用户输入的 query） */
  query?: string;
  /** Agent 角色描述（来自 AgentDefinition.description） */
  description?: string;
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

/** 生成 SummaryPill 标签文本。匹配 CC getPillLabel()：同类型时使用类型名，否则泛化 */
function getSummaryPillLabel(agents: AgentRuntimeState[]): string {
  const n = agents.length;
  const types = new Set(agents.map(a => a.type));
  if (types.size === 1) {
    const type = agents[0].type;
    return `${n} ${type} agent${n > 1 ? 's' : ''}`;
  }
  return `${n} sub-agents`;
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
  /** 是否有 swarm/teammate 类 agent（true=显示 AgentPillBar，false=显示 SummaryPill） */
  hasSwarmAgents?: boolean;
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

/** 工具调用状态指示器 — CC ToolUseLoader 风格 */
function ToolCallIndicator({ status }: { status: 'running' | 'success' | 'error' }): React.ReactElement {
  const isUnresolved = status === 'running';
  const isError = status === 'error';
  const [ref, isBlinking] = useBlink(isUnresolved, 300);

  // CC 风格：unresolved → 闪烁 ●（交替显示空格），error → 红 ●，success → 绿 ●
  const color = isUnresolved ? undefined : isError ? '#ef4444' : '#22c55e';
  const show = !isUnresolved || isBlinking ? '●' : ' ';

  return React.createElement(
    Box,
    { ref, minWidth: 2 },
    React.createElement(Text, { color, dimColor: false }, show),
  );
}

// ── 消息折叠帮助函数 ──

/** 从 msg.text 中提取工具名称，格式为 "read_file(/path)" 或 "search(query)" */
function extractToolName(text: string): string {
  const paren = text.indexOf('(');
  if (paren > 0) return text.slice(0, paren).trim();
  const colon = text.indexOf(':');
  return colon > 0 ? text.slice(0, colon).trim() : text.split(' ')[0] || text;
}

interface FoldGroup {
  type: 'group';
  id: string;
  toolName: string;
  items: UIMessage[];
  indices: number[];
}

/** 将连续的同类 toolCall 合并为折叠组 */
function groupMessages(messages: UIMessage[]): Array<UIMessage | FoldGroup> {
  const result: Array<UIMessage | FoldGroup> = [];
  let i = 0;
  while (i < messages.length) {
    if (messages[i].kind === 'toolCall') {
      const toolName = extractToolName(messages[i].text);
      const group: UIMessage[] = [messages[i]];
      const indices: number[] = [i];
      let j = i + 1;
      while (j < messages.length && messages[j].kind === 'toolCall') {
        if (extractToolName(messages[j].text) !== toolName) break;
        group.push(messages[j]);
        indices.push(j);
        j++;
      }
      if (group.length > 1) {
        result.push({ type: 'group', id: `fold-${i}`, toolName, items: group, indices });
        i = j;
        continue;
      }
    }
    result.push(messages[i]);
    i++;
  }
  return result;
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
  const [focusMode, setFocusMode] = useState<'input' | 'tasks'>('input');
  // 折叠组由 transcriptMode 全局控制：收起态为 dim 摘要，Ctrl+O 展开所有
  const groupedMessages = useMemo(() => groupMessages(messages), [messages]);
  const [searchMode, setSearchMode] = useState<'inactive' | 'active' | 'persistent'>('inactive');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCursorPos, setSearchCursorPos] = useState(0);
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchCurrentIdx, setSearchCurrentIdx] = useState(0);
  const [transcriptMode, setTranscriptMode] = useState(false);
  const transcriptModeRef = useRef(false);
  const searchModeRef = useRef<'inactive' | 'active' | 'persistent'>('inactive');

  const [taskIndex, setTaskIndex] = useState(0);
  const hasSwarmAgents = props.hasSwarmAgents ?? false;
  const runningSubAgents = (props.agentStates ?? []).filter(
    s => s.type && s.fullName && s.fullName !== 'main' && s.status === 'running',
  );
  const showSummaryPill = runningSubAgents.length > 0 && !hasSwarmAgents;
  const draftRef = useRef('');
  const desiredColumnRef = useRef<number | null>(null);
  const lastKeyEventRef = useRef(0);
  const scrollRef = useRef<ScrollBoxHandle>(null);
  const searchHighlight = useSearchHighlight();
  const [stickyPrompt, setStickyPrompt] = useState<StickyPrompt | null>(null);
  const jumpRef = useRef<JumpHandle>(null);
  const cursorNavRef = useRef<MessageActionsNav>(null);
  const handleSearchMatchesChange = useCallback((count: number, current: number) => {
    debugLog(`handleSearchMatchesChange: count=${count} current=${current}`);
    setSearchMatchCount(count);
    setSearchCurrentIdx(current > 0 ? current - 1 : 0);
  }, []);

  // ── Search: delegate to VirtualMessageList JumpHandle ──
  useEffect(() => {
    if (searchMode === 'inactive' || !searchQuery) {
      jumpRef.current?.disarmSearch();
      return;
    }
    jumpRef.current?.setSearchQuery(searchQuery);
  }, [searchQuery, jumpRef]);
  const displayItems = useMemo(() => {
    const items: UIMessage[] = [];
    for (const item of groupedMessages) {
      if ((item as FoldGroup).type === 'group') {
        const g = item as FoldGroup;
        if (!transcriptMode) {
          // Folded: one-line dim summary
          items.push({
            agentName: '',
            text: ` ${g.toolName} × ${g.items.length} (ctrl+o to expand)`,
            kind: 'info',
          } as UIMessage);
        } else {
          // Expanded: show all child messages
          items.push(...g.items);
        }
      } else {
        items.push(item as UIMessage);
      }
    }
    return items;
  }, [groupedMessages, transcriptMode]);

  const renderItem = useCallback(
    (msg: UIMessage, idx: number) => {
      if (msg.kind === 'info' && msg.text.startsWith(' ')) {
        return React.createElement(Text, { dimColor: true }, msg.text);
      }
      return React.createElement(MessageItem, { msg, agentColorMap });
    },
    [agentColorMap],
  );

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

  // ── Search: setQuery on searchHighlight for screen-buffer inverse ──
  useEffect(() => {
    if (searchMode === 'inactive' || !searchQuery) {
      searchHighlight.setQuery('');
    } else {
      searchHighlight.setQuery(searchQuery);
    }
  }, [searchQuery, searchMode, searchHighlight]);

  // Delegated to VirtualMessageList: scanning, position overlay, scroll-to-match

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
    debugLog("input: _input=" + _input + " transcriptMode=" + transcriptModeRef.current + " searchMode=" + searchModeRef.current);
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

    // ── Ctrl+O: toggle transcript mode ──
    if (key.ctrl && _input === 'o') {
      if (transcriptModeRef.current) {
        // 退出 transcript 模式时清理搜索
        searchHighlight.setQuery('');
        searchHighlight.setPositions(null);
        searchModeRef.current = 'inactive';
        setSearchMode('inactive');
        setSearchQuery('');
        setSearchMatchCount(0);
        setSearchCurrentIdx(0);
        transcriptModeRef.current = false;
        setTranscriptMode(false);
      } else {
        transcriptModeRef.current = true;
        setTranscriptMode(true);
        // 确保进入 transcript 模式时 searchMode 是 inactive
        // 防止因渲染顺序/竞态导致 ref 残留非 inactive 值
        searchModeRef.current = 'inactive';
        setSearchMode('inactive');
      }
      return;
    }

    // ── Transcript mode: `/` opens search, `q`/Esc/Ctrl+O exits ──
    if (transcriptModeRef.current) {
      if (_input === '/') {
        debugLog(`/ pressed in transcript: searchModeRef=${searchModeRef.current}`);
        searchModeRef.current = 'active';
        setSearchMode('active');
        setSearchQuery('');
        setSearchCursorPos(0);
        setSearchMatchCount(0);
        setSearchCurrentIdx(0);
        searchHighlight.setQuery('');
        searchHighlight.setPositions(null);
        return;
      }
      if (searchModeRef.current === 'inactive') {
        if (_input === 'q' || key.escape) {
          transcriptModeRef.current = false;
          setTranscriptMode(false);
          return;
        }
        // 非搜索态时屏蔽所有输入
        if (_input) return;
      }
    }

    // ── Search: active mode keyboard ──
    if (searchModeRef.current === 'active') {
      if (key.escape) {
        searchHighlight.setQuery('');
        searchHighlight.setPositions(null);
        searchModeRef.current = 'inactive';
        setSearchMode('inactive');
        setSearchQuery('');
        setSearchMatchCount(0);
        setSearchCurrentIdx(0);
        return;
      }
      if (key.return) {
        if (searchMatchCount > 0) {
          setSearchCurrentIdx(0);
        }
        searchModeRef.current = 'persistent';
        setSearchMode('persistent');
        return;
      }
      if (key.downArrow) {
        jumpRef.current?.nextMatch();
        return;
      }
      if (key.upArrow) {
        jumpRef.current?.prevMatch();
        return;
      }
      if (key.backspace) {
        if (searchCursorPos > 0) {
          setSearchQuery(prev => prev.slice(0, searchCursorPos - 1) + prev.slice(searchCursorPos));
          setSearchCursorPos(p => p - 1);
        }
        return;
      }
      if (key.leftArrow) {
        setSearchCursorPos(p => Math.max(0, p - 1));
        return;
      }
      if (key.rightArrow) {
        setSearchCursorPos(p => Math.min(searchQuery.length, p + 1));
        return;
      }
      if (_input && !key.ctrl && !key.meta) {
        setSearchQuery(prev => prev.slice(0, searchCursorPos) + _input + prev.slice(searchCursorPos));
        setSearchCursorPos(p => p + _input.length);
        return;
      }
      return; // suppress all other keys during search
    }

    // ── Search: persistent mode (transcript mode only: n/N/↑/↓ navigate) ──
    debugLog(`persistent-gate: transcriptMode=${transcriptModeRef.current} searchMode=${searchModeRef.current} searchResults=[${searchMatchCount}] current=${searchCurrentIdx} jumpRef=${jumpRef.current ? 'set' : 'NULL'} key="${_input}" esc=${key.escape} up=${key.upArrow} down=${key.downArrow}`);
    if (transcriptModeRef.current && searchModeRef.current === 'persistent' && searchMatchCount > 0) {
      if (key.escape) {
        debugLog("persistent: escape -> clear search");
        searchHighlight.setQuery('');
        searchHighlight.setPositions(null);
        searchModeRef.current = 'inactive';
        setSearchMode('inactive');
        setSearchQuery('');
        setSearchMatchCount(0);
        setSearchCurrentIdx(0);
        return;
      }
      if (_input === 'n' || _input === 'N' || key.downArrow) {
        // n/downArrow = nextMatch, N/shift+n = prevMatch (vim convention)
        const isPrev = _input === 'N' || key.shift;
        if (isPrev) {
          debugLog(`persistent: N/shift+n -> prevMatch() searchResults=[${searchMatchCount}] current=${searchCurrentIdx}`);
          jumpRef.current?.prevMatch();
        } else {
          debugLog(`persistent: n/down -> nextMatch() searchResults=[${searchMatchCount}] current=${searchCurrentIdx}`);
          jumpRef.current?.nextMatch();
        }
        debugLog(`persistent: nav done`);
        return;
      }
      if (key.upArrow) {
        debugLog(`persistent: up -> prevMatch() searchResults=[${searchMatchCount}] searchCurrentIdx=${searchCurrentIdx}`);
        jumpRef.current?.prevMatch();
        debugLog(`persistent: prevMatch() done`);
        return;
      }
      // Fall through to normal input for other keys
    }

    // Arrow key debounce — terminal emulator 可能多发箭头事件
    if (key.upArrow || key.downArrow) {
      const now = Date.now();
      if (now - lastKeyEventRef.current < 50) return;
      lastKeyEventRef.current = now;
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

    // Tab 切换焦点已移除，改用 ↓ 方向键进入 tasks 导航

    // ── Tasks 焦点模式键盘导航（CC 风格：↑↓ 选 agent，Enter 查看）──
    if (focusMode === 'tasks') {
      const tasksList = [
        { name: 'main', label: 'main' },
        ...runningSubAgents.map(s => ({ name: s.fullName, label: s.type })),
      ];
      // 安全夹紧：tasksList 可能因 agent 完成而缩小
      if (taskIndex >= tasksList.length && tasksList.length > 0) {
        setTaskIndex(tasksList.length - 1);
      }
      if (key.escape) {
        setFocusMode('input');
        setTaskIndex(0);
        return;
      }
      if (key.upArrow) {
        setTaskIndex(i => {
          if (i <= 0) { setFocusMode('input'); return 0; }
          return i - 1;
        });
        return;
      }
      if (key.downArrow) {
        setTaskIndex(i => Math.min(i + 1, tasksList.length - 1));
        return;
      }
      if (key.return && !key.shift) {
        const selected = tasksList[taskIndex] ?? tasksList[0] ?? { name: 'main' };
        if (selected.name === 'main') onViewAgentClear?.();
        else onViewAgentChange?.(selected.name);
        setFocusMode('input');
        return;
      }
      // left/right arrows: back to input
      if (key.leftArrow || key.rightArrow) {
        setFocusMode('input');
        return;
      }
      // Type-to-exit: printable char goes back to input
      if (_input && !key.ctrl && !key.meta) {
        setFocusMode('input');
      } else {
        return; // block other non-navigation keys
      }
    }

    // Up arrow: multi-line line-up, then input history
    if (key.upArrow) {
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
        return; // 历史浏览中 → 不进入 tasks 模式
      }
      // 末行 + 有 running 子 agent → 进入 tasks 导航模式
      if (runningSubAgents.length > 0) {
        setFocusMode('tasks');
        setTaskIndex(0);
        return;
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

    // Ctrl+C / Escape：tasks 模式中 Esc 回 input，agent 视图中 Esc 返回主视图
    if (key.escape) {
      if (focusMode === 'tasks') {
        setFocusMode('input');
        return;
      }
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
          React.createElement(InputArea, {
            searchMode,
            searchQuery,
            searchCursorPos,
            searchMatchCount,
            searchCurrentIdx,
            transcriptMode,
            cursorRef,
            renderedLines,
            inputBorderColor,
visibleSuggestions,
            selectedSuggestionIndex,
            isAtPrefix,
            suggestionWindowStart,
          }),
          React.createElement(StatusBar, {
            segments: props.statusSegments,
            notification: props.notification,
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
        ScrollChromeContext.Provider,
        { value: { setStickyPrompt } },
        stickyPrompt !== null && typeof stickyPrompt !== 'string'
          ? React.createElement(StickyPromptHeaderRow, {
              prompt: stickyPrompt,
              onClick: () => { stickyPrompt.scrollTo(); setStickyPrompt('clicked'); },
              onMouseEnter: () => {},
              onMouseLeave: () => {},
            })
          : null,
        React.createElement(
          ScrollBox,
          { ref: scrollRef, flexGrow: 1, stickyScroll: true, paddingTop: stickyPrompt !== null ? 0 : 1 },
          React.createElement(VirtualMessageList, {
            messages: displayItems,
            scrollRef,
            columns: process.stdout.columns ?? 80,
            itemKey: (msg: UIMessage, i: number) => `${msg.kind}-${i}`,
            renderItem,
            isItemExpanded: () => false,
            trackStickyPrompt: true,
            cursorNavRef,
            jumpRef,
            scanElement: searchHighlight.scanElement,
            setPositions: searchHighlight.setPositions,
            onSearchMatchesChange: handleSearchMatchesChange,
          }),
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
      React.createElement(InputArea, {
        searchMode,
        searchQuery,
        searchCursorPos,
        searchMatchCount,
        searchCurrentIdx,
        transcriptMode,
        cursorRef,
        renderedLines,
        inputBorderColor,
        visibleSuggestions,
        selectedSuggestionIndex,
        isAtPrefix,
        suggestionWindowStart,
      }),
      // SummaryPill — 非 swarm 模式下运行 agent 的聚合统计（CC 兼容）
      showSummaryPill
        ? React.createElement(Text, { dimColor: true, key: 'summary-pill' },
            getSummaryPillLabel(runningSubAgents),
          )
        : null,
      // AgentPillBar — swarm 模式下显示个体 @name pills（当前 hasSwarmAgents=false 隐藏）
      hasSwarmAgents
        ? React.createElement(AgentPillBar, {
            agents: props.viewAgents ?? [],
            agentColorMap: props.agentColorMap ?? {},
            selectedIndex: taskIndex,
            currentView: viewAgent,
            isFocused: focusMode === 'tasks',
          })
        : null,
      // Agent 视图提示
      viewAgent
        ? React.createElement(
            Text,
            { dim: true },
            'Agent 视图 · Esc 返回',
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
        currentView: viewAgent,
        selectedIndex: taskIndex,
        isFocused: focusMode === 'tasks',
      }),
      React.createElement(StatusBar, {
        segments: props.statusSegments,
        notification: props.notification,
      }),
    ),
  );
}

/**
 * Error boundary 确保渲染错误不会导致整个 Ink 树卸载。
 * React 要求 error boundary 必须是 class 组件。
 * 若无此边界，任何子组件渲染异常都会使 <AlternateScreen> 卸载，
 * 导致终端退出 alt-screen 模式（"弹回控制台"），后续输出变成乱码。
 */
class InkErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state: { hasError: boolean } = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 不能调用 display.onError（render 循环），也不能 console.error（stderr 直写破坏 alt-screen）。
    // 仅通过 logManager 记录，由日志后端持久化。
    logManager.error('ink', 'InkApp 渲染错误', error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return React.createElement(
        Box,
        { flexDirection: 'column', paddingLeft: 1, paddingRight: 1 },
        React.createElement(Text, { dimColor: true }, '⚠ 内容渲染异常 — 请在终端检查日志'),
      );
    }
    return this.props.children;
  }
}

export function InkApp(props: InkAppProps): React.ReactElement {
  return React.createElement(
    ThemeProvider,
    { initialState: 'dark' },
    React.createElement(
      InkErrorBoundary,
      null,
      React.createElement(AppContent, { ...props }),
    ),
  );
}
