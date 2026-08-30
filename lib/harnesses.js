'use strict';

const os = require('os');
const path = require('path');

// Deliberately data-only: launch/RPC modules consume this registry, never the
// reverse, which keeps harness selection free of the rpc-session dependency.
const repo = path.resolve(__dirname, '..');
const bridge = (name) => path.join(repo, 'extensions', `pi-dish-bridge-${name}`, 'index.ts');


const registry = {
  pi: {
    id: 'pi', label: 'Pi', wrapperEntrypoint: null, eventProfile: 'pi-v3', profileId: 'pi-v3', profileVersion: 1,
    rootPath: () => path.join(os.homedir(), '.pi', 'agent', 'sessions'), layout: 'nested', commandEnv: 'PI_DISH_PI_COMMAND',
    command: 'pi', rpcFallback: true, modelCatalog: 'pi-sdk', closeMode: 'logical',
    argv: { new: ({ model, thinking } = {}) => [...(model ? ['--model', model] : []), ...(thinking ? ['--thinking', thinking] : [])], resume: ({ file, model } = {}) => ['--session', file, ...(model ? ['--model', model] : [])], models: ['--list-models'] },
  },
  omp: {
    id: 'omp', label: 'Oh My Pi', wrapperEntrypoint: bridge('omp'), eventProfile: 'omp-v1', profileId: 'omp-v1', profileVersion: 1,
    rootPath: () => path.join(os.homedir(), '.omp', 'agent', 'sessions'), layout: 'nested', nestedSubsessions: true,
    commandEnv: 'PI_DISH_OMP_COMMAND',
    // OMP persists image bytes ≥1KB outside the session JSONL: the entry
    // keeps `data: "blob:sha256:<hex>"` and the raw bytes live in this
    // content-addressed store (oh-my-pi session-persistence/blob-store).
    blobsPath: () => path.join(os.homedir(), '.omp', 'agent', 'blobs'),
    command: 'omp', rpcFallback: false, modelCatalog: 'command', closeMode: 'owned-pane', spawnTokenMode: 'wrapper',
    // install.sh links the bridge here for OMP's own extension discovery, so
    // every omp session — not just pi-dish spawns — loads it. Spawns check
    // this before injecting a launch wrapper (see discoveryBridgeInstalled).
    discoveryExtensionsDir: (env = process.env) =>
      path.join(env.OMP_AGENT_DIR || path.join(env.HOME || os.homedir(), '.omp', 'agent'), 'extensions'),
    // OMP's first-run setup wizard owns TUI input until dismissed, which a
    // web pilot can't do — it swallows the keypress that hands the bridge a
    // command context for tree navigation (504s) and garbles the embedded
    // terminal view. Web-piloted sessions don't need it: `omp models --json`
    // already reads OMP's auth storage and returns only authenticated or
    // keyless providers.
    spawnEnv: { OMP_SKIP_SETUP: '1' },
    pilotConfig: { modelRoles: 'modelRoles', defaultThinkingLevel: 'defaultThinkingLevel' },
    // Curated pane-typed commands, each verified non-interactive in a real
    // OMP TUI pane (17.2.15 for /shake, 17.4.0 for the next three, 18.0.1 for
    // the rest): they complete with a status line or status-bar change, no
    // overlay or follow-up interaction. Descriptor arg model: `allowedArgs`
    // exact-matches a curated set, `freeArgs` takes arbitrary single-line text,
    // `requireArgs` rejects the bare form (it would open a TUI overlay), and
    // `blockedArgs` rejects the sub-forms that do. Excluded: /omfg opens a
    // multi-step generation/save flow; bare /goal and /goal drop|set|budget
    // open TUI menus/editors/confirms (hence the goal descriptor's gates);
    // /plan and /vibe are mode toggles whose follow-up UX (plan review, drafts)
    // is TUI-only, so toggling them from a phone strands the user. WS-G
    // excluded /handoff because its in-pane switch left pi-dish on the old
    // route; switch adoption now closes that gap, but re-evaluating /handoff's
    // host-command UX remains separate work. /hotkeys is terminal-only;
    // /review is a prompt command. /branch, /tree, /debug, /pause open TUI
    // selectors/screens.
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
      new: ({ model, thinking } = {}) => ['--extension', bridge('omp'), ...(model ? ['--model', model] : []), ...(thinking ? ['--thinking', thinking] : [])],
      resume: ({ file, model } = {}) => ['--extension', bridge('omp'), '--resume', file, ...(model ? ['--model', model] : [])],
      export: ({ file, output }) => ['--export', file, output],
      models: ['models', '--json'],
      configGet: (key) => ['config', 'get', key, '--json'],
      // `config set` replaces the whole record in the *global* config
      // regardless of cwd (dotted sub-keys are unsupported), so json is a
      // pre-stringified whole value passed as one execFile argv entry.
      configSet: (key, json) => ['config', 'set', key, json, '--json'],
    },
  },
  prime: {
    id: 'prime', label: 'Prime Agent', wrapperEntrypoint: bridge('prime'), eventProfile: 'prime-v1', profileId: 'prime-v1', profileVersion: 1,
    rootPath: () => path.join(os.homedir(), '.prime', 'agent', 'sessions'), layout: 'flat', commandEnv: 'PI_DISH_PRIME_COMMAND',
    command: 'prime-agent', rpcFallback: false, modelCatalog: null, closeMode: 'client-only', spawnTokenMode: 'wrapper',
    argv: { new: ({ model, thinking } = {}) => ['--extension', bridge('prime'), ...(model ? ['--model', model] : []), ...(thinking ? ['--thinking', thinking] : [])], resume: ({ file, model } = {}) => ['--extension', bridge('prime'), '--resume', file, ...(model ? ['--model', model] : [])], models: ['model', 'list'] },
  },
};

function getHarness(id) { return registry[id] || null; }
function listHarnesses() { return Object.values(registry); }

function splitShellWords(input) {
  const words = [];
  let current = '', quote = null, escaped = false;
  for (const char of String(input || '')) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) {
      if (char === quote) quote = null; else current += char;
    } else if (char === "'" || char === '"') quote = char;
    else if (/\s/.test(char)) { if (current) { words.push(current); current = ''; } }
    else current += char;
  }
  if (current) words.push(current);
  return words;
}

function resolveLaunchSpec(descriptor, env = process.env) {
  const configured = env[descriptor.commandEnv];
  let words = splitShellWords(configured || descriptor.command);
  // Descriptor defaults seed the launch env; env assignments parsed from the
  // user's configured command below override them.
  const launchEnv = { ...(descriptor.spawnEnv || {}) };
  if (words[0] === 'env') words = words.slice(1);
  while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    const [key, ...value] = words.shift().split('=');
    launchEnv[key] = value.join('=');
  }
  return { env: launchEnv, argv: words.length ? words : [descriptor.command] };
}

module.exports = { registry, getHarness, listHarnesses, resolveLaunchSpec };
