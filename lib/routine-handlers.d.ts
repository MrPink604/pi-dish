// Generated from src/core/routine-handlers.ts; edit that source and run npm run build:core.
import type { RequestHandler } from 'express';
import type { ParsedQs } from 'qs';
import type { Routine, RoutineInvocation } from './routines';
import type { RoutineRunner } from './routine-runner';
import type { SessionLaunch } from './session-launch';
import { type SessionRefDependencies } from './session-refs';
export type RoutineHandler = RequestHandler<{
    id: string;
}, unknown, unknown, ParsedQs, Record<string, unknown>>;
export interface RoutineHandlerPorts {
    runner: RoutineRunner;
    validateHarnessPilotSelection: SessionLaunch['validateHarnessPilotSelection'];
}
export interface RoutineHandlers {
    list: RoutineHandler;
    create: RoutineHandler;
    get: RoutineHandler;
    update: RoutineHandler;
    remove: RoutineHandler;
    invoke: RoutineHandler;
    listInvocations: RoutineHandler;
    getInvocation: RoutineHandler;
}
/** Append caller input without templating the prompt, then expand composer-style #refs. */
export declare function composeRoutinePrompt(routine: Routine, invocation: RoutineInvocation | null | undefined, refs: SessionRefDependencies): string;
export declare function createRoutineHandlers(ports: RoutineHandlerPorts): RoutineHandlers;
