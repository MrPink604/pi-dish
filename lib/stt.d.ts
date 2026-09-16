// Generated from src/core/stt.ts; edit that source and run npm run build:core.
/** Server-side bring-your-own OpenAI-shaped transcription endpoint. */
export declare const DEFAULT_MODEL = "whisper-1";
export interface SttConfig {
    url: string;
    apiKey: string | null;
    model: string;
    language: string | null;
}
export interface TranscriptionOptions {
    bytes?: BlobPart | NodeJS.ArrayBufferView;
    contentType?: unknown;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}
export interface TranscriptionResult {
    text: string;
}
/** `audio/webm;codecs=opus` -> `audio/webm`. */
export declare function baseMimeType(contentType: unknown): string;
/** Credentials are file/env-only; callers advertise only a configured boolean. */
export declare function resolveSttConfig(settings: unknown, env?: NodeJS.ProcessEnv): SttConfig | null;
export declare function sttFilename(contentType: unknown): string | null;
/** Common upstream envelopes, bounded and scrubbed for browser display. */
export declare function upstreamErrorMessage(_status: number, bodyText: unknown): string;
/** Multipart transport; thrown status/message are safe for the HTTP consumer. */
export declare function transcribe(config: SttConfig, { bytes, contentType, fetchImpl, timeoutMs }?: TranscriptionOptions): Promise<TranscriptionResult>;
