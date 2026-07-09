import * as readline from 'node:readline';

// ── Types ──

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

const OPTION_OTHER = '其它 (自定义输入)';

// ── Terminal helpers ──

const RESET = '\x1b[0m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const SAVE_CURSOR = '\x1b[s';
const RESTORE_CURSOR = '\x1b[u';
const CLEAR_DOWN = '\x1b[J';

function cjkWidth(s: string): number {
  let w = 0;
  for (const c of s) {
    const cp = c.codePointAt(0) ?? 0;
    if (cp >= 0x2e80 && cp <= 0x9fff) w += 2;
    else if (cp >= 0xff00 && cp <= 0xffef) w += 2;
    else if (cp >= 0x20000 && cp <= 0x2ffff) w += 2;
    else if (cp >= 0x3000 && cp <= 0x303f) w += 2;
    else w += 1;
  }
  return w;
}

function truncate(s: string, maxWidth: number): string {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const cw = cjkWidth(s[i]);
    if (w + cw > maxWidth) return s.slice(0, i);
    w += cw;
  }
  return s;
}

// ── Box rendering ──

const BOX_MIN_WIDTH = 40;

function boxLine(inner: string, width: number): string {
  // inner should not exceed width - 4 (║ pad pad ║)
  const maxInner = width - 4;
  const truncated = truncate(inner, maxInner);
  const pad = maxInner - cjkWidth(truncated);
  return `\x1b[33m║\x1b[0m ${truncated}${' '.repeat(pad)} \x1b[33m║\x1b[0m`;
}

function boxTop(label: string, width: number): string {
  const inner = ` ${label} `;
  const remaining = width - 4 - cjkWidth(inner);
  const left = Math.ceil(remaining / 2);
  const right = Math.floor(remaining / 2);
  return `\x1b[33m╔${'═'.repeat(left)}${inner}${'═'.repeat(right)}╗\x1b[0m`;
}

function boxSep(width: number): string {
  return `\x1b[33m╠${'═'.repeat(width - 2)}╣\x1b[0m`;
}

function boxBottom(width: number): string {
  return `\x1b[33m╚${'═'.repeat(width - 2)}╝\x1b[0m`;
}

/** Build the options list lines for the selecting state */
function buildSelectingLines(
  q: Question,
  focusIdx: number,
  selected: string[],
  width: number,
): string[] {
  const allOptions = [...q.options, { label: OPTION_OTHER, description: '输入自定义文本' }];
  const lines: string[] = [];

  // Question header
  lines.push(boxLine(`${YELLOW}❓\x1b[0m ${q.header}`, width));
  lines.push(boxLine('', width));
  lines.push(boxLine(q.question, width));
  lines.push(boxLine('', width));

  // Options
  for (let i = 0; i < allOptions.length; i++) {
    const opt = allOptions[i];
    const isFocused = i === focusIdx;
    const isSelected = selected.includes(opt.label);
    const isOther = opt.label === OPTION_OTHER;

    let indicator: string;
    if (isOther) {
      indicator = isSelected ? '✎' : '✎';
    } else if (q.multiSelect) {
      indicator = isSelected ? '☑' : '☐';
    } else {
      indicator = isFocused ? '◉' : '○';
    }

    const prefix = isFocused ? `${CYAN}❯ ${indicator}\x1b[0m ` : `  ${indicator} `;
    const labelStyle = isFocused ? `${CYAN}${opt.label}\x1b[0m` : opt.label;
    const line = cjkWidth(prefix) > 0
      ? `${prefix}${labelStyle}`
      : `  ${labelStyle}`;
    lines.push(boxLine(line, width));
  }

  // Description of focused option
  lines.push(boxLine('', width));
  const desc = allOptions[focusIdx]?.description || '';
  if (desc) {
    lines.push(boxLine(`${DIM}→\x1b[0m ${desc}`, width));
  }

  // Navigation hint
  lines.push(boxLine('', width));
  if (q.multiSelect) {
    lines.push(boxLine(`${DIM}↑↓ 选择  Space 切换  ←→ 切换问题  Enter 确认  Esc 取消\x1b[0m`, width));
  } else {
    lines.push(boxLine(`${DIM}↑↓ 选择  Enter 确认  ←→ 切换问题  Esc 取消\x1b[0m`, width));
  }

  return lines;
}

