import React, { useState } from 'react';
import { Box, Text, useInput } from '#src/plugins/display/claude-code-ink/ink.js';
import type { PluginRegistry } from '#src/core/plugin.js';
import type { ModelEntry } from '#src/core/llm.js';
import { SK } from '#src/core/store-keys.js';

interface ModelPickerProps {
  registry: PluginRegistry;
  onDone: () => void;
}

export function ModelPicker({ registry, onDone }: ModelPickerProps) {
  const models = registry.store.get<ModelEntry[]>(SK.ModelRegistryModels) ?? [];
  const current = registry.store.get<ModelEntry>(SK.ModelOverride);
  const [selected, setSelected] = useState(() => {
    if (!current || models.length === 0) return 0;
    const idx = models.findIndex(
      m => m.model === current.model && m.apiKey === current.apiKey,
    );
    return idx >= 0 ? idx : 0;
  });

  useInput((_input, key) => {
    if (key.escape || _input === 'q') {
      onDone();
      return;
    }
    if (key.upArrow) {
      setSelected(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelected(i => Math.min(models.length - 1, i + 1));
    } else if (key.return) {
      const m = models[selected];
      if (m) {
        registry.store.set(SK.ModelOverride, m);
        onDone();
      }
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box>
        <Text bold>  模型选择器</Text>
        <Text dimColor>  — {models.length} 个模型已注册</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>  导航: ↑↓ 选择 | Enter 确定 | Esc/q 取消</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {models.length === 0 && (
          <Box paddingLeft={2}>
            <Text dimColor>无可用模型</Text>
          </Box>
        )}
        {models.map((m, idx) => {
          const isActive = current && m.model === current.model && m.apiKey === current.apiKey;
          const isFocused = idx === selected;
          const label = m.provider ? `${m.provider}/${m.model}` : m.model;
          return (
            <Box key={`${m.model}-${m.apiKey ?? ''}-${idx}`} height={1}>
              <Text>{isFocused ? '  ▸' : '   '}</Text>
              <Text bold={isFocused} color={isFocused ? '#60a5fa' : undefined}>
                {label.padEnd(36)}
              </Text>
              {isActive && !isFocused && (
                <Text color="#34d399">← 当前</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>  提示: 切换后对后续对话生效</Text>
      </Box>
    </Box>
  );
}
