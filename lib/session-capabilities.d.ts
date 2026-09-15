// Generated from src/core/session-capabilities.ts; edit that source and run npm run build:core.
import type { HarnessId, BridgeCapability, AdvertisedCapabilities, SessionCapabilities, CapabilityContext } from './contracts';
/**
 * Legacy Pi permits missing flags; alternative wrappers must explicitly opt in.
 * This is policy only, not harness-id validation. Unknown wrapper observations
 * retain the same explicit-opt-in rule; no synthetic harness identity is needed.
 */
declare function bridgeSupports(harnessId: unknown, capabilities: AdvertisedCapabilities | null | undefined, capability: BridgeCapability): boolean;
/** Project UI/API advice. Lifecycle authority is established separately by callers. */
declare function sessionCapabilities(harnessId: HarnessId, bridgeCapabilities?: AdvertisedCapabilities, { active, conflicted, closeAllowed, restartAllowed, }?: CapabilityContext): SessionCapabilities;
declare const _default: {
    bridgeSupports: typeof bridgeSupports;
    sessionCapabilities: typeof sessionCapabilities;
};
export = _default;
