// Stub declarations for CC internal modules referenced by the Ink engine

declare module '../../bootstrap/state.js' {
  export function updateLastInteractionTime(): void;
  export function flushInteractionTime(): void;
}

declare module '../../utils/debug.js' {
  export function logForDebugging(msg: string, level?: string): void;
}

declare module '../../utils/earlyInput.js' {
  export function stopCapturingEarlyInput(): void;
}

declare module '../../utils/envUtils.js' {
  export function isEnvTruthy(v: any): boolean;
}

declare module '../../utils/fullscreen.js' {
  export function isMouseClicksDisabled(): boolean;
}

declare module '../../utils/log.js' {
  export function logError(...args: any[]): void;
}

declare module '../../utils/theme.js' {
  export type ThemeName = string;
  export type ThemeSetting = string;
  export interface Theme { [key: string]: string }
  export function getTheme(name?: ThemeName): Theme;
}

declare module 'bidi-js' {
  const bidi: any;
  export default bidi;
}

declare module 'react-reconciler' {
  interface Reconciler {
    createContainer(...args: any[]): any;
    updateContainer(...args: any[]): any;
    [key: string]: any;
  }
  function createReconciler(config: any, hostConfig?: any): Reconciler;
  export default createReconciler;
}

declare module 'react-reconciler/constants.js' {
  export const SyncLane: number;
  export const NoLane: number;
  export const NoLanes: number;
  export const NoTimestamp: number;
}

declare module '../../utils/log.js' {
  export function logError(...args: any[]): void;
}
