// Generated from src/core/harnesses.ts; edit that source and run npm run build:core.
'use strict';
const os = require("os");
const path = require("path");
const runtime_resources_1 = require("./runtime-resources");
const private_sessions_1 = require("./private-sessions");
// Data-only: launch/RPC modules consume this registry, never the reverse.
const repo = path.resolve(__dirname, '..');
const bridge = (name) => (0, runtime_resources_1.runtimeResourcePath)(repo, `extensions/pi-dish-bridge-${name}/index.ts`);
function piResume({ file, model } = {}) {
    return ['--session', file, ...(model ? ['--model', model] : [])];
}
function ompResume({ file, model } = {}) {
    return ['--extension', bridge('omp'), '--resume', file, ...(model ? ['--model', model] : [])];
}
function primeResume({ file, model } = {}) {
    return ['--resume', file, ...(model ? ['--model', model] : [])];
}
const registry = {
    pi: {
        id: 'pi', label: 'Pi', wrapperEntrypoint: null, eventProfile: 'pi-v3', profileId: 'pi-v3', profileVersion: 1,
        rootPath: () => path.join(os.homedir(), '.pi', 'agent', 'sessions'),
        privateRootPath: () => (0, private_sessions_1.privateRootPath)('pi'), layout: 'nested', commandEnv: 'PI_DISH_PI_COMMAND',
        command: 'pi', rpcFallback: true, modelCatalog: 'pi-sdk', closeMode: 'logical',
        // `--session-dir` is appended last: the launch wrapper replaces the argv
        // entry equal to wrapperEntrypoint and must keep `--extension` adjacent.
        argv: { new: ({ model, thinking, sessionDir } = {}) => [...(model ? ['--model', model] : []), ...(thinking ? ['--thinking', thinking] : []), ...(sessionDir ? ['--session-dir', sessionDir] : [])], resume: piResume, models: ['--list-models'] },
    },
    omp: {
        id: 'omp', label: 'Oh My Pi', wrapperEntrypoint: bridge('omp'), eventProfile: 'omp-v1', profileId: 'omp-v1', profileVersion: 1,
        rootPath: () => path.join(os.homedir(), '.omp', 'agent', 'sessions'), layout: 'nested', nestedSubsessions: true,
        privateRootPath: () => (0, private_sessions_1.privateRootPath)('omp'),
        // `custom` entry OMP appends when a session is disposed (incl. a parked
        // subagent). Only a JSONL's *final* entry counts: a revived session appends
        // past its own exit, so mid-file markers mean nothing.
        sessionExitCustomType: 'session_exit',
        commandEnv: 'PI_DISH_OMP_COMMAND',
        // OMP stores image bytes ≥1KB here, content-addressed; the JSONL entry
        // keeps `data: "blob:sha256:<hex>"`.
        blobsPath: () => path.join(os.homedir(), '.omp', 'agent', 'blobs'),
        command: 'omp', rpcFallback: false, modelCatalog: 'command', closeMode: 'owned-pane', spawnTokenMode: 'wrapper',
        // The launch wrapper imports this itself: OMP's bare-specifier rewrite only
        // covers the entry's directory tree, which the wrapper doesn't share.
        wrapperHostPackage: '@oh-my-pi/pi-coding-agent',
        wrapperAuthPackage: '@oh-my-pi/pi-ai',
        wrapperUiControllerModule: '@oh-my-pi/pi-coding-agent/modes/controllers/extension-ui-controller',
        // install.sh links the bridge here so every omp session loads it; spawns
        // check this before injecting a launch wrapper.
        discoveryExtensionsDir: (env = process.env) => path.join(env.OMP_AGENT_DIR || path.join(env.HOME || os.homedir(), '.omp', 'agent'), 'extensions'),
        // OMP's first-run wizard owns TUI input until dismissed, which a web pilot
        // can't do (it swallows bridge keypresses and garbles the terminal view).
        // `omp models --json` already reads auth storage, so the wizard isn't needed.
        spawnEnv: { OMP_SKIP_SETUP: '1' },
        // Back the model-roles editor (OMP /models roles) and agents editor (/agents).
        pilotConfig: {
            modelRoles: 'modelRoles', defaultThinkingLevel: 'defaultThinkingLevel',
            disabledAgents: 'task.disabledAgents',
            agentModelOverrides: 'task.agentModelOverrides',
            agentPrewalk: 'task.agentPrewalk',
            agentAdvisor: 'task.agentAdvisor',
        },
        // OMP's /settings tab order; settings outside these tabs have no TUI entry.
        settingsTabs: ['appearance', 'model', 'interaction', 'context', 'memory', 'files', 'shell', 'tools', 'tasks', 'providers'],
        // `unpack` into a throwaway dir is the only way to enumerate bundled
        // agents; the dirs are where `omp agents unpack --user|--project` write.
        taskAgents: {
            unpack: (dir) => ['agents', 'unpack', '--dir', dir, '--json', '--force'],
            userDir: (env = process.env) => path.join(env.PI_CODING_AGENT_DIR || env.OMP_AGENT_DIR
                || path.join(env.HOME || os.homedir(), '.omp', 'agent'), 'agents'),
            projectDir: (cwd) => path.join(cwd, '.omp', 'agents'),
        },
        // Pane-typed commands verified non-interactive in a real OMP TUI (they end
        // with a status line, no overlay). `allowedArgs` exact-matches a curated
        // set, `freeArgs` takes single-line text, `requireArgs` rejects the bare
        // form and `blockedArgs` the sub-forms that would open a TUI overlay.
        // Excluded as TUI-only or interactive: /omfg, /plan, /vibe, /handoff,
        // /hotkeys, /review (prompt command), /branch, /tree, /debug, /pause.
        hostBuiltins: [{
                name: 'shake',
                description: 'Drop heavy content from context (tool results, large blocks, or images)',
                args: '[images]',
                allowedArgs: ['images'],
            }, {
                name: 'retry',
                description: 'Retry the last failed agent turn',
            }, {
                name: 'fresh',
                description: 'Reset provider stream state without changing the local transcript',
            }, {
                name: 'clear',
                description: 'Clear the conversation context in place, keeping the session',
            }, {
                name: 'advisor',
                description: 'Toggle or inspect the second-model advisor',
                args: '[on | off | status | dump | dump raw]',
                allowedArgs: ['on', 'off', 'status', 'dump', 'dump raw'],
            }, {
                name: 'prewalk',
                description: 'Arm a one-shot switch to the smol-role model at the next edit/write',
            }, {
                name: 'fast',
                description: 'Toggle the priority service tier',
                args: '[on | off | status]',
                allowedArgs: ['on', 'off', 'status'],
            }, {
                name: 'extended-context',
                description: 'Toggle the extended context window',
                args: '[on | off | status]',
                allowedArgs: ['on', 'off', 'status'],
            }, {
                name: 'vision',
                description: 'Toggle vision support for the current model',
                args: '[on | off | auto | status]',
                allowedArgs: ['on', 'off', 'auto', 'status'],
            }, {
                name: 'computer',
                description: 'Toggle computer use',
                args: '[on | off | status]',
                allowedArgs: ['on', 'off', 'status'],
            }, {
                name: 'loop',
                description: 'Toggle loop mode (the arg\u2019d prompt form stays TUI-only)',
            }, {
                name: 'goal',
                description: 'Set or inspect the session goal',
                args: '<objective | show | pause | resume | budget N | set text>',
                freeArgs: true,
                requireArgs: true,
                // /goal drop confirms in an overlay in every spelling; bare set/budget
                // open TUI editors, while `set <text>` and `budget <n>` complete in place.
                blockedArgs: ['drop', { arg: 'set', exact: true }, { arg: 'budget', exact: true }],
            }, {
                name: 'guided-goal',
                description: 'Start a goal-definition interview in the chat',
                args: '<rough objective>',
                freeArgs: true,
                requireArgs: true,
            }],
        argv: {
            new: ({ model, thinking, sessionDir } = {}) => ['--extension', bridge('omp'), ...(model ? ['--model', model] : []), ...(thinking ? ['--thinking', thinking] : []), ...(sessionDir ? ['--session-dir', sessionDir] : [])],
            resume: ompResume,
            export: ({ file, output }) => ['--export', file, output],
            models: ['models', '--json'],
            configGet: (key) => ['config', 'get', key, '--json'],
            // Per-provider quota windows; standalone (no session). --redact keeps
            // account ids/emails off the wire; the server still whitelists fields.
            usage: ['usage', '--json', '--redact'],
            // Replaces the whole record in the *global* config (no dotted sub-keys),
            // so json values are pre-stringified into one argv entry; scalars as text.
            configSet: (key, value) => ['config', 'set', key, value, '--json'],
            configList: ['config', 'list', '--json'],
            configSchema: ['config', 'list'],
            configReset: (key) => ['config', 'reset', key, '--json'],
        },
    },
    prime: {
        id: 'prime', label: 'Prime Agent', wrapperEntrypoint: null, eventProfile: 'prime-v1', profileId: 'prime-v1', profileVersion: 1,
        rootPath: () => path.join(os.homedir(), '.prime', 'agent', 'sessions'), layout: 'flat', commandEnv: 'PI_DISH_PRIME_COMMAND',
        command: 'prime-agent', rpcFallback: false, modelCatalog: null, closeMode: 'owned-agent',
        // Prime (Rust) loads no TypeScript extensions; pi-dish is another client of
        // its resident daemon and reads live roots from the daemon roster.
        liveTransport: 'prime-daemon',
        // RLM subagents persist under session-artifacts/<parentId>/sub-<id8>/<child>.jsonl
        // (recursively); child headers carry the parentSession edge and the
        // per-child rlm-subagent.json display entry proves liveness.
        subagentArtifacts: true,
        argv: { new: ({ model, thinking } = {}) => [...(model ? ['--model', model] : []), ...(thinking ? ['--thinking', thinking] : [])], resume: primeResume, models: ['model', 'list'] },
    },
};
function getHarness(id) {
    // The own-key check establishes membership; Object.hasOwn does not narrow it.
    return typeof id === 'string' && Object.hasOwn(registry, id) ? registry[id] : null;
}
function listHarnesses() { return Object.values(registry); }
function splitShellWords(input) {
    const words = [];
    let current = '', quote = null, escaped = false;
    for (const char of String(input || '')) {
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === '\\' && quote !== "'") {
            escaped = true;
            continue;
        }
        if (quote) {
            if (char === quote)
                quote = null;
            else
                current += char;
        }
        else if (char === "'" || char === '"')
            quote = char;
        else if (/\s/.test(char)) {
            if (current) {
                words.push(current);
                current = '';
            }
        }
        else
            current += char;
    }
    if (current)
        words.push(current);
    return words;
}
/**
 * One configured command line: bare `env`, then KEY=VALUE assignments (which
 * override `baseEnv`), then the argv.
 */
function parseLaunchWords(input, baseEnv = {}) {
    let words = splitShellWords(input);
    if (words[0] === 'env')
        words = words.slice(1);
    const env = { ...baseEnv };
    while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
        const [key, ...value] = words.shift().split('=');
        env[key] = value.join('=');
    }
    return { env, words };
}
function resolveLaunchSpec(descriptor, env = process.env) {
    const { env: launchEnv, words } = parseLaunchWords(env[descriptor.commandEnv] || descriptor.command, descriptor.spawnEnv);
    return { env: launchEnv, argv: words.length ? words : [descriptor.command] };
}
module.exports = { registry, getHarness, listHarnesses, resolveLaunchSpec, parseLaunchWords };
