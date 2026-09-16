// Generated from src/core/harness-feature-settings.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
type Handler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
export declare const harnesses: Handler;
export declare const harnessConfig: Handler;
export declare const updateModelRoles: Handler;
export declare const harnessAgents: Handler;
export declare const updateHarnessAgents: Handler;
export {};
