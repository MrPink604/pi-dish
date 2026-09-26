import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { createHash } from 'node:crypto';
import { execFile, type ChildProcess } from 'node:child_process';
import type { HarnessDescriptor } from './contracts';
import { harnessLaunchSpec } from './harness-launch-spec';
import { normalizeModels, type CatalogModel } from './session-api';

export const MODELS_CACHE_TTL = 60000;
const HARNESS_JSON_EXIT_GRACE_MS = 250;
interface HarnessModelsCacheEntry {
  catalog?: unknown;
  time?: number;
  signature: string;
  inFlight?: Promise<unknown>;
}
const harnessModelsCache = new Map<string, HarnessModelsCacheEntry>();

export function harnessCommandAvailable(descriptor: HarnessDescriptor): boolean {
  const spec = harnessLaunchSpec(descriptor);
  const command = spec.argv[0];
  if (!command) return false;
  const environment = { ...process.env, ...spec.env };
  const executable = (file: string) => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } };
  if (command.includes(path.sep)) return executable(path.resolve(command));
  return String(environment.PATH || '').split(path.delimiter)
    .some(dir => dir && executable(path.join(dir, command)));
}

function resolveHarnessCwd(value: unknown): string {
  const home = process.env.HOME || os.homedir();
  if (typeof value !== 'string' || !value.trim()) return process.cwd();
  const trimmed = value.trim();
  const expanded = trimmed === '~' ? home
    : trimmed.startsWith('~/') ? path.join(home, trimmed.slice(2)) : trimmed;
  return path.resolve(expanded);
}

/** Run the configured harness, preserving its cwd, environment and extensions. */
export function runHarnessJsonCommand(
  descriptor: HarnessDescriptor,
  commandArgs: string[],
  { cwd, acceptCompleteJson = false }: { cwd?: unknown; acceptCompleteJson?: boolean } = {},
): Promise<unknown> {
  const spec = harnessLaunchSpec(descriptor);
  const args = [...spec.argv.slice(1), ...commandArgs];
  return new Promise((resolve, reject) => {
    let settled = false;
    let completeJsonTimer: NodeJS.Timeout | undefined;
    let streamedStdout = '';
    let child: ChildProcess;
    const settle = (callback: (value: unknown) => void, value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(completeJsonTimer);
      callback(value);
    };
    const acceptStreamedJson = () => {
      if (!acceptCompleteJson || completeJsonTimer || !/[\r\n]\s*$/.test(streamedStdout)) return;
      let parsed: unknown;
      try { parsed = JSON.parse(streamedStdout.trim()); } catch { return; }
      // Accept a complete response after a short normal-exit grace, then stop
      // a CLI whose extensions left the event loop alive.
      completeJsonTimer = setTimeout(() => {
        settle(resolve, parsed);
        child.kill();
      }, HARNESS_JSON_EXIT_GRACE_MS);
    };
    child = execFile(spec.argv[0], args, {
      env: { ...process.env, ...spec.env },
      cwd: resolveHarnessCwd(cwd),
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (settled) return;
      // Pricing historically accepted complete JSON on timeout even without a
      // final newline. Ordinary nonzero exits and partial JSON still fail.
      if (error && !(acceptCompleteJson && error.killed)) {
        return settle(reject, new Error((stderr || error.message).trim()));
      }
      try {
        const parsed: unknown = JSON.parse(stdout.trim() || '{}');
        settle(resolve, parsed);
      } catch (parseError) {
        settle(reject, new Error(`Could not parse ${descriptor.label} command output: ${parseError instanceof Error ? parseError.message : undefined}`));
      }
    });
    if (acceptCompleteJson && child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        clearTimeout(completeJsonTimer);
        completeJsonTimer = undefined;
        if (streamedStdout.length <= 10 * 1024 * 1024) streamedStdout += chunk;
        acceptStreamedJson();
      });
    }
  });
}

/** Shared raw catalog: pricing and interactive discovery must not start two CLIs. */
export async function runHarnessModelCatalog(
  descriptor: HarnessDescriptor,
  { cwd, force = false }: { cwd?: unknown; force?: boolean } = {},
): Promise<unknown> {
  const resolvedCwd = resolveHarnessCwd(cwd);
  const spec = harnessLaunchSpec(descriptor);
  const env = { ...process.env, ...spec.env };
  // Hash rather than retain credential values in cache keys. A changed launch
  // command, profile, provider endpoint or credential environment is a new scope.
  const scope = createHash('sha256').update(JSON.stringify([
    spec.argv, descriptor.argv.models, Object.keys(env).sort().map(key => [key, env[key]]),
  ])).digest('hex');
  const cacheKey = `${descriptor.id}\0${resolvedCwd}\0${scope}`;
  const signature = modelCatalogSignature(resolvedCwd, spec.argv, env);
  const cached = harnessModelsCache.get(cacheKey);
  if (cached?.signature === signature) {
    if (cached.inFlight) return cached.inFlight;
    if (!force && cached.time !== undefined && Date.now() - cached.time < MODELS_CACHE_TTL) return cached.catalog;
  }
  const entry: HarnessModelsCacheEntry = { signature };
  entry.inFlight = runHarnessJsonCommand(
    descriptor, descriptor.argv.models, { cwd: resolvedCwd, acceptCompleteJson: true },
  ).then(parsed => {
    if (parsed === null || parsed === undefined) throw new TypeError(`Cannot read properties of ${parsed} (reading 'models')`);
    entry.catalog = parsed;
    entry.time = Date.now();
    return parsed;
  }).finally(() => { delete entry.inFlight; });
  harnessModelsCache.set(cacheKey, entry);
  return entry.inFlight;
}

