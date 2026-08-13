'use strict';

const os = require('os');
const path = require('path');

// Deliberately data-only: launch/RPC modules consume this registry, never the
// reverse, which keeps harness selection free of the rpc-session dependency.
const repo = path.resolve(__dirname, '..');
const bridge = (name) => path.join(repo, 'extensions', `pi-dish-bridge-${name}`, 'index.ts');

// OMP's bundled provider ids do not all map mechanically to one environment
// variable (google uses GEMINI_API_KEY, Anthropic also accepts an OAuth token,
// and several coding-plan providers have host-specific names). Keep that
// launch/config knowledge on the harness descriptor side of the boundary.
// Unknown extension-provided providers still get the conventional
// <PROVIDER>_API_KEY fallback in server.js.
const OMP_PROVIDER_CREDENTIALS = {
  aiand: ['AIAND_API_KEY'],
  aimlapi: ['AIMLAPI_API_KEY'],
  'alibaba-coding-plan': ['ALIBABA_CODING_PLAN_API_KEY'],
  'alibaba-token-plan': ['ALIBABA_TOKEN_PLAN_API_KEY', 'BAILIAN_TOKEN_PLAN_API_KEY'],
  'amazon-bedrock': ['AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'AWS_WEB_IDENTITY_TOKEN_FILE'],
  anthropic: ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_FOUNDRY_API_KEY'],
  azure: ['AZURE_OPENAI_API_KEY'],
  baseten: ['BASETEN_API_KEY'],
  'bedrock-mantle': ['AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'AWS_WEB_IDENTITY_TOKEN_FILE'],
  cerebras: ['CEREBRAS_API_KEY'],
  'cloudflare-ai-gateway': ['CLOUDFLARE_AI_GATEWAY_API_KEY'],
  coreweave: ['COREWEAVE_API_KEY', 'WANDB_API_KEY'],
  cursor: ['CURSOR_ACCESS_TOKEN'],
  deepseek: ['DEEPSEEK_API_KEY'],
  devin: ['DEVIN_API_KEY'],
  firepass: ['FIREPASS_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  'github-copilot': ['COPILOT_GITHUB_TOKEN'],
  'gitlab-duo': ['GITLAB_TOKEN'],
  'gitlab-duo-agent': ['GITLAB_TOKEN'],
  'gmi-cloud': ['GMI_API_KEY'],
  google: ['GEMINI_API_KEY'],
  'google-antigravity': null,
  'google-gemini-cli': null,
  'google-vertex': ['GOOGLE_CLOUD_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS'],
  groq: ['GROQ_API_KEY'],
  huggingface: ['HUGGINGFACE_HUB_TOKEN', 'HF_TOKEN'],
  kilo: ['KILO_API_KEY'],
  'kimi-code': ['KIMI_API_KEY'],
  litellm: ['LITELLM_API_KEY'],
  'lm-studio': ['LM_STUDIO_API_KEY'],
  meta: ['MODEL_API_KEY', 'META_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
  'minimax-code': ['MINIMAX_CODE_API_KEY'],
  'minimax-code-cn': ['MINIMAX_CODE_CN_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  moonshot: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
  nanogpt: ['NANO_GPT_API_KEY'],
  nvidia: ['NVIDIA_API_KEY'],
  novita: ['NOVITA_API_KEY'],
  ollama: [], // local Ollama is intentionally keyless
  'ollama-cloud': ['OLLAMA_CLOUD_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  'openai-codex': ['OPENAI_CODEX_OAUTH_TOKEN'],
  'opencode-go': ['OPENCODE_API_KEY'],
  'opencode-zen': ['OPENCODE_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  qianfan: ['QIANFAN_API_KEY'],
  'qwen-portal': ['QWEN_OAUTH_TOKEN', 'QWEN_PORTAL_API_KEY'],
  sakana: ['SAKANA_API_KEY', 'FUGU_API_KEY'],
  siliconflow: ['SILICONFLOW_API_KEY'],
  'siliconflow-cn': ['SILICONFLOW_CN_API_KEY'],
  synthetic: ['SYNTHETIC_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  umans: ['UMANS_AI_CODING_PLAN_API_KEY'],
  venice: ['VENICE_API_KEY'],
  'vercel-ai-gateway': ['AI_GATEWAY_API_KEY'],
  vllm: ['VLLM_API_KEY'],
  'wafer-serverless': ['WAFER_SERVERLESS_API_KEY'],
  xai: ['XAI_API_KEY'],
  'xai-oauth': ['XAI_OAUTH_TOKEN', 'XAI_API_KEY'],
  xiaomi: ['XIAOMI_API_KEY'],
  'xiaomi-token-plan-ams': ['XIAOMI_TOKEN_PLAN_AMS_API_KEY'],
  'xiaomi-token-plan-cn': ['XIAOMI_TOKEN_PLAN_CN_API_KEY'],
  'xiaomi-token-plan-sgp': ['XIAOMI_TOKEN_PLAN_SGP_API_KEY'],
  zai: ['ZAI_API_KEY'],
  zenmux: ['ZENMUX_API_KEY'],
  'zhipu-coding-plan': ['ZHIPU_API_KEY'],
};

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
    providerCredentials: OMP_PROVIDER_CREDENTIALS,
    pilotConfig: { modelRoles: 'modelRoles', defaultThinkingLevel: 'defaultThinkingLevel' },
    argv: {
      new: ({ model, thinking } = {}) => ['--extension', bridge('omp'), ...(model ? ['--model', model] : []), ...(thinking ? ['--thinking', thinking] : [])],
      resume: ({ file, model } = {}) => ['--extension', bridge('omp'), '--resume', file, ...(model ? ['--model', model] : [])],
      models: ['models', '--json'],
      configGet: (key) => ['config', 'get', key, '--json'],
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
  const launchEnv = {};
  if (words[0] === 'env') words = words.slice(1);
  while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    const [key, ...value] = words.shift().split('=');
    launchEnv[key] = value.join('=');
  }
  return { env: launchEnv, argv: words.length ? words : [descriptor.command] };
}

module.exports = { registry, getHarness, listHarnesses, resolveLaunchSpec };
