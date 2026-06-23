import { useEffect, useState } from 'react';

export function useTerminalSize(): { columns: number; rows: number } {
  const [size, setSize] = useState({ columns: 80, rows: 24 });
  useEffect(() => {
    const onResize = () => setSize({ columns: process.stdout.columns || 80, rows: process.stdout.rows || 24 });
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);
  return size;
}

export function useSearchInput(_items: any[], _options?: any): { query: string; results: any[]; selectedIndex: number } {
  return { query: '', results: [], selectedIndex: 0 };
}

export type ExitState = {
  keyName: string;
  pending: boolean;
};

export function useExitOnCtrlCDWithKeybindings(): { exitState: ExitState | null } {
  return { exitState: null };
}

export function useIsInsideModal(): boolean {
  return false;
}

import { useRef } from 'react';
export function useModalScrollRef(): React.RefObject<HTMLDivElement | null> {
  return useRef<HTMLDivElement | null>(null);
}
