import { createBridge, PUBLIC_EVENT_PROFILE, type BridgeDescriptor, type SideTurnInput } from "../pi-dish-bridge/core.js";
import { getOmpNativeProjection, subscribeOmpNativeProjection, ompFastModeState, setOmpFastMode, getOmpNativeCaptureStats, getOmpNativeSession, patchOmpAgentSession } from "./native-state.js";
import { ompLogin, useOmpAuthModule } from "./login.js";

// OMP's own /btw prompt ($bunfs/root/btw-user-*.md, verified 18.1.16). The
// embedded asset is unreadable from an extension, so the text is mirrored
// here; the side question stays useful even if upstream rewords it.
const BTW_PROMPT = `Ephemeral side question for current interactive session.
Answer briefly, directly; use conversation context already provided.
NEVER use tools.
NEVER ask follow-up questions.
Question:
{{question}}`;

function btwPrompt(question: string): string {
  return BTW_PROMPT.replace("{{question}}", question);
}

type HostModelRef = { api: string; provider: string; id: string };

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return !!value && typeof value === "object";
}

function isHostModelRef(value: unknown): value is HostModelRef {
  return isObject(value) &&
    typeof value.api === "string" && typeof value.provider === "string" && typeof value.id === "string";
}

// OMP 18's own btw follow-up turn (packages/coding-agent/src/session/btw-turn.ts)
// replays the earlier side turns as ordinary user/assistant messages so the
// provider sees the chat's context without any of it reaching the session
// transcript. Hosts before 18.6 ignore `history`; follow-ups then lack the
// earlier side answers.
function sideChatHistoryMessages(history: SideTurnInput["history"], model: HostModelRef): unknown[] {
  const timestamp = Date.now();
  const messages: unknown[] = [];
  for (const turn of history) {
    messages.push({
      role: "user",
      content: [{ type: "text", text: btwPrompt(turn.question) }],
      attribution: "agent",
      timestamp,
    });
    messages.push({
      role: "assistant",
      content: [{ type: "text", text: turn.answer }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp,
    });
  }
  return messages;
}

async function runOmpSideTurn(input: SideTurnInput, sessionManager: unknown): Promise<string> {
  const session = getOmpNativeSession(sessionManager);
  if (!session) {
    const stats = getOmpNativeCaptureStats(sessionManager);
    throw new Error(`/btw has no captured OMP session yet (patch applied: ${stats.patches > 0}, accessor calls seen: ${stats.publishes}).`);
  }
  const run = session.runEphemeralTurn;
  if (typeof run !== "function") {
    throw new Error("/btw needs OMP ≥ 18.1 (AgentSession.runEphemeralTurn); this host's session lacks it.");
  }
  const model = session.model;
  if (!isHostModelRef(model)) {
    throw new Error("No active model available for /btw.");
  }
  const result: unknown = await Reflect.apply(run, session, [{
    promptText: btwPrompt(input.question),
    history: sideChatHistoryMessages(input.history, model),
    conversationKey: input.conversationKey,
    onTextDelta: input.onTextDelta,
    signal: input.signal,
  }]);
  const replyText = result && typeof result === "object" && "replyText" in result ? result.replyText : undefined;
  return String(replyText ?? "").trim();
}

export const bridgeDescriptor = {
  harnessId: "omp", name: "Oh My Pi", hostVersion: "public-api", wrapperVersion: "0.1.0",
  eventProfile: PUBLIC_EVENT_PROFILE,
  capabilities: {
    prompt: true, steer: true, followUp: true, abort: true, compact: true,
    models: true, setModel: true, setThinking: true, rename: true, fastMode: true,
    commands: true, reload: false, queueRead: false, queueCancel: false,
    treeRead: true, treeNavigation: true, extensionUI: true, shareSnapshot: true,
    sideChat: true, login: true,
  },
  // OMP's --thinking vocabulary (omp --help). Models support a subset — OMP
  // clamps — but the bridge must accept every value the harness does.
  thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"],
  sessionSwitchEvents: true,
  nestedSubsessions: true,
  publicCompactionEvents: true,
  compactArgument: (instructions: string) => instructions,
  treeCommandContext: true,
  runSideTurn: runOmpSideTurn,
  login: ompLogin,
  nativeProjection: {
    get: getOmpNativeProjection,
    subscribe: subscribeOmpNativeProjection,
  },
  fastMode: {
    state: ompFastModeState,
    set: setOmpFastMode,
  },
} satisfies BridgeDescriptor;

// hostAgentSession is the host's AgentSession class and hostAuthModule its
// @oh-my-pi/pi-ai module, both imported by the generated launch wrapper
// itself (OMP's bare-specifier rewrite only covers the entry file's directory
// tree, which the repo's modules are outside when the entry lives in
// launch-wrappers/). Discovery loads get both from the modules' own
// top-level imports.
export function createHarnessBridge(spawnToken?: string, hostAgentSession?: unknown, hostAuthModule?: unknown) {
  if (hostAgentSession) patchOmpAgentSession(hostAgentSession);
  if (hostAuthModule) useOmpAuthModule(hostAuthModule);
  return createBridge({ ...bridgeDescriptor, spawnToken });
}

export default createHarnessBridge();
