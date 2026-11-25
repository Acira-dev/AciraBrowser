export declare const H264_CODECS: readonly string[];
export declare function clipSize(width: number): { width: number; height: number };
export interface H264Config { codec: string; width: number; height: number; framerate: number; bitrate: number; latencyMode: string; avc: { format: string } }
export declare function pickH264(width?: number, fps?: number, api?: unknown): Promise<H264Config | null>;
export declare function videoFormat(width?: number, fps?: number, api?: unknown): Promise<'mp4' | 'webm'>;
export declare function canRecordMp4(width?: number, fps?: number, api?: unknown): Promise<boolean>;
export declare function muxMp4(input: { width: number; height: number; fps?: number; samples: { data: Uint8Array; key: boolean }[]; avcC: Uint8Array }): Uint8Array;
export declare function encodeMp4(input: { canvas: unknown; frames: number; fps?: number; config: H264Config; drawFrame: (index: number) => void; onProgress?: (fraction: number) => void; api?: unknown }): Promise<Uint8Array>;
