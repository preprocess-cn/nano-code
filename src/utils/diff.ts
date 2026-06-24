import { structuredPatch } from 'diff';
import type { DiffHunk, DiffLine } from '../contract.js';

const AMPERSAND_TOKEN = '<<:AMPERSAND_TOKEN:>>';
const DOLLAR_TOKEN = '<<:DOLLAR_TOKEN:>>';

function escapeForDiff(s: string): string {
  return s.replaceAll('&', AMPERSAND_TOKEN).replaceAll('$', DOLLAR_TOKEN);
}

function unescapeFromDiff(s: string): string {
  return s.replaceAll(AMPERSAND_TOKEN, '&').replaceAll(DOLLAR_TOKEN, '$');
}

function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

export function getPatchForDisplay({
  filePath,
  oldContent,
  newContent,
}: {
  filePath: string;
  oldContent: string;
  newContent: string;
}): DiffHunk[] {
  const preparedOld = escapeForDiff(normalizeLineEndings(oldContent));
  const preparedNew = escapeForDiff(normalizeLineEndings(newContent));

  const result = structuredPatch(
    filePath,
    filePath,
    preparedOld,
    preparedNew,
    undefined,
    undefined,
    { context: 3 },
  );

  return result.hunks.map((hunk): DiffHunk => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines.map((line): DiffLine => {
      const prefix = line[0];
      const type = prefix === '+' ? 'add' : prefix === '-' ? 'remove' : 'context';
      return {
        type,
        content: unescapeFromDiff(line.slice(1)),
      };
    }),
  }));
}

export function newFileHunk(filePath: string, content: string): DiffHunk[] {
  const lines = normalizeLineEndings(content).split('\n');
  return [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: lines.length,
      lines: lines.map((line): DiffLine => ({
        type: 'add',
        content: line,
      })),
    },
  ];
}
