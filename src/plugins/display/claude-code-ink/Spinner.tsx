import React from 'react';
import { Text } from './ink.js';

export function Spinner(): React.ReactElement {
  return React.createElement(Text, null, '...');
}
