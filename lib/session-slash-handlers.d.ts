// Generated from src/core/session-slash-handlers.ts; edit that source and run npm run build:core.
import { type RouteHandler } from './http-boundary';
import tmux = require('./tmux');
import type { LiveSession } from './session-ownership';
export interface SlashCommandPorts {
    getLiveSession(sessionId: string): Promise<LiveSession | null>;
    locatePiPane(sessionId: string): Promise<tmux.PaneTarget | null>;
}
export declare function createSlashCommandHandler(ports: SlashCommandPorts): {
    command: RouteHandler;
};
