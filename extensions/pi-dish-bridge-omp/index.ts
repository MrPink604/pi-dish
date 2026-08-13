import { createBridge, PUBLIC_EVENT_PROFILE, type BridgeDescriptor } from "../pi-dish-bridge/core.js";

export const bridgeDescriptor = {
  harnessId: "omp", name: "Oh My Pi", hostVersion: "public-api", wrapperVersion: "0.1.0",
  eventProfile: PUBLIC_EVENT_PROFILE,
  capabilities: {
    prompt: true, steer: true, followUp: true, abort: true, compact: true,
    models: true, setModel: true, setThinking: true, rename: true,
    commands: true, reload: false, queueRead: false, queueCancel: false,
    treeRead: false, treeNavigation: false, extensionUI: true,
  },
  publicCompactionEvents: true,
  compactArgument: (instructions: string) => instructions,
} satisfies BridgeDescriptor;

export function createHarnessBridge(spawnToken?: string) {
  return createBridge({ ...bridgeDescriptor, spawnToken });
}

export default createHarnessBridge();
