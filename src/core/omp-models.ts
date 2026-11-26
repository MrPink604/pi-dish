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
const DEFAULT_MAX_PREVIEW_CONCURRENCY = 2;
const DEFAULT_MAX_PREVIEW_QUEUE = 4;
const DEFAULT_MAX_HELPER_CONCURRENCY = 2;
const MAX_HELPER_BUFFER = 4 * 1024 * 1024;
const MAX_PREVIEW_LINE_BUFFER = 4 * 1024 * 1024;
const MAX_PREVIEW_STDERR = 64 * 1024;
const SIGKILL_GRACE_MS = 500;

export const DEFAULT_GET_TIMEOUT_MS = 60_000;
export const DEFAULT_DRY_RUN_TIMEOUT_MS = 360_000;
export const DEFAULT_PREVIEW_TIMEOUT_MS = 15_000;
export const DEFAULT_APPLY_WAIT_MS = 1_500;
const HTTP_DRY_RUN_SOCKET_TIMEOUT_MS = 450_000;
const UNKNOWN_APPLY_OUTCOME_MESSAGE = 'Unknown outcome: reload the list and check the fleet-config log.';

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

export type OmpModelsApplyStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'running'; readonly startedAt: number; readonly base: string }
  | {
      readonly state: 'done';
      readonly startedAt: number;
      readonly finishedAt: number;
      readonly base: string;
      readonly result: OmpModelsHttpReply;
    };

export interface OmpModelsServiceOptions {
  /** Override the `fleet` helper path (defaults to `~/.local/bin/fleet`). */
  fleetBin?: string;
  /** Override the state/tmp root for mode-0600 temp files (defaults to `~/.pi/dish/tmp`). */
  tmpDir?: string;
  /** Override helper timeouts (ms) for read/dry-run only; running applies are never killed on deadline. */
  getTimeoutMs?: number;
  dryRunTimeoutMs?: number;
  /** How long POST /apply waits for completion before returning 202 {state:"running"} (ms). */
  applyWaitMs?: number;
  /** Override `omp --mode rpc` preview timeout (ms). */
  previewTimeoutMs?: number;
  /** Override process bounds (defaults: 2 preview running, 4 preview queued, 2 get/dryRun running). */
  maxPreviewConcurrency?: number;
  maxPreviewQueue?: number;
  maxHelperConcurrency?: number;
}

export interface OmpModelsService {
  available(): boolean;
  get(signal?: AbortSignal): Promise<OmpModelsHttpReply>;
  preview(input: { enabledModels: string[]; query?: string; limit?: number }, signal?: AbortSignal): Promise<OmpModelsHttpReply>;
  dryRun(input: { base: string; enabledModels: string[] }, signal?: AbortSignal): Promise<OmpModelsHttpReply>;
  apply(input: { base: string; enabledModels: string[] }): Promise<OmpModelsHttpReply>;
  applyStatus(): OmpModelsHttpReply;
  dispose(): void;
}

