import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

/**
 * Lorem Ipsum 技能 — 生成指定 token 数的填充文本。
 *
 * 对齐 Claude Code 的 loremIpsum.ts，是唯一不返回 prompt 指令、
 * 而直接返回生成文本的技能。disableModelInvocation=true。
 */

// 经 token 计数验证的单个 token 英文单词列表
const ONE_TOKEN_WORDS = [
  'the','be','to','of','and','a','in','that','have','it',
  'for','not','on','with','he','as','you','do','at','this',
  'but','his','by','from','they','we','say','her','she','or',
  'an','will','my','one','all','would','there','their','what',
  'so','up','out','if','about','who','get','which','go','me',
  'when','make','can','like','time','no','just','him','know',
  'take','people','into','year','your','good','some','could',
  'them','see','other','than','then','now','look','only','come',
  'its','over','think','also','back','after','use','two','how',
  'our','work','first','well','way','even','new','want','because',
  'any','these','give','day','most','us','great','between','need',
  'long','off','much','right','ask','still','mean','last','let',
  'keep','put','hand','high','place','same','small','own','show',
  'here','why','live','under','next','three','word','say','find',
  'here','thing','should','world','head','every','house','point',
  'old','should','large','both','another','set','life','end','open',
  'turn','must','such','move','try','kind','hand','picture','again',
  'change','off','play','spell','air','away','animal','house','point',
  'page','letter','mother','answer','found','study','still','learn',
  'should','world','head','every','house','point','page',
];

export function createLoremIpsumSkill(): BundledSkillDef {
  return {
    name: 'lorem-ipsum',
    description: '生成指定 token 数的填充文本（测试用）',
    disableModelInvocation: true,
    argumentHint: '[token_count]',
    getPrompt: async (args) => {
      // 空参数时默认 10000 tokens
      if (!args || !args.trim()) {
        args = '10000';
      }

      const targetTokens = parseInt(args, 10);

      if (isNaN(targetTokens) || targetTokens <= 0) {
        return '\n\n无效的 token 数。用法: lorem-ipsum(10000) 生成约 10000 tokens 的填充文本。';
      }

      const maxTokens = 500000;
      const cappedTokens = Math.min(targetTokens, maxTokens);

      let result = '';
      if (targetTokens > maxTokens) {
        result = `超过上限 ${maxTokens} tokens，已截断。\n\n`;
      }

      // 生成 lorem ipsum 风格文本
      const sentences: string[] = [];
      let currentTokens = 0;
      while (currentTokens < cappedTokens) {
        const wordsInSentence = 10 + Math.floor(Math.random() * 10);
        const sentenceWords: string[] = [];
        for (let i = 0; i < wordsInSentence; i++) {
          const word = ONE_TOKEN_WORDS[Math.floor(Math.random() * ONE_TOKEN_WORDS.length)];
          sentenceWords.push(i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word);
          currentTokens++;
          if (currentTokens >= cappedTokens) break;
        }
        sentences.push(sentenceWords.join(' ') + '.');
        // 每 5-8 句分段
        if (sentences.length % (5 + Math.floor(Math.random() * 4)) === 0) {
          sentences.push('');
        }
      }

      result += '\n\n' + sentences.join(' ');
      return result;
    },
  };
}
