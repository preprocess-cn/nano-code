import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from './ink.js';
import * as fs from 'fs';
import * as path from 'path';
import type { PluginRegistry } from '../../../core/plugin.js';
import { loadConfig, getSystemWhitelist } from '../../../core/config.js';

// ── Types ──

interface PluginItem {
  name: string;
  enabled: boolean;
  tag: string;
}

interface PluginManagerProps {
  registry: PluginRegistry;
  onDone: () => void;
}

// ── Helpers ──

function loadPluginList(registry: PluginRegistry): PluginItem[] {
  const config = loadConfig();
  const whitelist = getSystemWhitelist(config);
  const runtime = registry.listPlugins();
  const items: PluginItem[] = [];

  for (const p of runtime) {
    const cfg = config.plugins?.[p.name];
    const enabled = cfg ? cfg.enabled !== false : true;
    const tag = whitelist.has(p.name) ? 'system' : (p.name.startsWith('mcp:') ? 'mcp' : 'builtin');
    items.push({ name: p.name, enabled, tag });
  }

  // 按 tag 排序
  const prio: Record<string, number> = { system: 0, builtin: 1, mcp: 2 };
  items.sort((a, b) => (prio[a.tag] ?? 9) - (prio[b.tag] ?? 9) || a.name.localeCompare(b.name));
  return items;
}

const TAG_COLOR: Record<string, string> = {
  system: '#6b7280',
  builtin: '#3b82f6',
  mcp: '#8b5cf6',
};

// ── Component ──

export function PluginManager({ registry, onDone }: PluginManagerProps) {
  const [plugins, setPlugins] = useState<PluginItem[]>(() => loadPluginList(registry));
  const [selected, setSelected] = useState(0);
  const [search, setSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 过滤后的列表
  const filtered = useMemo(() => {
    if (!search) return plugins;
    const q = search.toLowerCase();
    return plugins.filter(p => p.name.toLowerCase().includes(q));
  }, [plugins, search]);

  // 确保 selected 在范围内
  const safeSelected = Math.min(selected, Math.max(0, filtered.length - 1));

  function togglePlugin(item: PluginItem): void {
    const configPath = path.join(process.cwd(), '.nano-code.yaml');
    let cfg: Record<string, any> = {};
    try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { /* ignore */ }
    if (!cfg.plugins) cfg.plugins = {};
    if (!cfg.plugins[item.name]) cfg.plugins[item.name] = {};
    cfg.plugins[item.name].enabled = !item.enabled;
    try {
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
    } catch (err: any) {
      setMessage(`写入失败: ${err.message}`);
      return;
    }
    setMessage(`插件 "${item.name}" 已${!item.enabled ? '启用' : '禁用'}。重启后生效`);
    // 更新本地状态
    setPlugins(prev => prev.map(p => p.name === item.name ? { ...p, enabled: !p.enabled } : p));
  }

  function handleConfirm(item: PluginItem): void {
    if (item.tag === 'system') {
      setMessage(`"${item.name}" 是系统插件，请在 .nano-code.yaml 中配置`);
      return;
    }
    setConfirmName(item.name);
  }

  function handleConfirmYes(): void {
    const item = plugins.find(p => p.name === confirmName);
    if (item) togglePlugin(item);
    setConfirmName(null);
  }

  function handleConfirmNo(): void {
    setConfirmName(null);
  }

  // 清空消息
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  useInput((input, key) => {
    if (confirmName) {
      // 确认模式
      if (key.return || input === 'y' || input === 'Y') {
        handleConfirmYes();
      } else if (key.escape || input === 'n' || input === 'N') {
        handleConfirmNo();
      }
      return;
    }

    if (isSearching) {
      // 搜索模式
      if (key.escape) {
        setIsSearching(false);
        setSearch('');
      } else if (key.return) {
        setIsSearching(false);
      } else if (key.backspace || key.delete) {
        setSearch(s => s.slice(0, -1));
      } else if (input.length === 1 && !key.ctrl && !key.meta) {
        setSearch(s => s + input);
      }
      return;
    }

    // 正常导航
    if (key.escape || input === 'q') {
      onDone();
      return;
    }

    if (key.upArrow) {
      setSelected(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelected(i => Math.min(filtered.length - 1, i + 1));
    } else if (key.return || input === ' ') {
      const item = filtered[safeSelected];
      if (item) handleConfirm(item);
    } else if (input === '/') {
      setIsSearching(true);
      setSearch('');
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      {/* 标题栏 */}
      <Box>
        <Text bold>  插件管理器</Text>
        <Text dimColor>  — {plugins.length} 个插件已注册</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>  {isSearching ? '搜索: ' + search + '█' : `导航: ↑↓ 选择 | Enter 切换 | / 搜索 | Esc/q 退出`}</Text>
      </Box>

      {/* 消息 */}
      {message && (
        <Box marginTop={1}>
          <Text color="#f59e0b">  {message}</Text>
        </Box>
      )}

      {/* 确认对话框 */}
      {confirmName && (
        <Box marginTop={1} paddingLeft={1} borderStyle="round" borderColor="#f59e0b">
          <Text>确认{plugins.find(p => p.name === confirmName)?.enabled ? '禁用' : '启用'} 「{confirmName}」？</Text>
          <Text>  </Text>
          <Text color="#34d399">Y</Text>
          <Text dimColor>es / </Text>
          <Text color="#ef4444">N</Text>
          <Text dimColor>o</Text>
        </Box>
      )}

      {/* 插件列表 */}
      <Box flexDirection="column" marginTop={1}>
        {filtered.length === 0 && (
          <Box paddingLeft={2}>
            <Text dimColor>无匹配插件</Text>
          </Box>
        )}
        {filtered.map((item, idx) => (
          <Box key={item.name} height={1}>
            <Text>{idx === safeSelected ? '  ▸' : '   '}</Text>
            <Text bold={idx === safeSelected} color={idx === safeSelected ? '#60a5fa' : undefined}>
              {item.name.padEnd(28)}
            </Text>
            <Text color={item.enabled ? '#34d399' : '#6b7280'}>
              {item.enabled ? 'active'.padEnd(10) : 'inactive'.padEnd(10)}
            </Text>
            <Text color={TAG_COLOR[item.tag] ?? '#6b7280'}>
              [{item.tag}]
            </Text>
          </Box>
        ))}
      </Box>

      {/* 底部提示 */}
      <Box marginTop={1}>
        <Text dimColor>  提示: 更改需要重启 nano-code 或运行 /reload-plugins 后生效</Text>
      </Box>
    </Box>
  );
}
