import { createBridge, PUBLIC_EVENT_PROFILE, type BridgeDescriptor } from "../pi-dish-bridge/core.js";

export const bridgeDescriptor = {
  harnessId: "prime", name: "Prime Agent", hostVersion: "public-api", wrapperVersion: "0.1.0",
  eventProfile: PUBLIC_EVENT_PROFILE,
  capabilities: {
    prompt: true, steer: true, followUp: true, abort: true, compact: false,
    models: true, setModel: true, setThinking: true, rename: true,
    commands: true, reload: false, queueRead: false, queueCancel: false,
    treeRead: false, treeNavigation: false, extensionUI: true,
  },
  // Prime's thinking ladder is pi's plus a top "max" rung; without this the
  // shared core falls back to pi's six levels and rejects "max".
  thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
} satisfies BridgeDescriptor;

export function createHarnessBridge(spawnToken?: string) {
  return createBridge({ ...bridgeDescriptor, spawnToken });
}

export default createHarnessBridge();