function buildCustomInputLines(q: Question, text: string, width: number): string[] {
  const lines: string[] = [];
  lines.push(boxLine(`${CYAN}✎\x1b[0m ${q.header} - 自定义输入`, width));
  lines.push(boxLine('', width));
  lines.push(boxLine(q.question, width));
  lines.push(boxLine('', width));

  // Input box
  const innerWidth = width - 6;
  const displayText = text || ' ';
  const displayLine = truncate(displayText, innerWidth);
  const pad = innerWidth - cjkWidth(displayLine);

  lines.push(boxLine(` ${DIM}┌${'─'.repeat(innerWidth)}┐\x1b[0m`, width));
  lines.push(boxLine(` ${DIM}│\x1b[0m ${displayLine}${' '.repeat(pad)} ${DIM}│\x1b[0m`, width));
  lines.push(boxLine(` ${DIM}└${'─'.repeat(innerWidth)}┘\x1b[0m`, width));

  lines.push(boxLine('', width));
  lines.push(boxLine(`${DIM}Enter 确认  Esc 返回${' '.repeat(Math.max(0, innerWidth - 16))}`, width));

  return lines;
}

function buildConfirmLines(
  questions: Question[],
  selections: Record<string, string[]>,
  customInputs: Record<string, string>,
  width: number,
): string[] {
  const lines: string[] = [];
  lines.push(boxLine(`${GREEN}✓\x1b[0m 确认你的回答`, width));
  lines.push(boxLine('', width));

  for (const q of questions) {
    const sel = selections[q.question] || [];
    const hasOther = sel.includes(OPTION_OTHER);
    const custom = customInputs[q.question] || '';
    const normalSel = sel.filter(s => s !== OPTION_OTHER);
    const display = hasOther && custom ? custom : normalSel.join(', ') || (hasOther ? '(空)' : '(未选择)');
    lines.push(boxLine(`${YELLOW}[${q.header}]\x1b[0m ${q.question}`, width));
    for (const line of display.split('\n')) {
      lines.push(boxLine(`  ${GREEN}→\x1b[0m ${line}`, width));
    }
    lines.push(boxLine('', width));
  }

  lines.push(boxLine(`${DIM}Enter 确认提交  Esc 返回修改\x1b[0m`, width));
  return lines;
}

// ── Dialog state machine ──

type DialogScreen = 'selecting' | 'customInput' | 'confirmSummary' | '__submit';

interface DialogState {
  questions: Question[];
  currentIdx: number;
  focusIdx: number;
  selections: Record<string, string[]>;
  customInputs: Record<string, string>;
  customText: string;
  screen: DialogScreen;
}

function initialSelections(questions: Question[]): Record<string, string[]> {
  const s: Record<string, string[]> = {};
  for (const q of questions) s[q.question] = [];
  return s;
}

function allAnswered(state: DialogState): boolean {
  return state.questions.every(q => {
    const sel = state.selections[q.question] || [];
    return sel.length > 0;
  });
}

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

// ── Terminal output rendering ──

function renderDialog(state: DialogState): void {
  const width = Math.max(BOX_MIN_WIDTH, Math.min(76, (process.stdout.columns ?? 80) - 2));

  let lines: string[];
  let topLabel: string;

  if (state.screen === 'customInput') {
    const q = state.questions[state.currentIdx];
    topLabel = `${q.header} - 自定义输入`;
    lines = buildCustomInputLines(q, state.customText, width);
  } else if (state.screen === 'confirmSummary') {
    topLabel = '确认回答';
    lines = buildConfirmLines(state.questions, state.selections, state.customInputs, width);
  } else {
    const q = state.questions[state.currentIdx];
    const allOptions = [...q.options, { label: OPTION_OTHER, description: '输入自定义文本' }];
    topLabel = `${q.header} (${state.currentIdx + 1}/${state.questions.length})`;
    lines = buildSelectingLines(q, state.focusIdx, state.selections[q.question] || [], width);
  }

  // Build full box
  const output = [
    boxTop(topLabel, width),
    ...lines,
    boxBottom(width),
  ].join('\n');

  // First render or re-render
  if (state.screen === 'selecting' && state.currentIdx === 0 && state.focusIdx === 0 &&
      Object.values(state.selections).every(s => s.length === 0) && state.customText === '') {
    // First render — just output
    process.stdout.write(output + '\n');
  } else {
    // Re-render — restore cursor and clear
    process.stdout.write(RESTORE_CURSOR + CLEAR_DOWN + output + '\n');
  }
}

