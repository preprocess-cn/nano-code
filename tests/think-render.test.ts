import { describe, it } from 'node:test';
import assert from 'node:assert';
import { configureMarked, formatToken } from '../src/plugins/display/claude-code-ink/utils/markdown.js';
import { marked } from 'marked';

describe('markdown rendering for think text', () => {
  it('renders single-paragraph think text', () => {
    configureMarked();
    const text = "Line 1\nLine 2\nLine 3";
    const tokens = marked.lexer(text);
    const result = tokens.map(t => formatToken(t, 'dark', 0, null, null)).join('').trim();
    assert.ok(result.includes('Line 1'), 'should have Line 1');
    assert.ok(result.includes('Line 2'), 'should have Line 2');
    assert.ok(result.includes('Line 3'), 'should have Line 3');
  });

  it('renders multi-paragraph think text', () => {
    configureMarked();
    const text = "分析这个问题：\n\n第一步，查看代码结构\n\n第二步，理解数据流";
    const tokens = marked.lexer(text);
    const result = tokens.map(t => formatToken(t, 'dark', 0, null, null)).join('').trim();
    assert.ok(result.includes('分析这个问题'));
    assert.ok(result.includes('第一步'));
    assert.ok(result.includes('第二步'));
  });

  it('preserves all lines in mixed content', () => {
    configureMarked();
    const text = "Let me analyze:\n\nFirst, check the architecture.\n\nSecond, review the data flow:\n- Input comes from config\n- Output goes to display\n- Error handling is missing";
    const tokens = marked.lexer(text);
    const result = tokens.map(t => formatToken(t, 'dark', 0, null, null)).join('').trim();
    const lines = result.split('\n').filter(l => l.trim());
    assert.ok(lines.length >= 6, `Expected >=6 non-empty lines, got ${lines.length}`);
  });

  it('preserves code blocks in think text', () => {
    configureMarked();
    const text = "查看代码：\n```\nfunction foo() {\n  return 42;\n}\n```\n这个函数返回42。";
    const tokens = marked.lexer(text);
    const result = tokens.map(t => formatToken(t, 'dark', 0, null, null)).join('').trim();
    console.log('Code result:', JSON.stringify(result));
    assert.ok(result.includes('function foo()'));
    assert.ok(result.includes('return 42'));
    assert.ok(result.includes('这个函数返回42'));
  });

  it('Ansi multi-span dim render preserves all lines', () => {
    configureMarked();
    // This produces content with ANSI codes (code block)
    const text = "分析代码：\n```\nconst x = 1;\nconst y = 2;\n```\n以上是代码。";
    const tokens = marked.lexer(text);
    const result = tokens.map(t => formatToken(t, 'dark', 0, null, null)).join('').trim();
    // The ANSI string should contain multiple \n
    const newlineCount = (result.match(/\n/g) || []).length;
    assert.ok(newlineCount >= 3, `Expected >=3 newlines in ANSI output, got ${newlineCount}`);
  });

  it('AnsiBox receives correct multi-line input for think text', () => {
    configureMarked();
    // Simulate what happens when think text has paragraphs and code
    // This is the accumulated text that would be passed to AnsiBox
    const fullText = "第一步：分析需求\n\n这个bug出现在数据流处理环节。\n\n第二步：查看现有代码\n```\nfunction process(input) {\n  return input.map(x => x * 2);\n}\n```\n\n第三步：确定修复方案";
    const tokens = marked.lexer(fullText);
    const result = tokens.map(t => formatToken(t, 'dark', 0, null, null)).join('').trim();

    // Verify ALL content is preserved in the ANSI output
    assert.ok(result.includes('第一步'), 'Should include first section');
    assert.ok(result.includes('第二步'), 'Should include second section');
    assert.ok(result.includes('第三步'), 'Should include third section');
    assert.ok(result.includes('function process'), 'Should include code');
    assert.ok(result.includes('return input.map'), 'Should include code line 2');

    // AnsiBox receives this string as children. If it only shows first line,
    // the issue is in the Ansi component, not the markdown formatting.
    const lines = result.split('\n').filter(l => l.trim().length > 0);
    console.log('Total non-empty lines in ANSI output:', lines.length);
    console.log('First line:', JSON.stringify(lines[0]));
    console.log('Last line:', JSON.stringify(lines[lines.length - 1]));
    assert.ok(lines.length >= 7, 'Should have at least 7 non-empty lines of content');
  });
});
