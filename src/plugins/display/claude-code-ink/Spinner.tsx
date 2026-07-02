import React from 'react';
import { Text } from '#src/plugins/display/claude-code-ink/ink.js';

export function Spinner(): React.ReactElement {
  return React.createElement(Text, null, '...');
}
