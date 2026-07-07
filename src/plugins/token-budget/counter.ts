/**
 * re-export from core 以避免破坏现有 import 路径。
 * 新代码请直接 import from '#src/core/token-counter.js'。
 */
export { initTokenizer, countTokens, countMessagesTokens } from '#src/core/token-counter.js';
