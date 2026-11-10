import type {Plugin} from 'vite';
export const LATIN1: number;
export function worthEscaping(length: number, wide: number): boolean;
export function oneByteChunk(code: string, options?: {name?: string; limit?: number}): Promise<{code: string; wide: number; changed: boolean; dense: boolean}>;
export function oneByteChunks(): Plugin;
