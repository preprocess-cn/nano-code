import React, { useState } from 'react';
import { Box, Text, useInput } from '#src/plugins/display/claude-code-ink/ink.js';

interface Option {
  label: string;
  description: string;
  preview?: string;
}

interface Question {
  question: string;
  header: string;
  options: Option[];
  multiSelect?: boolean;
}

interface QuestionsDialogProps {
  questions: Question[];
  onResponse: (answers: Record<string, string>) => void;
}

const OPTION_OTHER = '其它 (自定义输入)';

function buildAnswers(
  questions: Question[],
  selections: Record<string, string[]>,
  customInputs: Record<string, string>,
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const sel = selections[q.question] || [];
    if (sel.includes(OPTION_OTHER)) {
      answers[q.question] = customInputs[q.question] || '';
    } else {
      answers[q.question] = sel.join(', ');
    }
  }
  return answers;
}

function allQuestionsAnswered(
  questions: Question[],
  selections: Record<string, string[]>,
): boolean {
  return questions.every(q => {
    const sel = selections[q.question] || [];
    if (sel.length === 0) return false;
    if (sel.includes(OPTION_OTHER)) return true; // custom input counts as answered
    return sel.length > 0;
  });
}

export function QuestionsDialog({ questions, onResponse }: QuestionsDialogProps): React.ReactElement {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selections, setSelections] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const q of questions) {
      initial[q.question] = [];
    }
    return initial;
  });
  const [focusIdx, setFocusIdx] = useState(0);
  const [screen, setScreen] = useState<'selecting' | 'customInput' | 'confirming'>('selecting');
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [customText, setCustomText] = useState('');

  const current = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;
  const allOptions = [...current.options, { label: OPTION_OTHER, description: '输入自定义文本' }];
  const selectedForCurrent = selections[current.question] || [];

  useInput((_input: string, key: {
    upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean;
    return?: boolean; tab?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean;
    shift?: boolean; ctrl?: boolean;
  }) => {
    // ── SELECTING screen ──
    if (screen === 'selecting') {
      if (key.escape) {
        onResponse({});
        return;
      }
      if (key.upArrow) {
        setFocusIdx(Math.max(0, focusIdx - 1));
        return;
      }
      if (key.downArrow) {
        setFocusIdx(Math.min(allOptions.length - 1, focusIdx + 1));
        return;
      }
      if (key.return) {
        const isOther = focusIdx === allOptions.length - 1;
        if (current.multiSelect) {
          const prev = selections[current.question] || [];
          if (isOther) {
            // Toggle "Other" and go to custom input
            const idx = prev.indexOf(OPTION_OTHER);
            const next = idx >= 0 ? prev.filter(o => o !== OPTION_OTHER) : [...prev, OPTION_OTHER];
            setSelections({ ...selections, [current.question]: next });
            setCustomText(customInputs[current.question] || '');
            setScreen('customInput');
          } else {
            const idx = prev.indexOf(current.options[focusIdx].label);
            if (idx >= 0) {
              setSelections({ ...selections, [current.question]: prev.filter((_, i) => i !== idx) });
            } else {
              setSelections({ ...selections, [current.question]: [...prev, current.options[focusIdx].label] });
            }
          }
        } else {
          if (isOther) {
            setSelections({ ...selections, [current.question]: [OPTION_OTHER] });
            setCustomText(customInputs[current.question] || '');
            setScreen('customInput');
          } else {
            const updated = { ...selections, [current.question]: [current.options[focusIdx].label] };
            setSelections(updated);
            if (allQuestionsAnswered(questions, updated)) {
              setScreen('confirming');
            } else {
              setCurrentIdx(currentIdx + 1);
              setFocusIdx(0);
            }
          }
        }
        return;
      }
      if (key.leftArrow && currentIdx > 0) {
        setCurrentIdx(currentIdx - 1);
        setFocusIdx(0);
        return;
      }
      if (key.rightArrow && !isLast) {
        const sel = selections[current.question] || [];
        if (current.multiSelect ? sel.length > 0 : true) {
          if (sel.includes(OPTION_OTHER)) {
            setCustomText(customInputs[current.question] || '');
            setScreen('customInput');
          } else {
            setCurrentIdx(currentIdx + 1);
            setFocusIdx(0);
          }
        }
        return;
      }
      if (key.tab && isLast) {
        if (allQuestionsAnswered(questions, selections)) {
          setScreen('confirming');
        }
        return;
      }
      return;
    }

    // ── CUSTOM INPUT screen ──
    if (screen === 'customInput') {
      if (key.escape) {
        setScreen('selecting');
        return;
      }
      if (key.return) {
        if (key.shift) {
          setCustomText(customText + '\n');
          return;
        }
        // Save custom text
        const updated = { ...customInputs, [current.question]: customText };
        setCustomInputs(updated);
        setCustomText('');
        if (allQuestionsAnswered(questions, selections) && isLast) {
          setScreen('confirming');
        } else {
          setScreen('selecting');
        }
        return;
      }
      if (key.backspace || key.delete) {
        setCustomText(customText.slice(0, -1));
        return;
      }
      // Printable input
      if (_input && _input.length > 0 && !key.ctrl && !key.tab) {
        setCustomText(customText + _input);
        return;
      }
      return;
    }

    // ── CONFIRMING screen ──
    if (screen === 'confirming') {
      if (key.escape) {
        setScreen('selecting');
        setCurrentIdx(questions.length - 1);
        return;
      }
      if (key.return || key.tab) {
        onResponse(buildAnswers(questions, selections, customInputs));
        return;
      }
      return;
    }
  });

  // ── SELECTING render ──
  if (screen === 'selecting') {
    return React.createElement(
      Box,
      { flexDirection: 'column', borderStyle: 'round', borderColor: 'yellow', padding: 1, marginTop: 1 },
      // Header: question tabs/progress
      React.createElement(
        Box,
        { marginBottom: 1 },
        React.createElement(Text, { bold: true, color: 'yellow' }, `❓ ${current.header}`),
        React.createElement(Text, { dimColor: true }, `  (${currentIdx + 1}/${questions.length})`),
      ),
      // Question text
      React.createElement(Text, null, current.question),
      // Options (including "Other")
      ...allOptions.map((opt, i) => {
        const focused = i === focusIdx;
        const isOther = opt.label === OPTION_OTHER;
        const isSelected = selectedForCurrent.includes(opt.label);
        return React.createElement(
          Box,
          { key: i, marginTop: 1 },
          React.createElement(
            Text,
            {
              color: focused ? 'cyan' : undefined,
              bold: focused,
              inverse: focused,
            },
            focused ? '❯ ' : '  ',
            isOther
              ? (isSelected ? '✎ ' : '✎ ')
              : current.multiSelect
                ? (isSelected ? '☑ ' : '☐ ')
                : (focused ? '◉ ' : '○ '),
            opt.label,
          ),
        );
      }),
      // Description of focused option
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { dimColor: true }, allOptions[focusIdx]?.description || ''),
      ),
      // Navigation hints
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(
          Text,
          { dimColor: true },
          current.multiSelect
            ? '↑↓ 翻轮  Enter 切换选中  ←→ 切换问题  Tab 提交  Esc 取消'
            : '↑↓ 翻轮  Enter 确认  ←→ 切换问题  Esc 取消',
        ),
      ),
    );
  }

  // ── CUSTOM INPUT render ──
  if (screen === 'customInput') {
    const textLines = customText.length > 0 ? customText.split('\n') : [' '];
    return React.createElement(
      Box,
      { flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan', padding: 1, marginTop: 1 },
      React.createElement(Text, { bold: true, color: 'cyan' }, `✎ ${current.header} - 自定义输入`),
      React.createElement(Text, null, current.question),
      React.createElement(
        Box,
        { marginTop: 1, borderStyle: 'round', borderColor: '#6b7280', paddingX: 1, paddingY: 1, minHeight: 3 },
        ...textLines.map((line, i) =>
          React.createElement(Text, { key: i }, line),
        ),
      ),
      React.createElement(
        Text,
        { dimColor: true, marginTop: 1 },
        'Enter 确认 · Shift+Enter 换行 · Esc 返回',
      ),
    );
  }

  // ── CONFIRMING render ──
  if (screen === 'confirming') {
    return React.createElement(
      Box,
      { flexDirection: 'column', borderStyle: 'round', borderColor: 'green', padding: 1, marginTop: 1 },
      React.createElement(Text, { bold: true, color: 'green' }, '✓ 确认你的回答:'),
      ...questions.map((q, i) => {
        const sel = selections[q.question] || [];
        const hasOther = sel.includes(OPTION_OTHER);
        const custom = customInputs[q.question] || '';
        const normalSel = sel.filter(s => s !== OPTION_OTHER);
        const display = hasOther && custom ? custom : normalSel.join(', ') || (hasOther ? '(空)' : '(未选择)');
        return React.createElement(
          Box,
          { key: i, marginTop: 1 },
          React.createElement(Text, { bold: true, color: 'yellow' }, `[${q.header}] ${q.question}`),
          ...display.split('\n').map((line, j) =>
            React.createElement(Text, { key: j, color: hasOther && custom ? 'green' : undefined }, `  → ${line}`),
          ),
        );
      }),
      React.createElement(
        Text,
        { dimColor: true, marginTop: 1 },
        'Enter 确认提交 · Esc 返回修改',
      ),
    );
  }

  return React.createElement(Text, null, '');
}
