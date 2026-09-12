// Generated from src/core/session-source.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor, HarnessId, NativeSessionId } from './contracts';
import type { SessionSource, SessionSourceResolver } from './session-source-contracts';
interface ResolverOptions {
    readonly descriptors?: readonly HarnessDescriptor[];
    readonly roots?: Partial<Record<HarnessId, string>>;
}
/** Construct a read descriptor from an explicit observed identity, including a
 * claimed file which has not been created yet. This grants no lifecycle rights. */
declare function sourceForIdentity(harnessId: HarnessId, nativeSessionId: NativeSessionId, file: string): SessionSource;
/** Own historical route aliases and header-cache invalidation. Live inputs are
 * captured by the caller on each read; neither files nor sources prove ownership. */
declare function createSessionSourceResolver(options?: ResolverOptions): SessionSourceResolver;
declare const _default: {
    createSessionSourceResolver: typeof createSessionSourceResolver;
    sourceForIdentity: typeof sourceForIdentity;
};
export = _default;
