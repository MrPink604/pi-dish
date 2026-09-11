import { createBridge, PUBLIC_EVENT_PROFILE, type BridgeDescriptor } from "../pi-dish-bridge/core.js";
import { getOmpNativeCaptureStats, getOmpNativeProjection, getOmpNativeSession, patchOmpAgentSession, subscribeOmpNativeProjection } from "./native-state.js";

// OMP's own /btw prompt ($bunfs/root/btw-user-*.md, verified 18.1.16). The
// embedded asset is unreadable from an extension, so the text is mirrored
// here; the side question stays useful even if upstream rewords it.
const BTW_PROMPT = `Ephemeral side question for current interactive session.
Answer briefly, directly; use conversation context already provided.
NEVER use tools.
NEVER ask follow-up questions.
Question:
{{question}}`;

async function runOmpBtw(question: string): Promise<string> {
  const session = getOmpNativeSession();
  if (!session) {
    const stats = getOmpNativeCaptureStats();
    throw new Error(`/btw has no captured OMP session yet (patch applied: ${stats.patches > 0}, accessor calls seen: ${stats.publishes}).`);
  }
  const run = session.runEphemeralTurn;
  if (typeof run !== "function") {
    throw new Error("/btw needs OMP ≥ 18.1 (AgentSession.runEphemeralTurn); this host's session lacks it.");
  }
  const result: unknown = await Reflect.apply(run, session, [{
    promptText: BTW_PROMPT.replace("{{question}}", question),
  }]);
  const replyText = result && typeof result === "object" && "replyText" in result ? result.replyText : undefined;
  return String(replyText ?? "").trim();
}

export const bridgeDescriptor = {
  harnessId: "omp", name: "Oh My Pi", hostVersion: "public-api", wrapperVersion: "0.1.0",
  eventProfile: PUBLIC_EVENT_PROFILE,
  capabilities: {
    prompt: true, steer: true, followUp: true, abort: true, compact: true,
    models: true, setModel: true, setThinking: true, rename: true,
    commands: true, reload: false, queueRead: false, queueCancel: false,
    treeRead: true, treeNavigation: true, extensionUI: true, shareSnapshot: true,
    btw: true,
  },
  // OMP's --thinking vocabulary (omp --help). Models support a subset — OMP
  // clamps — but the bridge must accept every value the harness does.
  thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"],
  sessionSwitchEvents: true,
  nestedSubsessions: true,
  publicCompactionEvents: true,
  compactArgument: (instructions: string) => instructions,
  treeCommandContext: true,
  runBtw: runOmpBtw,
  nativeProjection: {
    get: getOmpNativeProjection,
    subscribe: subscribeOmpNativeProjection,
  },
} satisfies BridgeDescriptor;

// hostAgentSession is the host's AgentSession class, imported by the
// generated launch wrapper itself (OMP's bare-specifier rewrite only covers
// the entry file's directory tree, which the repo's native-state module is
// outside when the entry lives in launch-wrappers/). Discovery loads get the
// same patch from native-state's own top-level import.
export function createHarnessBridge(spawnToken?: string, hostAgentSession?: unknown) {
  if (hostAgentSession) patchOmpAgentSession(hostAgentSession);
  return createBridge({ ...bridgeDescriptor, spawnToken });
}

export default createHarnessBridge();
