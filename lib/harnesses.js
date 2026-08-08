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
    rootPath: () => path.join(os.homedir(), '.omp', 'agent', 'sessions'), layout: 'nested', commandEnv: 'PI_DISH_OMP_COMMAND',
    command: 'omp', rpcFallback: false, modelCatalog: 'command', closeMode: 'unsupported', spawnTokenMode: 'wrapper',
    argv: { new: ({ model, thinking } = {}) => ['--extension', bridge('omp'), ...(model ? ['--model', model] : []), ...(thinking ? ['--thinking', thinking] : [])], resume: ({ file, model } = {}) => ['--extension', bridge('omp'), '--resume', file, ...(model ? ['--model', model] : [])], models: ['models', '--json'] },
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
  const launchEnv = {};
  if (words[0] === 'env') words = words.slice(1);
  while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    const [key, ...value] = words.shift().split('=');
    launchEnv[key] = value.join('=');
  }
  return { env: launchEnv, argv: words.length ? words : [descriptor.command] };
}

module.exports = { registry, getHarness, listHarnesses, resolveLaunchSpec };
