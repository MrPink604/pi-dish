import crypto = require('node:crypto');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { RequestHandler } from 'express';
import yaml = require('yaml');
import { dishDir } from './dish-store';
import { getHarness } from './harnesses';
import { harnessLaunchSpec } from './harness-launch-spec';
import { harnessCommandAvailable } from './harness-feature-commands';
import { record as isRecord } from './helper-values';
import { errorMessage, requestBody } from './http-boundary';

type Handler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;

const SHA_RE = /^[0-9a-f]{40}$/;
const MAX_ENTRIES = 200;
const MAX_ENTRY_LENGTH = 500;
const MAX_QUERY_LENGTH = 200;
const DEFAULT_PREVIEW_LIMIT = 50;
const MAX_PREVIEW_LIMIT = 100;
const MAX_PREVIEW_CONCURRENCY = 2;
const MAX_HELPER_BUFFER = 4 * 1024 * 1024;
const MAX_PREVIEW_LINE_BUFFER = 4 * 1024 * 1024;
const MAX_PREVIEW_STDERR = 64 * 1024;
const SIGKILL_GRACE_MS = 500;

export const DEFAULT_GET_TIMEOUT_MS = 60_000;
export const DEFAULT_DRY_RUN_TIMEOUT_MS = 360_000;
export const DEFAULT_APPLY_TIMEOUT_MS = 420_000;
export const DEFAULT_PREVIEW_TIMEOUT_MS = 15_000;
const HTTP_SET_SOCKET_TIMEOUT_MS = 450_000;

export interface OmpPreviewModel {
  provider: string;
  id: string;
  name: string;
  selector: string;
  current?: boolean;
}

export interface OmpModelsPreviewResult {
  total: number;
  truncated: boolean;
  startupModel: OmpPreviewModel | null;
  models: OmpPreviewModel[];
}

export interface OmpModelsHttpReply {
  status: number;
  body: Record<string, unknown>;
}

export interface OmpModelsServiceOptions {
  /** Override the `fleet` helper path (defaults to `~/.local/bin/fleet`). */
  fleetBin?: string;
  /** Override the state/tmp root for mode-0600 temp files (defaults to `~/.pi/dish/tmp`). */
  tmpDir?: string;
  /** Override helper timeouts (ms). */
  getTimeoutMs?: number;
  dryRunTimeoutMs?: number;
  applyTimeoutMs?: number;
  /** Override `omp --mode rpc` preview timeout (ms). */
  previewTimeoutMs?: number;
  /** Override max concurrent `omp --mode rpc` preview children. */
  maxPreviewConcurrency?: number;
}

export interface OmpModelsService {
  available(): boolean;
  get(signal?: AbortSignal): Promise<OmpModelsHttpReply>;
  preview(input: { enabledModels: string[]; query?: string; limit?: number }, signal?: AbortSignal): Promise<OmpModelsHttpReply>;
  dryRun(input: { base: string; enabledModels: string[] }, signal?: AbortSignal): Promise<OmpModelsHttpReply>;
  apply(input: { base: string; enabledModels: string[] }, signal?: AbortSignal): Promise<OmpModelsHttpReply>;
  dispose(): void;
}

export interface OmpModelsHandlers {
  available(): boolean;
  get: Handler;
  preview: Handler;
  dryRun: Handler;
  apply: Handler;
  dispose(): void;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function lastLine(raw: string): string {
  const lines = raw.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return (lines[lines.length - 1] || '').slice(0, 300);
}

function envTimeout(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 50 ? parsed : fallback;
}

function resolveFleetBin(override?: string): string {
  if (override) return override;
  const fromEnv = (process.env.PI_DISH_FLEET_BIN || '').trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), '.local', 'bin', 'fleet');
}

function resolveTmpDir(override?: string): string {
  return override || path.join(dishDir(), 'tmp');
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function unavailableReply(): OmpModelsHttpReply {
  return {
    status: 501,
    body: {
      available: false,
      error: 'unavailable',
      message: 'OMP model allow-list management is unavailable on this host.',
    },
  };
}

function killChildReliably(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.stdin?.end(); } catch {}
  try { child.kill('SIGTERM'); } catch {}
  const escalate = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch {}
    }
  }, SIGKILL_GRACE_MS);
  escalate.unref();
  child.once('exit', () => clearTimeout(escalate));
  child.once('close', () => clearTimeout(escalate));
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry): entry is string => typeof entry === 'string')) return null;
  return [...value];
}

function normalizeHostsRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(value)) return result;
  for (const [host, status] of Object.entries(value)) {
    if (typeof status === 'string') result[host] = status;
  }
  return result;
}

function parsePreviewModel(value: unknown): OmpPreviewModel | null {
  if (!isRecord(value)) return null;
  const provider = text(value.provider).trim();
  const id = text(value.id).trim();
  if (!provider || !id) return null;
  const name = text(value.name).trim() || id;
  const model: OmpPreviewModel = {
    provider,
    id,
    name,
    selector: `${provider}/${id}`,
  };
  if (value.current === true) model.current = true;
  return model;
}

function validateEnabledModelsInput(value: unknown): { entries: string[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'enabledModels must be an array of pattern strings' };
  if (value.length > MAX_ENTRIES) return { error: `enabledModels may contain at most ${MAX_ENTRIES} entries` };
  const entries: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== 'string') return { error: `enabledModels[${i}] must be a string` };
    if (item.length > MAX_ENTRY_LENGTH) return { error: `enabledModels[${i}] exceeds ${MAX_ENTRY_LENGTH} characters` };
    entries.push(item);
  }
  return { entries };
}

function validateBaseSha(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return SHA_RE.test(trimmed) ? trimmed : null;
}

export function createOmpModelsService(options: OmpModelsServiceOptions = {}): OmpModelsService {
  const activeChildren = new Set<ChildProcess>();
  const maxConcurrency = Math.max(1, options.maxPreviewConcurrency ?? MAX_PREVIEW_CONCURRENCY);
  let runningPreviews = 0;
  const previewWaiters: { resume(): void; cancel(): void }[] = [];

  function fleetBin(): string {
    return resolveFleetBin(options.fleetBin);
  }

  function available(): boolean {
    return isExecutable(fleetBin());
  }

  async function withTempFile<T>(prefix: string, suffix: string, content: string, run: (filePath: string) => Promise<T>): Promise<T> {
    const dir = resolveTmpDir(options.tmpDir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${prefix}-${process.pid}-${crypto.randomUUID()}${suffix}`);
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, content, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    try {
      return await run(file);
    } finally {
      try { fs.unlinkSync(file); } catch {}
    }
  }

  interface HelperExecResult {
    kind: 'exited' | 'timeout' | 'unavailable' | 'aborted' | 'spawn_error';
    exitCode: number | null;
    stdout: string;
    stderr: string;
    message?: string;
  }

  function runFleetHelper(args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<HelperExecResult> {
    const bin = fleetBin();
    if (!isExecutable(bin)) {
      return Promise.resolve({ kind: 'unavailable', exitCode: null, stdout: '', stderr: '' });
    }
    if (signal?.aborted) {
      return Promise.resolve({ kind: 'aborted', exitCode: null, stdout: '', stderr: '' });
    }
    return new Promise<HelperExecResult>(resolve => {
      let settled = false;
      let timedOut = false;
      let aborted = false;
      const done = (result: HelperExecResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      // Run with an empty environment and an argv array — never a shell.
      const child = execFile(bin, ['omp-models', ...args], {
        env: {},
        maxBuffer: MAX_HELPER_BUFFER,
        encoding: 'utf8',
      }, (error, stdout, stderr) => {
        activeChildren.delete(child);
        const out = typeof stdout === 'string' ? stdout : String(stdout || '');
        const err = typeof stderr === 'string' ? stderr : String(stderr || '');
        if (aborted) return done({ kind: 'aborted', exitCode: null, stdout: out, stderr: err });
        if (timedOut) return done({ kind: 'timeout', exitCode: null, stdout: out, stderr: err });
        if (!error) return done({ kind: 'exited', exitCode: 0, stdout: out, stderr: err });
        const errCode = (error as NodeJS.ErrnoException & { code?: number | string }).code;
        if (errCode === 'ENOENT' || errCode === 'EACCES') {
          return done({ kind: 'unavailable', exitCode: null, stdout: out, stderr: err });
        }
        if (typeof errCode === 'number') {
          return done({ kind: 'exited', exitCode: errCode, stdout: out, stderr: err });
        }
        if (typeof child.exitCode === 'number') {
          return done({ kind: 'exited', exitCode: child.exitCode, stdout: out, stderr: err });
        }
        return done({ kind: 'spawn_error', exitCode: null, stdout: out, stderr: err, message: error.message });
      });
      activeChildren.add(child);
      child.stdin?.end();
      const onAbort = () => {
        aborted = true;
        killChildReliably(child);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        killChildReliably(child);
      }, timeoutMs);
      timer.unref();
    });
  }

  function decodeHelperReply(
    mode: 'get' | 'dryRun' | 'apply',
    result: HelperExecResult,
  ): OmpModelsHttpReply {
    if (result.kind === 'unavailable') return unavailableReply();
    if (result.kind === 'aborted') {
      return { status: 499, body: { error: 'aborted', message: 'Request aborted.' } };
    }
    if (result.kind === 'timeout') {
      return {
        status: 504,
        body: {
          error: 'timeout',
          retryable: true,
          message: 'fleet omp-models timed out.',
        },
      };
    }
    if (result.kind === 'spawn_error') {
      return {
        status: 502,
        body: {
          error: 'spawn_error',
          message: result.message || lastLine(result.stderr) || 'Failed to run fleet omp-models.',
        },
      };
    }
    const exitCode = result.exitCode;
    const raw = result.stdout.trim();
    if (!raw && exitCode === 127) {
      return unavailableReply();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        status: 502,
        body: {
          error: 'invalid_output',
          exitCode,
          message: 'fleet omp-models returned invalid JSON.',
        },
      };
    }
    if (!isRecord(parsed)) {
      return {
        status: 502,
        body: {
          error: 'invalid_output',
          exitCode,
          message: 'fleet omp-models returned a non-object JSON payload.',
        },
      };
    }
    if (exitCode === 0) {
      if (mode === 'get') {
        const sha = text(parsed.sha);
        const enabledModels = normalizeStringArray(parsed.enabledModels);
        const disabledProviders = normalizeStringArray(parsed.disabledProviders);
        if (!sha || !enabledModels || !disabledProviders) {
          return {
            status: 502,
            body: {
              error: 'invalid_output',
              exitCode: 0,
              message: 'fleet omp-models get output is missing sha, enabledModels, or disabledProviders.',
            },
          };
        }
        return {
          status: 200,
          body: { available: true, sha, enabledModels, disabledProviders },
        };
      }
      if (mode === 'dryRun') {
        return {
          status: 200,
          body: {
            dryRun: true,
            sha: text(parsed.sha),
            changed: parsed.changed === true,
            diff: text(parsed.diff),
          },
        };
      }
      const unchanged = parsed.unchanged === true;
      return {
        status: 200,
        body: {
          sha: text(parsed.sha),
          unchanged,
          hosts: normalizeHostsRecord(parsed.hosts),
          allHostsFailed: false,
          restartRequired: !unchanged,
        },
      };
    }
    if (exitCode === 1) {
      const code = text(parsed.error) || 'operational';
      const message = text(parsed.message) || lastLine(result.stderr) || 'fleet omp-models operational error.';
      if (code === 'locked') {
        return {
          status: 423,
          body: { error: 'locked', retryable: true, exitCode: 1, message },
        };
      }
      return {
        status: 502,
        body: { error: code, exitCode: 1, message },
      };
    }
    if (exitCode === 2) {
      const reasons = normalizeStringArray(parsed.reasons) || [];
      return {
        status: 422,
        body: {
          error: 'policy',
          reasons,
          exitCode: 2,
          message: text(parsed.message) || 'Policy rejected the candidate allow-list.',
        },
      };
    }
    if (exitCode === 3) {
      return {
        status: 409,
        body: {
          error: 'conflict',
          sha: text(parsed.sha) || null,
          exitCode: 3,
          message: text(parsed.message) || 'The allow-list changed elsewhere.',
        },
      };
    }
    if (exitCode === 4) {
      return {
        status: 502,
        body: {
          error: 'all_hosts_failed',
          committed: true,
          allHostsFailed: true,
          exitCode: 4,
          sha: text(parsed.sha),
          hosts: normalizeHostsRecord(parsed.hosts),
          message: 'Committed to fleet-config, but deployment failed on every host.',
        },
      };
    }
    if (exitCode === 64) {
      return {
        status: 400,
        body: {
          error: 'usage',
          exitCode: 64,
          message: text(parsed.message) || 'Invalid fleet omp-models arguments.',
        },
      };
    }
    return {
      status: 502,
      body: {
        error: text(parsed.error) || 'helper_error',
        exitCode,
        message: text(parsed.message) || `fleet omp-models exited with code ${String(exitCode)}.`,
      },
    };
  }

  async function acquirePreviewSlot(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    if (runningPreviews < maxConcurrency) {
      runningPreviews++;
      return true;
    }
    return new Promise<boolean>(resolve => {
      let done = false;
      const waiter = {
        resume() {
          if (done) return;
          done = true;
          signal?.removeEventListener('abort', onAbort);
          runningPreviews++;
          resolve(true);
        },
        cancel() {
          if (done) return;
          done = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(false);
        },
      };
      const onAbort = () => {
        const idx = previewWaiters.indexOf(waiter);
        if (idx >= 0) previewWaiters.splice(idx, 1);
        waiter.cancel();
      };
      previewWaiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function releasePreviewSlot(): void {
    runningPreviews = Math.max(0, runningPreviews - 1);
    while (runningPreviews < maxConcurrency && previewWaiters.length > 0) {
      const next = previewWaiters.shift()!;
      next.resume();
    }
  }

  async function runOmpPreview(
    enabledModels: string[],
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<OmpModelsHttpReply> {
    if (!available()) return unavailableReply();
    if (enabledModels.length === 0) {
      return {
        status: 200,
        body: { total: 0, truncated: false, startupModel: null, models: [] },
      };
    }
    const descriptor = getHarness('omp');
    if (!descriptor || !harnessCommandAvailable(descriptor)) {
      return {
        status: 503,
        body: { error: 'omp_unavailable', message: 'omp is not installed on this host.' },
      };
    }
    const acquired = await acquirePreviewSlot(signal);
    if (!acquired) {
      return { status: 499, body: { error: 'aborted', message: 'Preview aborted.' } };
    }
    try {
      const spec = harnessLaunchSpec(descriptor);
      const env: NodeJS.ProcessEnv = { ...process.env, ...spec.env, OMP_SKIP_SETUP: '1' };
      const timeoutMs = options.previewTimeoutMs ?? envTimeout('PI_DISH_OMP_MODELS_PREVIEW_TIMEOUT_MS', DEFAULT_PREVIEW_TIMEOUT_MS);
      const overlayYaml = yaml.stringify({ enabledModels });
      return await withTempFile('omp-models-preview', '.yml', overlayYaml, overlayPath => new Promise<OmpModelsHttpReply>(resolve => {
        let settled = false;
        let timedOut = false;
        let aborted = false;
        let sent = false;
        let stdoutBuf = '';
        let stderrBuf = '';
        let stateReply: Record<string, unknown> | null = null;
        let pickerReply: Record<string, unknown> | null = null;

        const finish = (reply: OmpModelsHttpReply) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          killChildReliably(child);
          resolve(reply);
        };

        const child = spawn(spec.argv[0], [
          ...spec.argv.slice(1),
          '--mode', 'rpc',
          '--no-session',
          '--no-extensions',
          '--no-lsp',
          '--config', overlayPath,
        ], {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        activeChildren.add(child);

        const onAbort = () => {
          aborted = true;
          finish({ status: 499, body: { error: 'aborted', message: 'Preview aborted.' } });
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        const timer = setTimeout(() => {
          timedOut = true;
          finish({ status: 504, body: { error: 'timeout', retryable: true, message: 'OMP model preview timed out.' } });
        }, timeoutMs);
        timer.unref();

        const tryComplete = () => {
          if (!stateReply || !pickerReply) return;
          if (pickerReply.success === false) {
            finish({
              status: 502,
              body: { error: 'preview_failed', message: text(pickerReply.error) || 'OMP get_model_picker failed.' },
            });
            return;
          }
          const stateData = isRecord(stateReply.data) ? stateReply.data : {};
          const startupModel = stateReply.success !== false ? parsePreviewModel(stateData.model) : null;
          const pickerData = isRecord(pickerReply.data) ? pickerReply.data : {};
          const rawRows = Array.isArray(pickerData.rows) ? pickerData.rows : [];
          const models = rawRows.map(parsePreviewModel).filter((row): row is OmpPreviewModel => row !== null);
          const total = typeof pickerData.total === 'number' && Number.isFinite(pickerData.total) && pickerData.total >= 0
            ? Math.round(pickerData.total)
            : models.length;
          finish({
            status: 200,
            body: {
              total,
              truncated: total > models.length,
              startupModel,
              models,
            },
          });
        };

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          if (settled) return;
          stdoutBuf += chunk;
          let newline = stdoutBuf.indexOf('\n');
          while (newline >= 0) {
            const line = stdoutBuf.slice(0, newline).trim();
            stdoutBuf = stdoutBuf.slice(newline + 1);
            newline = stdoutBuf.indexOf('\n');
            if (!line) continue;
            let message: unknown;
            try { message = JSON.parse(line); } catch { continue; }
            if (!isRecord(message)) continue;
            if (message.type === 'ready' && !sent) {
              sent = true;
              try {
                child.stdin.write(JSON.stringify({ id: 'state', type: 'get_state' }) + '\n');
                child.stdin.write(JSON.stringify({ id: 'picker', type: 'get_model_picker', query, limit }) + '\n');
              } catch (writeError) {
                finish({ status: 502, body: { error: 'preview_failed', message: errorMessage(writeError) } });
                return;
              }
            } else if (message.type === 'response') {
              if (message.id === 'state') stateReply = message;
              else if (message.id === 'picker') pickerReply = message;
              tryComplete();
            }
          }
          if (stdoutBuf.length > MAX_PREVIEW_LINE_BUFFER) {
            finish({ status: 502, body: { error: 'preview_failed', message: 'OMP preview exceeded output limit.' } });
          }
        });

        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          if (stderrBuf.length < MAX_PREVIEW_STDERR) {
            stderrBuf += chunk.slice(0, MAX_PREVIEW_STDERR - stderrBuf.length);
          }
        });

        child.on('error', (error: Error) => {
          activeChildren.delete(child);
          finish({ status: 502, body: { error: 'preview_failed', message: error.message } });
        });

        child.on('close', (code, sig) => {
          activeChildren.delete(child);
          if (settled) return;
          if (aborted) {
            finish({ status: 499, body: { error: 'aborted', message: 'Preview aborted.' } });
            return;
          }
          if (timedOut) {
            finish({ status: 504, body: { error: 'timeout', retryable: true, message: 'OMP model preview timed out.' } });
            return;
          }
          // When no configured model matches the candidate enabledModels overlay,
          // omp exits 1 with a clear stderr message before emitting ready.
          if (/No model available matching enabledModels/i.test(stderrBuf)) {
            finish({
              status: 200,
              body: { total: 0, truncated: false, startupModel: null, models: [] },
            });
            return;
          }
          finish({
            status: 502,
            body: {
              error: 'preview_failed',
              message: lastLine(stderrBuf) || `OMP preview exited (${code ?? sig ?? 'unknown'}).`,
            },
          });
        });
      }));
    } finally {
      releasePreviewSlot();
    }
  }

  return {
    available,
    async get(signal) {
      const timeoutMs = options.getTimeoutMs ?? envTimeout('PI_DISH_OMP_MODELS_TIMEOUT_MS', DEFAULT_GET_TIMEOUT_MS);
      const result = await runFleetHelper(['get', '--json'], timeoutMs, signal);
      return decodeHelperReply('get', result);
    },
    preview({ enabledModels, query = '', limit = DEFAULT_PREVIEW_LIMIT }, signal) {
      const clampedLimit = Math.min(MAX_PREVIEW_LIMIT, Math.max(1, Math.round(limit)));
      return runOmpPreview(enabledModels, query, clampedLimit, signal);
    },
    async dryRun({ base, enabledModels }, signal) {
      if (!available()) return unavailableReply();
      const timeoutMs = options.dryRunTimeoutMs ?? envTimeout('PI_DISH_OMP_MODELS_TIMEOUT_MS', DEFAULT_DRY_RUN_TIMEOUT_MS);
      return withTempFile('omp-models-list', '.json', JSON.stringify(enabledModels), async filePath => {
        const result = await runFleetHelper(['set', '--base', base, '--file', filePath, '--dry-run'], timeoutMs, signal);
        return decodeHelperReply('dryRun', result);
      });
    },
    async apply({ base, enabledModels }, signal) {
      if (!available()) return unavailableReply();
      const timeoutMs = options.applyTimeoutMs ?? envTimeout('PI_DISH_OMP_MODELS_TIMEOUT_MS', DEFAULT_APPLY_TIMEOUT_MS);
      return withTempFile('omp-models-list', '.json', JSON.stringify(enabledModels), async filePath => {
        const result = await runFleetHelper(['set', '--base', base, '--file', filePath], timeoutMs, signal);
        return decodeHelperReply('apply', result);
      });
    },
    dispose() {
      for (const waiter of previewWaiters.splice(0)) waiter.cancel();
      for (const child of [...activeChildren]) killChildReliably(child);
      activeChildren.clear();
    },
  };
}

export function createOmpModelsHandlers(service: OmpModelsService = createOmpModelsService()): OmpModelsHandlers {
  function attachAbort(res: Parameters<Handler>[1]): AbortController {
    const controller = new AbortController();
    res.once('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    return controller;
  }

  function sendReply(res: Parameters<Handler>[1], reply: OmpModelsHttpReply): void {
    if (res.destroyed || res.writableEnded) return;
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(reply.status).json(reply.body);
  }

  const get: Handler = async (_req, res) => {
    const abort = attachAbort(res);
    try {
      sendReply(res, await service.get(abort.signal));
    } catch (error) {
      sendReply(res, { status: 500, body: { error: 'internal', message: errorMessage(error) } });
    }
  };

  const preview: Handler = async (req, res) => {
    const body = requestBody(req);
    const validated = validateEnabledModelsInput(body.enabledModels);
    if ('error' in validated) return sendReply(res, { status: 400, body: { error: validated.error } });
    const query = body.query === undefined ? '' : body.query;
    if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH) {
      return sendReply(res, { status: 400, body: { error: `query must be a string of at most ${MAX_QUERY_LENGTH} characters` } });
    }
    const rawLimit = body.limit === undefined ? DEFAULT_PREVIEW_LIMIT : body.limit;
    if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit) || rawLimit < 1) {
      return sendReply(res, { status: 400, body: { error: 'limit must be a positive number' } });
    }
    const abort = attachAbort(res);
    try {
      sendReply(res, await service.preview({ enabledModels: validated.entries, query, limit: rawLimit }, abort.signal));
    } catch (error) {
      sendReply(res, { status: 500, body: { error: 'internal', message: errorMessage(error) } });
    }
  };

  const dryRun: Handler = async (req, res) => {
    req.setTimeout(HTTP_SET_SOCKET_TIMEOUT_MS);
    res.setTimeout(HTTP_SET_SOCKET_TIMEOUT_MS);
    const body = requestBody(req);
    const base = validateBaseSha(body.base);
    if (!base) return sendReply(res, { status: 400, body: { error: 'base must be a 40-character hexadecimal git commit SHA' } });
    const validated = validateEnabledModelsInput(body.enabledModels);
    if ('error' in validated) return sendReply(res, { status: 400, body: { error: validated.error } });
    const abort = attachAbort(res);
    try {
      sendReply(res, await service.dryRun({ base, enabledModels: validated.entries }, abort.signal));
    } catch (error) {
      sendReply(res, { status: 500, body: { error: 'internal', message: errorMessage(error) } });
    }
  };

  const apply: Handler = async (req, res) => {
    req.setTimeout(HTTP_SET_SOCKET_TIMEOUT_MS);
    res.setTimeout(HTTP_SET_SOCKET_TIMEOUT_MS);
    const body = requestBody(req);
    const base = validateBaseSha(body.base);
    if (!base) return sendReply(res, { status: 400, body: { error: 'base must be a 40-character hexadecimal git commit SHA' } });
    const validated = validateEnabledModelsInput(body.enabledModels);
    if ('error' in validated) return sendReply(res, { status: 400, body: { error: validated.error } });
    // Apply must not abort the helper once committed/deploying just because a mobile client blips;
    // wait for the helper (or its timeout) so deploys finish cleanly.
    try {
      sendReply(res, await service.apply({ base, enabledModels: validated.entries }));
    } catch (error) {
      sendReply(res, { status: 500, body: { error: 'internal', message: errorMessage(error) } });
    }
  };

  return {
    available: () => service.available(),
    get,
    preview,
    dryRun,
    apply,
    dispose: () => service.dispose(),
  };
}
