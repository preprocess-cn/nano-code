import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Box, Text, useInput, useStdin, ThemeProvider, stringWidth } from './ink.js';
import { AlternateScreen } from './engine/components/AlternateScreen.js';
import ScrollBox, { type ScrollBoxHandle } from './engine/components/ScrollBox.js';
import { useDeclaredCursor } from './engine/hooks/use-declared-cursor.js';

export interface TextSegment {
  text: string;
  dim?: boolean;
}

export interface UIMessage {
  agentName: string;
  text: string;
  kind: 'stream' | 'thinking' | 'status' | 'toolCall' | 'toolResult' | 'error' | 'userInput';
  segments?: TextSegment[];
}

export interface PermissionPrompt {
  toolName: string;
  message: string;
  details?: string;
}

export interface InkAppProps {
  greeting: string;
  messages: UIMessage[];
  inputBuffer: string;
  onInputChange: (text: string) => void;
  onInputSubmit: (text: string) => void;
  onExit: () => void;
  pendingPermission?: PermissionPrompt | null;
  onPermissionResponse?: (allowed: boolean) => void;
}

function AgentLabel({ agentName }: { agentName: string }): React.ReactElement | null {
  if (agentName === 'main') return null;
  return React.createElement(Text, { dimColor: true }, `[${agentName}] `);
}

function MessageItem({ msg }: { msg: UIMessage }): React.ReactElement {
  const colorMap: Record<string, string | undefined> = {
    stream: undefined,
    thinking: undefined,
    status: '#6b7280',
    toolCall: '#fbbf24',
    toolResult: '#10b981',
    error: '#ef4444',
    userInput: undefined,
  };

  const baseColor = colorMap[msg.kind];
  const isThink = msg.kind === 'thinking';

  // Same pattern as Claude Code's AssistantThinkingMessage:
  // <Text dimColor italic> for thinking text
  const textProps: Record<string, unknown> = {};
  if (baseColor) textProps.color = baseColor;
  if (isThink) {
    textProps.dimColor = true;
    textProps.italic = true;
  }

  return React.createElement(
    Box,
    null,
    React.createElement(
      Text,
      textProps,
      React.createElement(AgentLabel, { agentName: msg.agentName }),
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

function PermissionDialog({
  toolName, message, details, onResponse,
}: PermissionPrompt & { onResponse: (allowed: boolean) => void }): React.ReactElement {
  const options: SelectOption[] = [
    { label: '批准 (Yes)', value: 'allow' },
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
      React.createElement(Text, { bold: true, color: '#fbbf24' }, toolName),
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
    // Select options + hint
    React.createElement(
      Box,
      { flexDirection: 'column', paddingX: 1 },
      React.createElement(Select, {
        options,
        onChange: (value) => onResponse(value === 'allow'),
        onCancel: () => onResponse(false),
      }),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(Text, { dimColor: true }, 'Esc to cancel'),
      ),
    ),
  );
}

function AppContent(props: InkAppProps): React.ReactElement {
  const { messages, onInputSubmit, onExit, greeting, pendingPermission, onPermissionResponse } = props;
  const { setRawMode } = useStdin();
  const [input, setInput] = useState('');
  const [, setScrollTick] = useState(0);
  const scrollRef = useRef<ScrollBoxHandle>(null);

  // Raw mode: useLayoutEffect so it's set synchronously during commit
  useLayoutEffect(() => {
    setRawMode(true);
  }, [setRawMode]);

  // Native cursor position at the end of input text.
  // The cursor Box is right after "> " prompt (sibling in a row layout),
  // so column is just the input width — no extra offset needed.
  const cursorRef = useDeclaredCursor({
    line: 0,
    column: stringWidth(input),
    active: true,
  });

  // Subscribe to scroll position changes (for floating header)
  useEffect(() => {
    const h = scrollRef.current;
    if (!h) return;
    return h.subscribe(() => setScrollTick(n => n + 1));
  }, []);

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
    escape: boolean; ctrl: boolean; return: boolean; backspace: boolean;
    upArrow: boolean; downArrow: boolean; pageUp: boolean; pageDown: boolean;
    wheelUp: boolean; wheelDown: boolean;
  }) => {
    // When permission dialog is active, suppress normal input handling
    // (PermissionDialog has its own useInput for Allow/Deny)
    if (pendingPermission && onPermissionResponse) {
      if (key.pageUp || key.pageDown || key.wheelUp || key.wheelDown) return; // allow scroll
      return; // suppress all other input — PermissionDialog handles allow/deny
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

    if (key.escape) {
      onExit();
      return;
    }
    if (key.return) {
      if (input.trim()) {
        onInputSubmit(input.trim());
        setInput('');
      }
      return;
    }
    if (key.backspace) {
      setInput(prev => prev.slice(0, -1));
      return;
    }
    // Accept any printable input (IME composition, paste, single char)
    if (_input) {
      setInput(prev => prev + _input);
    }
  });

  // Welcome screen when no messages yet
  if (messages.length === 0) {
    return React.createElement(
      AlternateScreen,
      null,
      React.createElement(
        Box,
        { flexDirection: 'column', height: '100%' },
        React.createElement(
          Box,
          { flexDirection: 'column', flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
          React.createElement(Text, { bold: true, color: '#00aaff' }, 'nano-code 终端 AI 编程助手'),
          React.createElement(Box, { height: 1 }),
          React.createElement(Text, { dimColor: true }, greeting),
          React.createElement(Box, { height: 1 }),
          React.createElement(Text, { dimColor: true }, '输入 exit 或 quit 退出'),
        ),
        React.createElement(
          Box,
          { paddingLeft: 1, paddingRight: 1, paddingBottom: 1 },
          React.createElement(
            Box,
            {
              flexDirection: 'row',
              alignItems: 'flex-start',
              borderStyle: 'round',
              borderColor: '#6b7280',
              borderLeft: false, borderRight: false, borderBottom: true,
              width: '100%',
            },
            React.createElement(Text, { bold: true, color: '#9ca3af' }, '> '),
            React.createElement(
              Box,
              { ref: cursorRef, flexGrow: 1 },
              React.createElement(Text, null, input),
            ),
          ),
        ),
      ),
    );
  }

  // Normal conversation view
  // Three-sibling layout (ref: Claude Code FullscreenLayout):
  // - Scroll container: flexGrow=1, overflow=hidden — constrains ScrollBox
  // - Permission dialog: flexShrink=0 — between scroll and input, outside ScrollBox
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
          React.createElement(MessageItem, { key: i, msg }),
        ),
      ),
    ),
    // Permission dialog — between scroll area and input, outside ScrollBox so borderStyle renders
    pendingPermission && onPermissionResponse
      ? React.createElement(
          Box,
          { flexShrink: 0, paddingLeft: 1, paddingRight: 1 },
          React.createElement(PermissionDialog, {
            ...pendingPermission,
            onResponse: onPermissionResponse,
          }),
        )
      : null,
    // Bottom area — flexShrink=0 prevents Yoga from compressing it
    // Claude Code style: bottom-border row for prompt + input
    React.createElement(
      Box,
      { flexDirection: 'column', flexShrink: 0, paddingLeft: 1, paddingRight: 1, paddingBottom: 1, marginTop: 1 },
      React.createElement(
        Box,
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          borderStyle: 'round',
          borderColor: '#6b7280',
          borderLeft: false, borderRight: false, borderBottom: true,
          width: '100%',
        },
        React.createElement(Text, { bold: true, color: '#9ca3af' }, '> '),
        React.createElement(
          Box,
          { ref: cursorRef, flexGrow: 1 },
          React.createElement(Text, null, input),
        ),
      ),
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