export interface OmpModelsHandlers {
  available(): boolean;
  get: Handler;
  preview: Handler;
  dryRun: Handler;
  apply: Handler;
  applyStatus: Handler;
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
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

/** Minimal trusted environment for `fleet omp-models` so git resolves user identity and tools while excluding all ambient/override vars. */
export function minimalFleetHelperEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  return {
    HOME: home,
    PATH: `${path.join(home, '.local', 'bin')}:/usr/local/bin:/usr/bin:/bin`,
    LANG: 'C.UTF-8',
  };
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

function unknownApplyOutcomeReply(errorCode: 'unknown_outcome' | 'invalid_output', exitCode: number | null): OmpModelsHttpReply {
  return {
    status: 502,
    body: {
      error: errorCode,
      unknownOutcome: true,
      retryable: false,
      exitCode,
      message: UNKNOWN_APPLY_OUTCOME_MESSAGE,
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

function validateHostsRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string> = {};
  for (const [host, status] of Object.entries(value)) {
    if (typeof status !== 'string') return null;
    result[host] = status;
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
  const activeTransientChildren = new Set<ChildProcess>();
  const maxPreviewConcurrency = Math.max(1, options.maxPreviewConcurrency ?? DEFAULT_MAX_PREVIEW_CONCURRENCY);
  const maxPreviewQueue = Math.max(0, options.maxPreviewQueue ?? DEFAULT_MAX_PREVIEW_QUEUE);
  const maxHelperConcurrency = Math.max(1, options.maxHelperConcurrency ?? DEFAULT_MAX_HELPER_CONCURRENCY);

  let runningPreviews = 0;
  const previewWaiters: { resume(): void; cancel(): void }[] = [];
  let runningHelpers = 0;
  let applyState: OmpModelsApplyStatus = { state: 'idle' };

  function fleetBin(): string {
    return resolveFleetBin(options.fleetBin);
  }

  function available(): boolean {
    return isExecutable(fleetBin());
  }

  /** Creates a mode-0600 temp file under pi-dish's tmp dir and guarantees unlink across the entire lifetime (write failures included). */
  async function withTempFile<T>(prefix: string, suffix: string, content: string, run: (filePath: string) => Promise<T>): Promise<T> {
    const dir = resolveTmpDir(options.tmpDir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${prefix}-${process.pid}-${crypto.randomUUID()}${suffix}`);
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      try {
        fs.writeFileSync(fd, content, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
      return await run(file);
    } finally {
      try { fs.unlinkSync(file); } catch {}
    }
  }

  interface HelperExecResult {
    kind: 'exited' | 'timeout' | 'unavailable' | 'aborted' | 'spawn_error' | 'killed';
    exitCode: number | null;
    stdout: string;
    stderr: string;
    message?: string;
  }

  function runFleetHelper(
    args: readonly string[],
    { timeoutMs, signal, trackTransient, onClose }: {
      timeoutMs: number | null;
      signal?: AbortSignal;
      trackTransient: boolean;
      onClose?: () => void;
    },
  ): Promise<HelperExecResult> {
    const bin = fleetBin();
    if (!isExecutable(bin)) {
      onClose?.();
      return Promise.resolve({ kind: 'unavailable', exitCode: null, stdout: '', stderr: '' });
    }
    if (signal?.aborted) {
      onClose?.();
      return Promise.resolve({ kind: 'aborted', exitCode: null, stdout: '', stderr: '' });
    }
    return new Promise<HelperExecResult>(resolve => {
      let settled = false;
      let closed = false;
      let timedOut = false;
      let aborted = false;
      const markClosed = () => {
        if (closed) return;
        closed = true;
        onClose?.();
      };
      const done = (result: HelperExecResult) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      // Minimal trusted env and argv array — never a shell.
      const child = execFile(bin, ['omp-models', ...args], {
        env: minimalFleetHelperEnv(),
        maxBuffer: MAX_HELPER_BUFFER,
        encoding: 'utf8',
      }, (error, stdout, stderr) => {
        if (trackTransient) activeTransientChildren.delete(child);
        markClosed();
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
        if (child.signalCode) {
          return done({ kind: 'killed', exitCode: null, stdout: out, stderr: err, message: `terminated by ${child.signalCode}` });
        }
        return done({ kind: 'spawn_error', exitCode: null, stdout: out, stderr: err, message: error.message });
      });
      if (trackTransient) activeTransientChildren.add(child);
      child.once('close', markClosed);
      child.stdin?.on('error', () => {});
      child.stdin?.end();
      const onAbort = () => {
        aborted = true;
        killChildReliably(child);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = timeoutMs !== null ? setTimeout(() => {
        timedOut = true;
        killChildReliably(child);
      }, timeoutMs) : null;
      timer?.unref();
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
          retryable: mode !== 'apply',
          message: 'fleet omp-models timed out.',
        },
      };
    }
    if (result.kind === 'killed' || result.kind === 'spawn_error') {
      if (mode === 'apply') {
        return unknownApplyOutcomeReply('unknown_outcome', result.exitCode);
      }
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
      if (mode === 'apply') {
        return unknownApplyOutcomeReply('unknown_outcome', exitCode);
      }
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
      if (mode === 'apply') {
        return unknownApplyOutcomeReply('invalid_output', exitCode);
      }
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
        if (!SHA_RE.test(sha) || !enabledModels || !disabledProviders) {
          return {
            status: 502,
            body: {
              error: 'invalid_output',
              exitCode: 0,
              message: 'fleet omp-models get output is missing valid sha, enabledModels, or disabledProviders.',
            },
          };
        }
        return {
          status: 200,
          body: { available: true, sha, enabledModels, disabledProviders },
        };
      }
      if (mode === 'dryRun') {
        const sha = text(parsed.sha);
        if (!SHA_RE.test(sha) || typeof parsed.changed !== 'boolean') {
          return {
            status: 502,
            body: {
              error: 'invalid_output',
              exitCode: 0,
              message: 'fleet omp-models dry-run output is missing valid sha or changed flag.',
            },
          };
        }
        const diff = parsed.diff;
        if (parsed.changed) {
          if (typeof diff !== 'string' || !diff.length) {
            return {
              status: 502,
              body: {
                error: 'invalid_output',
                exitCode: 0,
                message: 'fleet omp-models dry-run output reported changes without a diff.',
              },
            };
          }
        } else if (diff !== undefined && typeof diff !== 'string') {
          return {
            status: 502,
            body: {
              error: 'invalid_output',
              exitCode: 0,
              message: 'fleet omp-models dry-run diff must be a string.',
            },
          };
        }
        return {
          status: 200,
          body: {
            dryRun: true,
            sha,
            changed: parsed.changed,
            diff: typeof diff === 'string' ? diff : '',
          },
        };
      }
      // mode === 'apply': requires valid sha and either unchanged:true or a valid hosts record.
      const sha = text(parsed.sha);
      if (!SHA_RE.test(sha)) {
        return unknownApplyOutcomeReply('invalid_output', 0);
      }
      if (parsed.unchanged === true) {
        const hosts = parsed.hosts === undefined ? {} : validateHostsRecord(parsed.hosts);
        if (hosts === null) return unknownApplyOutcomeReply('invalid_output', 0);
        return {
          status: 200,
          body: {
            sha,
            unchanged: true,
            hosts,
            allHostsFailed: false,
            restartRequired: false,
          },
        };
      }
      if (parsed.unchanged !== undefined && parsed.unchanged !== false) {
        return unknownApplyOutcomeReply('invalid_output', 0);
      }
      const hosts = validateHostsRecord(parsed.hosts);
      if (hosts === null) {
        return unknownApplyOutcomeReply('invalid_output', 0);
      }
      return {
        status: 200,
        body: {
          sha,
          unchanged: false,
          hosts,
          allHostsFailed: false,
          restartRequired: true,
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
        body: { error: code, retryable: false, exitCode: 1, message },
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
      const sha = text(parsed.sha);
      return {
        status: 409,
        body: {
          error: 'conflict',
          sha: SHA_RE.test(sha) ? sha : null,
          exitCode: 3,
          message: text(parsed.message) || 'The allow-list changed elsewhere.',
        },
      };
    }
    if (exitCode === 4) {
      const sha = text(parsed.sha);
      const hosts = validateHostsRecord(parsed.hosts);
      if (!SHA_RE.test(sha) || hosts === null) {
        return unknownApplyOutcomeReply('invalid_output', 4);
      }
      return {
        status: 502,
        body: {
          error: 'all_hosts_failed',
          committed: true,
          allHostsFailed: true,
          retryable: false,
          exitCode: 4,
          sha,
          hosts,
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
    if (mode === 'apply') {
      return unknownApplyOutcomeReply('unknown_outcome', exitCode);
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

  function acquireHelperSlot(): (() => void) | null {
    if (runningHelpers >= maxHelperConcurrency) return null;
    runningHelpers++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      runningHelpers = Math.max(0, runningHelpers - 1);
    };
  }

  async function acquirePreviewSlot(signal?: AbortSignal): Promise<'acquired' | 'aborted' | 'full'> {
    if (signal?.aborted) return 'aborted';
    if (runningPreviews < maxPreviewConcurrency) {
      runningPreviews++;
      return 'acquired';
    }
    if (previewWaiters.length >= maxPreviewQueue) return 'full';
    return new Promise<'acquired' | 'aborted'>(resolve => {
      let done = false;
      const waiter = {
        resume() {
          if (done) return;
          done = true;
          signal?.removeEventListener('abort', onAbort);
          runningPreviews++;
          resolve('acquired');
        },
        cancel() {
          if (done) return;
          done = true;
          signal?.removeEventListener('abort', onAbort);
          resolve('aborted');
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
    while (runningPreviews < maxPreviewConcurrency && previewWaiters.length > 0) {
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
    const slot = await acquirePreviewSlot(signal);
    if (slot === 'full') {
      return {
        status: 429,
        body: { error: 'too_many_requests', retryable: true, message: 'Too many model preview requests in flight; try again shortly.' },
      };
    }
    if (slot === 'aborted') {
      return { status: 499, body: { error: 'aborted', message: 'Preview aborted.' } };
    }
    let slotReleased = false;
    const releaseSlotOnce = () => {
      if (slotReleased) return;
      slotReleased = true;
      releasePreviewSlot();
    };
    let childSpawned = false;
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
          '--no-tools',
          '--config', overlayPath,
        ], {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        childSpawned = true;
        activeTransientChildren.add(child);

        // Attach stdin error handler before any writes so EPIPE settles only this preview.
        child.stdin.on('error', (stdinError: Error) => {
          finish({ status: 502, body: { error: 'preview_failed', message: `OMP preview stdin error: ${stdinError.message}` } });
        });

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
          activeTransientChildren.delete(child);
          if (child.pid === undefined) releaseSlotOnce();
          finish({ status: 502, body: { error: 'preview_failed', message: error.message } });
        });

        // Hold the concurrency slot until the OS process actually closes.
        child.on('close', (code, sig) => {
          activeTransientChildren.delete(child);
          releaseSlotOnce();
          if (settled) return;
          if (aborted) {
            finish({ status: 499, body: { error: 'aborted', message: 'Preview aborted.' } });
            return;
          }
          if (timedOut) {
            finish({ status: 504, body: { error: 'timeout', retryable: true, message: 'OMP model preview timed out.' } });
            return;
          }
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
    } catch (error) {
      if (!childSpawned) releaseSlotOnce();
      throw error;
    }
  }

  return {
    available,
    async get(signal) {
      if (!available()) return unavailableReply();
      const release = acquireHelperSlot();
      if (!release) {
        return {
          status: 429,
          body: { error: 'too_many_requests', retryable: true, message: 'Too many fleet helper requests in flight; try again shortly.' },
        };
      }
      const timeoutMs = options.getTimeoutMs ?? envTimeout('PI_DISH_OMP_MODELS_TIMEOUT_MS', DEFAULT_GET_TIMEOUT_MS);
      try {
        const result = await runFleetHelper(['get', '--json'], {
          timeoutMs,
          signal,
          trackTransient: true,
          onClose: release,
        });
        return decodeHelperReply('get', result);
      } catch (error) {
        release();
        throw error;
      }
    },
    preview({ enabledModels, query = '', limit = DEFAULT_PREVIEW_LIMIT }, signal) {
      const clampedLimit = Math.min(MAX_PREVIEW_LIMIT, Math.max(1, Math.round(limit)));
      return runOmpPreview(enabledModels, query, clampedLimit, signal);
    },
    async dryRun({ base, enabledModels }, signal) {
      if (!available()) return unavailableReply();
      const release = acquireHelperSlot();
      if (!release) {
        return {
          status: 429,
          body: { error: 'too_many_requests', retryable: true, message: 'Too many fleet helper requests in flight; try again shortly.' },
        };
      }
      const timeoutMs = options.dryRunTimeoutMs ?? envTimeout('PI_DISH_OMP_MODELS_TIMEOUT_MS', DEFAULT_DRY_RUN_TIMEOUT_MS);
      let helperStarted = false;
      try {
        return await withTempFile('omp-models-list', '.json', JSON.stringify(enabledModels), async filePath => {
          helperStarted = true;
          const result = await runFleetHelper(['set', '--base', base, '--file', filePath, '--dry-run'], {
            timeoutMs,
            signal,
            trackTransient: true,
            onClose: release,
          });
          return decodeHelperReply('dryRun', result);
        });
      } catch (error) {
        if (!helperStarted) release();
        throw error;
      }
    },
    async apply({ base, enabledModels }) {
      if (!available()) return unavailableReply();
      if (applyState.state === 'running') {
        return {
          status: 409,
          body: {
            error: 'apply_in_progress',
            state: 'running',
            startedAt: applyState.startedAt,
            base: applyState.base,
            message: 'Another apply is already in progress.',
          },
        };
      }
      const startedAt = Date.now();
      applyState = { state: 'running', startedAt, base };

      // Single-flight background execution: never kill a running `set` on an HTTP deadline.
      const task = (async (): Promise<OmpModelsHttpReply> => {
        try {
          return await withTempFile('omp-models-list', '.json', JSON.stringify(enabledModels), async filePath => {
            const result = await runFleetHelper(['set', '--base', base, '--file', filePath], {
              timeoutMs: null,
              trackTransient: false,
            });
            return decodeHelperReply('apply', result);
          });
        } catch {
          return unknownApplyOutcomeReply('unknown_outcome', null);
        }
      })().then(reply => {
        applyState = { state: 'done', startedAt, finishedAt: Date.now(), base, result: reply };
        return reply;
      });

      const waitMs = options.applyWaitMs ?? envTimeout('PI_DISH_OMP_MODELS_APPLY_WAIT_MS', DEFAULT_APPLY_WAIT_MS);
      if (waitMs <= 0) {
        return { status: 202, body: { state: 'running', startedAt, base } };
      }
      let waitTimer: NodeJS.Timeout | null = null;
      const settled = await Promise.race([
        task.then(reply => ({ done: true as const, reply })),
        new Promise<{ done: false }>(resolve => {
          waitTimer = setTimeout(() => resolve({ done: false }), waitMs);
          waitTimer.unref();
        }),
      ]);
      if (waitTimer !== null) clearTimeout(waitTimer);
      if (settled.done) return settled.reply;
      return { status: 202, body: { state: 'running', startedAt, base } };
    },
    applyStatus() {
      if (!available()) return unavailableReply();
      if (applyState.state === 'idle') {
        return { status: 200, body: { state: 'idle' } };
      }
      if (applyState.state === 'running') {
        return {
          status: 200,
          body: {
            state: 'running',
            startedAt: applyState.startedAt,
            base: applyState.base,
          },
        };
      }
      return {
        status: 200,
        body: {
          state: 'done',
          startedAt: applyState.startedAt,
          finishedAt: applyState.finishedAt,
          base: applyState.base,
          result: applyState.result,
        },
      };
    },
    dispose() {
      for (const waiter of previewWaiters.splice(0)) waiter.cancel();
      for (const child of [...activeTransientChildren]) killChildReliably(child);
      activeTransientChildren.clear();
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
    req.setTimeout(HTTP_DRY_RUN_SOCKET_TIMEOUT_MS);
    res.setTimeout(HTTP_DRY_RUN_SOCKET_TIMEOUT_MS);
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
    const body = requestBody(req);
    const base = validateBaseSha(body.base);
    if (!base) return sendReply(res, { status: 400, body: { error: 'base must be a 40-character hexadecimal git commit SHA' } });
    const validated = validateEnabledModelsInput(body.enabledModels);
    if ('error' in validated) return sendReply(res, { status: 400, body: { error: validated.error } });
    try {
      sendReply(res, await service.apply({ base, enabledModels: validated.entries }));
    } catch (error) {
      sendReply(res, { status: 500, body: { error: 'internal', message: errorMessage(error) } });
    }
  };

  const applyStatus: Handler = (_req, res) => {
    sendReply(res, service.applyStatus());
  };

  return {
    available: () => service.available(),
    get,
    preview,
    dryRun,
    apply,
    applyStatus,
    dispose: () => service.dispose(),
  };
}
