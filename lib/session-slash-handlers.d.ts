// Generated from src/core/session-slash-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { LiveSession } from './session-ownership';
import type tmuxTypes = require('./tmux');
export interface SlashCommandPorts {
    getLiveSession(sessionId: string): Promise<LiveSession | null>;
    locatePiPane(sessionId: string): Promise<tmuxTypes.PaneTarget | null>;
}
type CommandHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export declare function createSlashCommandHandler(ports: SlashCommandPorts): {
    command: CommandHandler;
};
export {};
