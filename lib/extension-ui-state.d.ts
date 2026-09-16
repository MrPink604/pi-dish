// Generated from src/core/extension-ui-state.ts; edit that source and run npm run build:core.
import type { ExtensionUIState } from './contracts';
export declare function createExtensionUIState(): ExtensionUIState;
export declare function removeExtensionUIDialog(state: ExtensionUIState, id: unknown): void;
/** Reduce admitted transport events before listeners observe the live replay maps. */
export declare function reduceExtensionUIState(state: ExtensionUIState, event: string, data: unknown): void;
