import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBridge, PI_EVENT_PROFILE } from "./core.js";
import { piPrivate } from "./pi-private.js";
import { piLogin } from "./pi-login.js";

export default createBridge({
  harnessId: "pi", name: "Pi", hostVersion: "1.3.x", wrapperVersion: "0.2.0",
  eventProfile: PI_EVENT_PROFILE,
  capabilities: {
    prompt: true, steer: true, followUp: true, abort: true, compact: true,
    models: true, setModel: true, setThinking: true, rename: true,
    commands: true, reload: true, queueRead: true, queueCancel: true,
    treeRead: true, treeNavigation: true, extensionUI: true, login: true,
  },
  piPrivate,
  login: piLogin,
  selfPrime: true,
  piLifecycleEvents: true,
  standDownUnderForeignHost: true,
}) satisfies (pi: ExtensionAPI) => void;