// ── Input processing (pure function for testability) ──

interface Key {
  name?: string;
  ctrl?: boolean;
  shift?: boolean;
  return?: boolean;
  escape?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  space?: boolean;
  backspace?: boolean;
  delete?: boolean;
  tab?: boolean;
}

function processKeypress(state: DialogState, key: Key, input: string): DialogState | null {
  // null = no change
  const s = { ...state };

  if (s.screen === 'selecting') {
    if (key.escape) {
      // Cancel — return empty answers (signal with screen='confirmSummary' but no data)
      // We use a special sentinel: return null to parent
      return { ...s, screen: 'confirmSummary' as DialogScreen };
    }

    if (key.downArrow) {
      const optionCount = s.questions[s.currentIdx].options.length + 1; // +1 for "Other"
      return { ...s, focusIdx: Math.min(optionCount - 1, s.focusIdx + 1) };
    }

    if (key.upArrow) {
      return { ...s, focusIdx: Math.max(0, s.focusIdx - 1) };
    }

    if (key.leftArrow && s.currentIdx > 0) {
      return { ...s, currentIdx: s.currentIdx - 1, focusIdx: 0 };
    }

    if (key.rightArrow && s.currentIdx < s.questions.length - 1) {
      const sel = s.selections[s.questions[s.currentIdx].question] || [];
      if (s.questions[s.currentIdx].multiSelect && sel.length === 0) return null;
      if (sel.includes(OPTION_OTHER)) {
        return { ...s, customText: s.customInputs[s.questions[s.currentIdx].question] || '', screen: 'customInput' as DialogScreen };
      }
      return { ...s, currentIdx: s.currentIdx + 1, focusIdx: 0 };
    }

    if (key.space && s.questions[s.currentIdx].multiSelect) {
      const q = s.questions[s.currentIdx];
      const prev = [...(s.selections[q.question] || [])];
      const isOther = s.focusIdx === q.options.length;
      if (isOther) {
        const idx = prev.indexOf(OPTION_OTHER);
        if (idx >= 0) prev.splice(idx, 1);
        else prev.push(OPTION_OTHER);
      } else {
        const label = q.options[s.focusIdx].label;
        const idx = prev.indexOf(label);
        if (idx >= 0) prev.splice(idx, 1);
        else prev.push(label);
      }
      return { ...s, selections: { ...s.selections, [q.question]: prev } };
    }

    if (key.return || key.space) {
      const q = s.questions[s.currentIdx];
      const isOther = s.focusIdx === q.options.length;

      if (q.multiSelect) {
        if (isOther) {
          return null; // multi-select + Other: don't auto-advance, let user toggle
        }
        // In multi-select, Enter with space already toggles; Enter alone just advances
        const sel = s.selections[q.question] || [];
        if (sel.length === 0) return null;
        // If "其它" is selected and no custom input yet, go to customInput screen
        if (sel.includes(OPTION_OTHER) && !s.customInputs[q.question]) {
          return {
            ...s,
            customText: '',
            screen: 'customInput' as DialogScreen,
          };
        }
        if (s.currentIdx < s.questions.length - 1) {
          return { ...s, currentIdx: s.currentIdx + 1, focusIdx: 0 };
        }
        // Last question: go to confirm
        if (allAnswered(s)) {
          return { ...s, screen: 'confirmSummary' as DialogScreen };
        }
        return null;
      }

      // Single select
      if (isOther) {
        return {
          ...s,
          selections: { ...s.selections, [q.question]: [OPTION_OTHER] },
          customText: s.customInputs[q.question] || '',
          screen: 'customInput' as DialogScreen,
        };
      }

      const updated = { ...s.selections, [q.question]: [q.options[s.focusIdx].label] };
      const newState = { ...s, selections: updated };
      if (s.currentIdx < s.questions.length - 1) {
        // Advance to next question on right arrow or Enter
        return { ...newState, currentIdx: s.currentIdx + 1, focusIdx: 0 };
      }
      if (allAnswered(newState)) {
        return { ...newState, screen: 'confirmSummary' as DialogScreen };
      }
      return null;
    }

    if (key.tab && s.currentIdx === s.questions.length - 1) {
      if (allAnswered(s)) {
        return { ...s, screen: 'confirmSummary' as DialogScreen };
      }
    }

    if (s.questions[s.currentIdx].multiSelect && key.rightArrow && s.currentIdx < s.questions.length - 1) {
      // Already handled above by the leftArrow/rightArrow block
    }

    return null;
  }

  if (s.screen === 'customInput') {
    if (key.escape) {
      return { ...s, screen: 'selecting' as DialogScreen };
    }

    if (key.return) {
      if (key.shift) {
        // Shift+Enter for multiline — not supported in REPL dialog for simplicity
        return null;
      }
      // Save custom text
      const q = s.questions[s.currentIdx];
      const updated = { ...s.customInputs, [q.question]: s.customText };
      const newState = { ...s, customInputs: updated, customText: '', screen: 'selecting' as DialogScreen };
      // If last question and all answered, go to confirm
      if (s.currentIdx === s.questions.length - 1 && allAnswered(newState)) {
        return { ...newState, screen: 'confirmSummary' as DialogScreen };
      }
      return newState;
    }

    if (key.backspace || key.delete) {
      return { ...s, customText: s.customText.slice(0, -1) };
    }

    // Printable characters
    if (input && input.length > 0 && !key.ctrl && !key.tab && !key.escape && !key.return) {
      return { ...s, customText: s.customText + input };
    }

    return null;
  }

  if (s.screen === 'confirmSummary') {
    if (key.escape) {
      // Return to last question
      return { ...s, screen: 'selecting' as DialogScreen, currentIdx: s.questions.length - 1 };
    }

    if (key.return || key.tab) {
      // Final submit — return a marker that signals resolution
      return { ...s, screen: '__submit' as DialogScreen };
    }

    return null;
  }

  return null;
}

