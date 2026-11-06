// Generated from src/core/session-slash-handlers.ts; edit that source and run npm run build:core.
import type { RouteHandler } from './http-boundary';
import type { LiveSession } from './session-ownership';
import type tmuxTypes = require('./tmux');
export interface SlashCommandPorts {
    getLiveSession(sessionId: string): Promise<LiveSession | null>;
    locatePiPane(sessionId: string): Promise<tmuxTypes.PaneTarget | null>;
}
export declare function createSlashCommandHandler(ports: SlashCommandPorts): {
    command: RouteHandler;
};
