// Generated from src/core/session-command-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { ParsedQs } from 'qs';
import type { LiveSession, liveSessionSupports } from './session-ownership';
type CommandHandler = RequestHandler<Record<string, string>, unknown, unknown, ParsedQs, Record<string, unknown>>;
interface SessionCommandPorts {
    getLiveSession(id: string): Promise<LiveSession | null>;
    supports: typeof liveSessionSupports;
    expandRefs(message: unknown, refs: unknown): string;
}
/** HTTP admission only; lifecycle, routine and recovery delivery keep their owners. */
export declare function createSessionCommandHandlers(ports: SessionCommandPorts): {
    prompt: CommandHandler;
    steer: CommandHandler;
    followUp: CommandHandler;
};
export {};
