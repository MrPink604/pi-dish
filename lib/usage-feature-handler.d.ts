// Generated from src/core/usage-feature-handler.ts; edit that source and run npm run build:core.
import type { FeatureHandler } from './feature-handlers';
import type { IncomingMessage } from 'http';
/** Private sessions count toward totals; their rows stay hidden unless the request is unlocked. */
export declare function createUsageSummaryHandler(privateUnlocked: (req: IncomingMessage) => boolean): FeatureHandler;