const catalogFileDigests = new Map<string, { stamp: string; digest: string }>();

function catalogDatabaseDigest(file: string, stat: fs.Stats): string {
  if (stat.size === 0) return 'empty';
  const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const cached = catalogFileDigests.get(file);
  if (cached?.stamp === stamp) return cached.digest;
  const bytes = fs.readFileSync(file);
  const hash = createHash('sha256');
  if (bytes.length >= 100 && bytes.subarray(0, 16).toString('ascii') === 'SQLite format 3\0') {
    // OMP checkpoints both stores on every catalog run, even when no logical
    // rows changed. SQLite's file-change counter (24..27) and matching
    // version-valid-for counter (92..95) are bookkeeping, not auth/model data.
    hash.update(bytes.subarray(0, 24)).update(bytes.subarray(28, 92)).update(bytes.subarray(96));
  } else hash.update(bytes);
  const digest = hash.digest('hex');
  catalogFileDigests.set(file, { stamp, digest });
  return digest;
}

function modelCatalogSignature(cwd: string, argv: string[], env: NodeJS.ProcessEnv): string {
  const home = env.HOME || os.homedir();
  const expand = (value: string) => path.resolve(cwd, value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value);
  const profileArg = argv.find(arg => arg.startsWith('--profile='));
  const profileIndex = argv.indexOf('--profile');
  const profile = profileArg?.slice('--profile='.length) || (profileIndex >= 0 ? argv[profileIndex + 1] : env.OMP_PROFILE);
  const root = profile ? path.join(home, '.omp', 'profiles', profile) : path.join(home, '.omp');
  const agentDir = expand(env.PI_CODING_AGENT_DIR || env.OMP_AGENT_DIR || path.join(root, 'agent'));
  const agentDirs = new Set([agentDir, path.join(root, 'agent')]);
  const databases = new Set<string>();
  const files = new Set<string>([
    path.join(home, '.env'), path.join(root, '.env'),
    env.AWS_SHARED_CREDENTIALS_FILE || path.join(home, '.aws', 'credentials'),
    env.AWS_CONFIG_FILE || path.join(home, '.aws', 'config'),
    env.GOOGLE_APPLICATION_CREDENTIALS || path.join(env.CLOUDSDK_CONFIG || path.join(home, '.config', 'gcloud'), 'application_default_credentials.json'),
  ]);
  const configNames = ['config.yml', 'config.yaml', 'settings.json', 'models.yml', 'models.yaml', 'models.json', 'auth.json', '.env', 'extensions'];
  for (const dir of agentDirs) {
    for (const name of configNames) files.add(path.join(dir, name));
    for (const name of ['agent.db', 'agent.db-wal', 'models.db', 'models.db-wal']) {
      const file = path.join(dir, name);
      databases.add(file);
      files.add(file);
    }
  }
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    files.add(path.join(dir, '.env'));
    for (const name of configNames) files.add(path.join(dir, '.omp', name));
    if (dir === path.dirname(dir)) break;
  }
  // Explicit config overlays and command wrapper scripts are part of discovery.
  for (const arg of argv) {
    if (arg.startsWith('--config=')) files.add(expand(arg.slice('--config='.length)));
    else if (!arg.startsWith('-')) files.add(expand(arg));
  }
  const command = argv[0];
  if (command && !command.includes(path.sep)) {
    for (const dir of (env.PATH || '').split(path.delimiter)) {
      if (dir) files.add(path.resolve(cwd, dir, command));
    }
  }
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(file);
    try {
      const stat = fs.statSync(file);
      digest.update(databases.has(file) ? catalogDatabaseDigest(file, stat)
        : `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unreadable';
      // An absent WAL and an empty, checkpointed WAL carry the same data.
      digest.update(code === 'ENOENT' && databases.has(file) && file.endsWith('-wal') ? 'empty' : code);
    }
    digest.update('\0');
  }
  // External provider discovery and extension-owned inputs keep the existing
  // 60s bound; never reuse a result across changed local auth/config inputs.
  return digest.digest('hex');
}

export async function runHarnessModelCommand(
  descriptor: HarnessDescriptor,
  options: { cwd?: unknown } = {},
): Promise<CatalogModel[]> {
  const parsed = await runHarnessModelCatalog(descriptor, options);
  const models = typeof parsed === 'object' && parsed !== null && 'models' in parsed ? parsed.models : undefined;
  return normalizeModels(models || parsed);
}

/** Older live registries can omit thinking ladders; missing catalog stays partial. */
export async function withCatalogThinkingLevels(
  models: CatalogModel[], descriptor: HarnessDescriptor | null, options: { cwd?: unknown } = {},
): Promise<CatalogModel[]> {
  if (descriptor?.modelCatalog !== 'command') return models;
  if (!models.some(m => m.reasoning !== false && !Array.isArray(m.thinking))) return models;
  try {
    const catalog = await runHarnessModelCommand(descriptor, options);
    const levelsBySelector = new Map(
      catalog.filter(m => m && Array.isArray(m.thinking)).map(m => [m.selector, m.thinking]));
    return models.map(m => {
      if (!m || Array.isArray(m.thinking)) return m;
      const thinking = levelsBySelector.get(m.selector)
        ?? levelsBySelector.get(`${m.provider}/${m.id}`);
      return thinking ? { ...m, thinking } : m;
    });
  } catch {
    return models;
  }
}
