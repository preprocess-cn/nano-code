import { debugLog } from '../utils/debugLog.js';
import { c as _c } from 'react/compiler-runtime';
import type { RefObject } from 'react';
import * as React from 'react';
import {
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useVirtualScroll } from '../engine/hooks/useVirtualScroll.js';
import type { ScrollBoxHandle } from '../engine/components/ScrollBox.js';
import type { DOMElement } from '../engine/dom.js';
import type { MatchPosition } from '../engine/render-to-screen.js';
import { Box } from '../ink.js';
import { ScrollChromeContext, type StickyPrompt } from '../components/ScrollChromeContext.js';
import { extractSearchText } from '../utils/transcriptSearch.js';
import type { UIMessage } from '../InkApp.js';

const HEADROOM = 3;
const STICKY_TEXT_CAP = 500;

function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

function computeStickyPromptText(msg: UIMessage): string | null {
  if (msg.kind !== 'userInput') return null;
  const t = stripSystemReminders(msg.text);
  if (t.startsWith('<') || t === '') return null;
  return t;
}

const promptTextCache = new WeakMap<UIMessage, string | null>();
function stickyPromptText(msg: UIMessage): string | null {
  const cached = promptTextCache.get(msg);
  if (cached !== undefined) return cached;
  const result = computeStickyPromptText(msg);
  promptTextCache.set(msg, result);
  return result;
}

