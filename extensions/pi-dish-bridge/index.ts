import { createBridge, PI_EVENT_PROFILE } from "./core.js";
import { getPiPrivateSession } from "./pi-private.js";

export default createBridge({
  harnessId: "pi", name: "Pi", hostVersion: "0.84.x", wrapperVersion: "0.2.0",
  eventProfile: PI_EVENT_PROFILE,
  capabilities: {
    prompt: true, steer: true, followUp: true, abort: true, compact: true,
    models: true, setModel: true, setThinking: true, rename: true,
    commands: true, reload: true, queueRead: true, queueCancel: true,
    treeRead: true, treeNavigation: true, extensionUI: true,
  },
  getPrivateSession: getPiPrivateSession,
  selfPrime: true,
  piLifecycleEvents: true,
  standDownUnderForeignHost: true,
});