// ── Main entry point ──

export async function askQuestionsDialog(questions: Question[]): Promise<Record<string, string>> {
  return new Promise<Record<string, string>>((resolve) => {
    // Set up raw mode
    const wasRaw = process.stdin.isTTY && (process.stdin as any).isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin);

    const wasRawMode = process.stdin.isTTY ? (process.stdin as any).isRaw : false;

    const state: DialogState = {
      questions,
      currentIdx: 0,
      focusIdx: 0,
      selections: initialSelections(questions),
      customInputs: {},
      customText: '',
      screen: 'selecting',
    };

    // Save cursor position for re-rendering
    process.stdout.write(SAVE_CURSOR);

    // Handle terminal resize
    const onResize = () => {
      renderDialog(currentState);
    };
    process.stdout.on('resize', onResize);

    let currentState = state;
    let firstRender = true;

    function cleanup() {
      process.stdout.removeListener('resize', onResize);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.removeListener('keypress', onKeypress);
    }

    function onKeypress(_input: string, key: readline.Key) {
      // Ctrl+C must be checked before state processing
      if (key.ctrl && key.name === 'c') {
        cleanup();
        resolve({});
        return;
      }

      const processed = processKeypress(currentState, key as Key, _input);

      if (processed === null) return;

      if (processed.screen === '__submit') {
        cleanup();
        const answers = buildAnswers(currentState.questions, currentState.selections, currentState.customInputs);
        resolve(answers);
        return;
      }

      // If escape was pressed during selecting and nothing answered — cancel all
      if (currentState.screen === 'selecting' && processed.screen === 'confirmSummary' &&
          Object.values(processed.selections).every(s => s.length === 0)) {
        // This means the user pressed Esc to cancel everything
        cleanup();
        resolve({});
        return;
      }

      currentState = processed;
      renderDialog(currentState);
    }

    process.stdin.on('keypress', onKeypress);

    // Render first frame
    renderDialog(currentState);
    firstRender = false;
  });
}
