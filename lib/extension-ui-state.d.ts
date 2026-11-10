// Generated from src/core/extension-ui-state.ts; edit that source and run npm run build:core.
import type { ExtensionUIState } from './contracts';
export declare function createExtensionUIState(): ExtensionUIState;
export declare function removeExtensionUIDialog(state: ExtensionUIState, id: unknown): void;
/** The native ask tool's dialogs: the multi-question `ask` and the HTML `form` (OMP 18.18.3+). */
export declare function isAskDialog(data: unknown): boolean;
/** Any pending native ask dialog blocks the turn on an answer. */
export declare function hasPendingAskDialog(value: unknown): boolean;
/** Reduce admitted transport events before listeners observe the live replay maps. */
export declare function reduceExtensionUIState(state: ExtensionUIState, event: string, data: unknown): void;
