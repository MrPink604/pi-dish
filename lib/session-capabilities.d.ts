// Generated from src/core/session-capabilities.ts; edit that source and run npm run build:core.
import type { HarnessId, BridgeCapability, AdvertisedCapabilities, SessionCapabilities, CapabilityContext } from './contracts';
/**
 * Legacy Pi permits missing flags; alternative wrappers must explicitly opt in.
 * This is policy only, not harness-id validation. Typed callers must establish
 * identity through getHarness/the registry boundary before passing its id.
 */
declare function bridgeSupports(harnessId: HarnessId, capabilities: AdvertisedCapabilities | null | undefined, capability: BridgeCapability): boolean;
/** Project UI/API advice. Lifecycle authority is established separately by callers. */
declare function sessionCapabilities(harnessId: HarnessId, bridgeCapabilities?: AdvertisedCapabilities, { active, conflicted, closeAllowed, restartAllowed, }?: CapabilityContext): SessionCapabilities;
declare const _default: {
    bridgeSupports: typeof bridgeSupports;
    sessionCapabilities: typeof sessionCapabilities;
};
export = _default;