function collapseText(raw: string): string {
  const trimmed = raw.trimStart();
  const paraEnd = trimmed.search(/\n\s*\n/);
  return (paraEnd >= 0 ? trimmed.slice(0, paraEnd) : trimmed)
    .slice(0, STICKY_TEXT_CAP)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Imperative handle for transcript search navigation */
export type JumpHandle = {
  jumpToIndex: (i: number) => void;
  setSearchQuery: (q: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  setAnchor: () => void;
  warmSearchIndex: () => Promise<number>;
  disarmSearch: () => void;
};

/** Nav handle for cursor-based message selection */
export type MessageActionsNav = {
  selectNext: () => void;
  selectPrev: () => void;
  isNavigable: (idx: number) => boolean;
};

type Props = {
  messages: UIMessage[];
  scrollRef: RefObject<ScrollBoxHandle | null>;
  columns: number;
  itemKey: (msg: UIMessage, index: number) => string;
  renderItem: (msg: UIMessage, index: number) => React.ReactNode;
  onItemClick?: (msg: UIMessage) => void;
  isItemClickable?: (msg: UIMessage) => boolean;
  isItemExpanded?: (msg: UIMessage) => boolean;
  extractSearchText?: (msg: UIMessage) => string;
  trackStickyPrompt?: boolean;
  cursorNavRef?: React.Ref<MessageActionsNav>;
  jumpRef?: RefObject<JumpHandle | null>;
  onSearchMatchesChange?: (count: number, current: number) => void;
  scanElement?: (el: DOMElement) => MatchPosition[];
  setPositions?: (state: { positions: MatchPosition[]; rowOffset: number; currentIdx: number; colOffset?: number } | null) => void;
};

type VirtualItemProps = {
  itemKey: string;
  msg: UIMessage;
  idx: number;
  measureRef: (key: string) => (el: DOMElement | null) => void;
  expanded: boolean | undefined;
  hovered: boolean;
  clickable: boolean;
  onClickK: (msg: UIMessage, cellIsBlank: boolean) => void;
  onEnterK: (k: string) => void;
  onLeaveK: (k: string) => void;
  renderItem: (msg: UIMessage, idx: number) => React.ReactNode;
};

function VirtualItem(t0: VirtualItemProps) {
  const $ = _c(30);
  const { itemKey: k, msg, idx, measureRef, expanded, hovered, clickable, onClickK, onEnterK, onLeaveK, renderItem } = t0;
  let t1;
  if ($[0] !== k || $[1] !== measureRef) {
    t1 = measureRef(k);
    $[0] = k;
    $[1] = measureRef;
    $[2] = t1;
  } else { t1 = $[2]; }
  const bg = expanded ? 'userMessageBackgroundHover' : undefined;
  const pb = expanded ? 1 : undefined;
  let t2;
  if ($[3] !== clickable || $[4] !== msg || $[5] !== onClickK) {
    t2 = clickable ? (e: any) => onClickK(msg, e.cellIsBlank) : undefined;
    $[3] = clickable; $[4] = msg; $[5] = onClickK; $[6] = t2;
  } else { t2 = $[6]; }
  let t3;
  if ($[7] !== clickable || $[8] !== k || $[9] !== onEnterK) {
    t3 = clickable ? () => onEnterK(k) : undefined;
    $[7] = clickable; $[8] = k; $[9] = onEnterK; $[10] = t3;
  } else { t3 = $[10]; }
  let t4;
  if ($[11] !== clickable || $[12] !== k || $[13] !== onLeaveK) {
    t4 = clickable ? () => onLeaveK(k) : undefined;
    $[11] = clickable; $[12] = k; $[13] = onLeaveK; $[14] = t4;
  } else { t4 = $[14]; }
  const hoverStyle = hovered && !expanded ? 'text' : undefined;
  let t5;
  if ($[15] !== idx || $[16] !== msg || $[17] !== renderItem) {
    t5 = renderItem(msg, idx);
    $[15] = idx; $[16] = msg; $[17] = renderItem; $[18] = t5;
  } else { t5 = $[18]; }
  let t6;
  if ($[19] !== hoverStyle || $[20] !== t5) {
    t6 = React.createElement(Box, { flexDirection: 'column' }, t5);
    $[19] = hoverStyle; $[20] = t5; $[21] = t6;
  } else { t6 = $[21]; }
  let t7;
  if ($[22] !== t1 || $[23] !== bg || $[24] !== pb || $[25] !== t2 || $[26] !== t3 || $[27] !== t4 || $[28] !== t6) {
    t7 = React.createElement(Box, { ref: t1, flexDirection: 'column', backgroundColor: bg, paddingBottom: pb, onClick: t2, onMouseEnter: t3, onMouseLeave: t4 }, t6);
    $[22] = t1; $[23] = bg; $[24] = pb; $[25] = t2; $[26] = t3; $[27] = t4; $[28] = t6; $[29] = t7;
  } else { t7 = $[29]; }
  return t7;
}

export function VirtualMessageList({
  messages,
  scrollRef,
  columns,
  itemKey,
  renderItem,
  onItemClick,
  isItemClickable = () => true,
  isItemExpanded = () => false,
  extractSearchText: extractSearchTextProp,
  trackStickyPrompt,
  cursorNavRef,
  jumpRef,
  onSearchMatchesChange,
  scanElement,
  setPositions,
}: Props): React.ReactElement {
  const keysRef = useRef<string[]>([]);
  const prevMessagesRef = useRef<typeof messages>(messages);
  const prevItemKeyRef = useRef(itemKey);
  if (prevItemKeyRef.current !== itemKey || messages.length < keysRef.current.length || messages[0] !== prevMessagesRef.current[0]) {
    keysRef.current = messages.map((m, i) => itemKey(m, i));
  } else {
    for (let i = keysRef.current.length; i < messages.length; i++) {
      keysRef.current.push(itemKey(messages[i]!, i));
    }
  }
  prevMessagesRef.current = messages;
  prevItemKeyRef.current = itemKey;
  const keys = keysRef.current;

  const {
    range,
    topSpacer,
    bottomSpacer,
    measureRef,
    spacerRef,
    offsets,
    getItemTop,
    getItemElement,
    getItemHeight,
    scrollToIndex,
  } = useVirtualScroll(scrollRef, keys, columns);

  const [start, end] = range;

  // ── Cursor / hover state ──
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const isNavigable = useCallback((idx: number) => {
    const h = getItemHeight(idx);
    if (h === 0) return false;
    return idx >= 0 && idx < messages.length;
  }, [getItemHeight, messages.length]);

  const navHandle = useRef<MessageActionsNav>({
    selectNext: () => {
      setSelectedIdx(prev => {
        if (prev === null) return 0;
        let next = prev + 1;
        while (next < messages.length && !isNavigable(next)) next++;
        return next < messages.length ? next : prev;
      });
    },
    selectPrev: () => {
      setSelectedIdx(prev => {
        if (prev === null) return messages.length - 1;
        let next = prev - 1;
        while (next >= 0 && !isNavigable(next)) next--;
        return next >= 0 ? next : prev;
      });
    },
    isNavigable,
  });
  React.useImperativeHandle(cursorNavRef, () => navHandle.current, [isNavigable]);

  // ── Jump/ search handle (CC 两阶段 Jump + Seek) ──
  const extractFn = extractSearchTextProp || extractSearchText;
  const anchorRef = useRef(0);

  // Ref-based jump state — avoids React re-render timing issues
  const jumpState = useRef({ offsets, getItemElement, getItemTop, messages, scrollToIndex });
  jumpState.current = { offsets, getItemElement, getItemTop, messages, scrollToIndex };

  const scanRequestRef = useRef<{ idx: number; wantLast: boolean; tries: number } | null>(null);
  const pendingStepRef = useRef<1 | -1 | 0>(0);
  const elementPositions = useRef<{ msgIdx: number; positions: MatchPosition[] }>({ msgIdx: -1, positions: [] });
  const startPtrRef = useRef(-1);

  // CC 风格两级导航：消息级 + 位置级
  const searchState = useRef({
    matches: [] as number[],
    ptr: 0,
    screenOrd: 0,
    prefixSum: [] as number[],
  });

  const [seekGen, setSeekGen] = useState(0);
  const bumpSeek = useCallback(() => setSeekGen(g => g + 1), []);

  const stepRef = useRef<(d: 1 | -1) => void>(() => {});
  const highlightRef = useRef<(ord: number) => void>(() => {});

  // 遍历 Yoga 树计算元素在屏幕上的左列偏移
  const getScreenLeft = useCallback((el: DOMElement | null | undefined): number => {
    if (!el?.yogaNode) return 0;
    let left = 0;
    let node: { getComputedLeft: () => number; getParent?: () => unknown } | null = el.yogaNode;
    while (node) {
      left += node.getComputedLeft();
      node = (node as any).getParent?.() ?? null;
    }
    return Math.round(left);
  }, []);

  const onSearchMatchesChangeRef = useRef(onSearchMatchesChange);
  onSearchMatchesChangeRef.current = onSearchMatchesChange;

  // Seek effect — CC-aligned: scanRequestRef → find element → scan → highlight.
  // Dep is ONLY seekGen. bump → re-render → useVirtualScroll mounts the target
  // → resetAfterCommit paints → this passive effect fires POST-PAINT.
  useEffect(() => {
    const req = scanRequestRef.current;
    if (!req) return;
    const { idx, wantLast, tries } = req;
    const s = scrollRef.current;
    if (!s) return;
    const js = jumpState.current;
    const { getItemElement, getItemTop, scrollToIndex: sTI } = js;
    const el = getItemElement(idx);
    const h = el?.yogaNode?.getComputedHeight() ?? 0;
    debugLog(`seek-effect: seekGen seek idx=${idx} wantLast=${wantLast} tries=${tries} el=${el ? 'found' : 'NULL'} h=${h} scrollTop=${s.getScrollTop()}`);

    if (!el || h === 0) {
      if (tries > 1) {
        debugLog(`seek-effect: GAVE UP after tries=${tries}`);
        scanRequestRef.current = null;
        stepRef.current(wantLast ? -1 : 1);
        return;
      }
      scanRequestRef.current = { idx, wantLast, tries: tries + 1 };
      sTI(idx);
      bumpSeek();
      return;
    }
    scanRequestRef.current = null;

    // Precise scrollTo — scrollToIndex/jump got us in the neighborhood.
    const target = Math.max(0, getItemTop(idx) - HEADROOM);
    debugLog(`seek-scroll: before scrollTop=${s.getScrollTop()} target=${target}`);
    s.scrollTo(target);
    debugLog(`seek-scroll: after scrollTop=${s.getScrollTop()}`);

    const rawPositions = scanElement?.(el) ?? [];
    debugLog(`seek-scan: n=${rawPositions.length} itemTop=${getItemTop(idx)} first=${rawPositions[0] ? `${rawPositions[0].row}:${rawPositions[0].col}` : 'none'} last=${rawPositions.at(-1) ? `${rawPositions.at(-1)!.row}:${rawPositions.at(-1)!.col}` : 'none'}`);
    elementPositions.current = { msgIdx: idx, positions: rawPositions };

    if (rawPositions.length > 0) {
      const ord = wantLast ? rawPositions.length - 1 : 0;
      searchState.current.screenOrd = ord;
      startPtrRef.current = -1;
      debugLog(`seek-highlight: calling highlight(ord=${ord})`);
      highlightRef.current(ord);
    }

    const p = pendingStepRef.current;
    if (p) { pendingStepRef.current = 0; stepRef.current(p); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekGen]);

  // highlight — CC-aligned plain function (not useCallback). Reads all state
  // from refs; always fresh. Callers (seek effect, step, scroll-subscribe)
  // set searchState.screenOrd BEFORE calling this.
  function highlight(ord: number): void {
    debugLog(`highlight-enter: ord=${ord} ep.msgIdx=${elementPositions.current.msgIdx} ep.positions.length=${elementPositions.current.positions.length}`);
    const ep = elementPositions.current;
    const s = scrollRef.current;
    if (!s || !ep.positions.length || ep.msgIdx < 0) {
      setPositions?.(null);
      return;
    }
    const js = jumpState.current;
    const idx = Math.max(0, Math.min(ord, ep.positions.length - 1));
    const p = ep.positions[idx]!;
    const top = js.getItemTop(ep.msgIdx);
    if (top < 0) { setPositions?.(null); return; }
    const vpTop = s.getViewportTop();
    const vp = s.getViewportHeight();
    let lo = top - s.getScrollTop();
    let screenRow = vpTop + lo + p.row;
    // Badge update (always fire, even before potential scroll)
    const st = searchState.current;
    const total = st.prefixSum.at(-1) ?? 0;
    const current = (st.prefixSum[st.ptr] ?? 0) + idx + 1;
    onSearchMatchesChangeRef.current?.(total, current);

    if (screenRow < vpTop || screenRow >= vpTop + vp) {
      // Position is off-screen. scrollTo sets node.scrollTop, but the
      // renderer clamps to maxScroll = scrollHeight - vp (render-node-to-
      // output.ts:841). getScrollTop() returns the unclamped target, so
      // computing rowOffset from it produces a mismatch. Pre-clamp the
      // target so scrollTo + getScrollTop agree with the renderer.
      const rawTarget = Math.max(0, top + p.row - HEADROOM);
      const maxScroll = Math.max(0, s.getScrollHeight() - vp);
      const target = Math.min(rawTarget, maxScroll);
      debugLog(`highlight-scroll: screenRow=${screenRow} vpTop=${vpTop} vp=${vp} rawTarget=${rawTarget} maxScroll=${maxScroll} target=${target} scrollH=${s.getScrollHeight()}`);
      s.scrollTo(target);
      lo = top - target;
      screenRow = vpTop + lo + p.row;
    }
    const el = js.getItemElement(ep.msgIdx);
    const colOffset = getScreenLeft(el);
    const pp = ep.positions[idx]!;
    debugLog(`highlight-set-pos: rowOffset=${vpTop + lo} colOffset=${colOffset} currentIdx=${idx} p.row=${pp.row} p.col=${pp.col} p.len=${pp.len} screenRow=${screenRow} top=${top} scrollTop=${s.getScrollTop()} lo=${lo}`);
    setPositions?.({ positions: ep.positions, rowOffset: vpTop + lo, currentIdx: idx, colOffset });
    debugLog(`highlight-badge: ${current}/${total}`);
  }
  highlightRef.current = highlight;

  // step — CC-aligned plain function. Within-message first, then between-message.
  function step(delta: 1 | -1): void {
    debugLog(`step: delta=${delta} scanReq=${scanRequestRef.current ? 'set' : 'null'} ptr=${searchState.current.ptr} screenOrd=${searchState.current.screenOrd} matches=[${searchState.current.matches.join(',')}]`);
    if (scanRequestRef.current) { pendingStepRef.current = delta; return; }
    const st = searchState.current;
    const { matches, ptr, screenOrd, prefixSum } = st;
    const total = prefixSum.at(-1) ?? 0;
    if (matches.length === 0) return;

    if (startPtrRef.current < 0) startPtrRef.current = ptr;

    // Try within-message first
    const positionsLen = elementPositions.current.msgIdx === matches[ptr] ? elementPositions.current.positions.length : 0;
    const newOrd = screenOrd + delta;
    if (newOrd >= 0 && newOrd < positionsLen) {
      st.screenOrd = newOrd;
      debugLog(`step: within-msg screenOrd=${screenOrd}→${newOrd} positionsLen=${positionsLen}`);
      highlight(newOrd);
      startPtrRef.current = -1;
      return;
    }

    // Exhausted — advance ptr → jump → re-scan
    setPositions?.(null);
    elementPositions.current = { msgIdx: -1, positions: [] };
    const nextPtr = (ptr + delta + matches.length) % matches.length;
    if (nextPtr === startPtrRef.current) {
      setPositions?.(null);
      startPtrRef.current = -1;
      debugLog(`step: wraparound ptr=${ptr} nextPtr=${nextPtr}`);
      return;
    }
    st.ptr = nextPtr;
    st.screenOrd = 0;
    debugLog(`step: jump nextPtr=${nextPtr} msgIdx=${matches[nextPtr]}`);
    jumpToMsgRef.current(matches[nextPtr]!, delta < 0);
    // Pre-scan badge placeholder
    const placeholder = delta < 0 ? prefixSum[nextPtr + 1] ?? total : prefixSum[nextPtr]! + 1;
    onSearchMatchesChangeRef.current?.(total, placeholder);
  }
  stepRef.current = step;

  const jumpToMsgRef = useRef<(idx: number, wantLast?: boolean) => void>(() => {});

  // jump — CC-aligned plain function. Clears old highlight, arms
  // scanRequestRef, scrolls, bumps seekGen. Seek effect does the rest.
  function jumpToMsg(idx: number, wantLast = false): void {
    const s = scrollRef.current;
    if (!s) return;
    const js = jumpState.current;
    if (idx < 0 || idx >= js.messages.length) return;
    debugLog(`jump-to-msg: idx=${idx} wantLast=${wantLast} scrollTop=${s.getScrollTop()}`);
    setPositions?.(null);
    elementPositions.current = { msgIdx: -1, positions: [] };
    scanRequestRef.current = { idx, wantLast, tries: 0 };

    const { getItemElement, getItemTop, scrollToIndex: sTI } = js;
    const el = getItemElement(idx);
    const h = el?.yogaNode?.getComputedHeight() ?? 0;
    debugLog(`jump-to-msg: el=${el ? 'found' : 'NULL'} h=${h} itemTop=${getItemTop(idx)}`);
    if (el && h > 0) {
      s.scrollTo(Math.max(0, getItemTop(idx) - HEADROOM));
    } else {
      sTI(idx);
    }
    bumpSeek();
  }
  jumpToMsgRef.current = jumpToMsg;

  // Scroll-subscribe: update rowOffset every frame to track scroll drain.
  // When highlight calls scrollTo(), the first frame may use a partially-
  // drained scrollTop (not the target). This effect corrects rowOffset
  // each frame so the yellow highlight stays glued to the text.
  React.useEffect(() => {
    const s = scrollRef.current;
    if (!s) return;
    const update = () => {
      const ep = elementPositions.current;
      // Don't call setPositions(null) here — that would clear the highlight
      // during a jump before the new positions are scanned. Just skip.
      if (!ep.positions.length || ep.msgIdx < 0) return;
      const js = jumpState.current;
      const top = js.getItemTop(ep.msgIdx);
      if (top < 0) return;
      const ord = Math.max(0, Math.min(searchState.current.screenOrd, ep.positions.length - 1));
      const el = js.getItemElement(ep.msgIdx);
      const colOffset = getScreenLeft(el);
      const realRowOffset = s.getViewportTop() + top - s.getScrollTop();
      debugLog(`scroll-sub: rowOffset=${realRowOffset} colOffset=${colOffset} currentIdx=${ord} top=${top} scrollTop=${s.getScrollTop()} vpTop=${s.getViewportTop()}`);
      setPositions?.({ positions: ep.positions, rowOffset: realRowOffset, currentIdx: ord, colOffset });
    };
    // Fire once on setup to sync with current scroll position
    update();
    return s.subscribe(update);
  }, [seekGen, setPositions, scrollRef, getScreenLeft]);

  const jumpHandleRef = useRef<JumpHandle>({
    jumpToIndex(i: number) {
      try { jumpToMsgRef.current(i); } catch (e) { debugLog(`jumpToIndex error: ${e}`); }
    },
    setSearchQuery(q: string) {
      try {
        debugLog(`setSearchQuery: q="${q}"`);
        scanRequestRef.current = null;
        elementPositions.current = { msgIdx: -1, positions: [] };
        startPtrRef.current = -1;
        setPositions?.(null);
        const lq = q.toLowerCase();
        const msgs = jumpState.current.messages;
        debugLog(`setSearchQuery: total msgs=${msgs.length}`);
        const matches: number[] = [];
        const prefixSum: number[] = [0];
        if (lq) {
          for (let i = 0; i < msgs.length; i++) {
            const text = extractFn(msgs[i]!);
            if (!text) continue;
            let pos = text.indexOf(lq);
            let cnt = 0;
            while (pos >= 0) { cnt++; pos = text.indexOf(lq, pos + lq.length); }
            if (cnt > 0) {
              matches.push(i);
              prefixSum.push(prefixSum.at(-1)! + cnt);
            }
          }
        }
        debugLog(`setSearchQuery: matched ${matches.length} msgs total ${prefixSum.at(-1)!} occs: msgs=[${matches.join(',')}]`);
        // 找最近的匹配消息
        let ptr = 0;
        const s = scrollRef.current;
        if (matches.length > 0 && s) {
          const js = jumpState.current;
          const { offsets } = js;
          const start = js.getItemTop(0) >= 0 ? 0 : -1;
          const origin = start >= 0 ? js.getItemTop(start)! - offsets[start]! : 0;
          const curTop = anchorRef.current >= 0 ? anchorRef.current : s.getScrollTop();
          let best = Infinity;
          for (let k = 0; k < matches.length; k++) {
            const d = Math.abs(origin + offsets[matches[k]!]! - curTop);
            if (d <= best) { best = d; ptr = k; }
          }
        }
        searchState.current = { matches, ptr, screenOrd: 0, prefixSum };
        const total = prefixSum.at(-1)!;
        if (matches.length > 0) {
          jumpToMsgRef.current(matches[ptr]!, true);
        }
        onSearchMatchesChangeRef.current?.(total, matches.length > 0 ? prefixSum[ptr + 1] ?? total : 0);
      } catch (e) {
        debugLog(`setSearchQuery error: ${e}`);
      }
    },
    nextMatch() { try { debugLog(`nextMatch called`); stepRef.current(1); } catch (e) { debugLog(`nextMatch error: ${e}`); } },
    prevMatch() { try { debugLog(`prevMatch called`); stepRef.current(-1); } catch (e) { debugLog(`prevMatch error: ${e}`); } },
    setAnchor() { anchorRef.current = scrollRef.current?.getScrollTop() ?? 0; },
    async warmSearchIndex() { return 0; },
    disarmSearch() {
      elementPositions.current = { msgIdx: -1, positions: [] };
      setPositions?.(null);
    },
  });
  useImperativeHandle(jumpRef, () => jumpHandleRef.current, []);

  // ── Sticky prompt header ──
  const { setStickyPrompt } = trackStickyPrompt
    ? React.useContext(ScrollChromeContext)
    : { setStickyPrompt: (_p: StickyPrompt | null) => {} };

  const stickyScrollTop = scrollRef.current?.getScrollTop() ?? -1;
  const stickyIsSticky = scrollRef.current?.isSticky() ?? true;

  React.useEffect(() => {
    if (!trackStickyPrompt) return;
    if (messages.length === 0) { setStickyPrompt(null); return; }

    // Walk the mounted range to find the first visible item
    let firstVisible = start;
    for (let i = start; i < end; i++) {
      const top = getItemTop(i);
      if (top >= 0 && top >= stickyScrollTop) {
        firstVisible = i;
        break;
      }
    }

    let idx = -1;
    let text: string | null = null;
    if (firstVisible > 0 && !stickyIsSticky) {
      for (let i = firstVisible - 1; i >= 0; i--) {
        const t = stickyPromptText(messages[i]!);
        if (t === null) continue;
        const top = getItemTop(i);
        if (top >= 0 && top + 1 >= stickyScrollTop) continue;
        idx = i;
        text = t;
        break;
      }
    }

    if (text === null) {
      setStickyPrompt(null);
      return;
    }
    const collapsed = collapseText(text);
    if (collapsed === '') {
      setStickyPrompt(null);
      return;
    }

    const capturedIdx = idx;
    const estimate = Math.max(0, offsets[firstVisible]! - offsets[capturedIdx]!);

    setStickyPrompt({
      text: collapsed,
      scrollTo: () => {
        const el = getItemElement(capturedIdx);
        if (el) {
          scrollRef.current?.scrollToElement(el, 1);
        } else {
          scrollRef.current?.scrollTo(estimate);
        }
      },
    });
  }, [trackStickyPrompt, messages, start, end, stickyScrollTop, stickyIsSticky, setStickyPrompt, offsets, getItemTop, getItemElement, scrollRef]);

  // ── Render ──
  const renderedItems: React.ReactNode[] = [];
  for (let i = start; i < end; i++) {
    const msg = messages[i]!;
    const key = keys[i]!;
    renderedItems.push(
      React.createElement(VirtualItem, {
        key,
        itemKey: key,
        msg,
        idx: i,
        measureRef,
        expanded: selectedIdx === i,
        hovered: hoveredKey === key,
        clickable: isItemClickable(msg),
        onClickK: (m, _cellBlank) => onItemClick?.(m),
        onEnterK: setHoveredKey,
        onLeaveK: () => setHoveredKey(null),
        renderItem,
      }),
    );
  }

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Box, { ref: spacerRef, height: topSpacer }),
    ...renderedItems,
    React.createElement(Box, { height: bottomSpacer }),
  );
}