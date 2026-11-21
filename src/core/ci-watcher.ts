import { record } from './helper-values';
import { CI_RUN_WINDOW, type CiFailureDetails, type CiRun, type GitHubCi } from './github-ci';

const POLL_MS = 150_000;
const DEFAULT_REPO = 'MrPink604/pi-dish';

interface RepoConfig {
  repo: string;
  workflow: string;
  bot: string;
  recovery: boolean;
}
export interface CiConfig { repos: RepoConfig[]; token?: string }

/** Only the named bot host can poll, even if this settings block is copied to peers. */
export function readCiConfig(settings: Record<string, unknown>, hostId: string, envToken?: string): CiConfig | null {
  const config = settings.ciWatcher;
  if (config === undefined || config === false) return null;
  if (!record(config) || typeof config.hostId !== 'string' || !config.hostId.trim()) {
    throw new Error('ciWatcher.hostId must be the bot host’s ID');
  }
  if (settings.bots !== true || config.hostId !== hostId) return null;
  const entries = config.repos ?? [{ repo: DEFAULT_REPO }];
  if (!Array.isArray(entries)) throw new Error('ciWatcher.repos must be an array');
  const seen = new Set<string>();
  const repos = entries.map((entry: unknown): RepoConfig => {
    if (!record(entry) || typeof entry.repo !== 'string' || !/^[\w-]+\/[\w.-]+$/.test(entry.repo) || /\/\.{1,2}$/.test(entry.repo)) {
      throw new Error('each ciWatcher.repos entry needs a GitHub owner/repo');
    }
    const key = entry.repo.toLowerCase();
    if (seen.has(key)) throw new Error(`duplicate CI repository: ${entry.repo}`);
    seen.add(key);
    const workflow = entry.workflow ?? 'Tests';
    const bot = entry.bot ?? 'pi-dish';
    const recovery = entry.recovery ?? true;
    if (typeof workflow !== 'string' || !workflow.trim() || typeof bot !== 'string' || !bot.trim() || typeof recovery !== 'boolean') {
      throw new Error(`invalid workflow, bot or recovery setting for ${entry.repo}`);
    }
    return { repo: entry.repo, workflow: workflow.trim(), bot: bot.trim(), recovery };
  });
  if (config.token !== undefined && typeof config.token !== 'string') throw new Error('ciWatcher.token must be a string');
  return repos.length ? { repos, token: envToken?.trim() || config.token?.trim() || undefined } : null;
}

export interface CiEvent extends CiFailureDetails {
  id: string;
  kind: 'failure' | 'recovered';
  repo: string;
  workflow: string;
  branch: string;
  sha: string;
  title: string;
  url: string;
  runId: number;
  attempt: number;
}

type Position = { number: number; attempt: number };
type Branch = Position & { failing: boolean };
type Pending = { event: CiEvent; pushAttempted: boolean };
interface RepoState {
  floor: number;
  seen: Record<string, Position>;
  branches: Record<string, Branch>;
  pending: Pending[];
}
interface State { version: 1; repos: Record<string, RepoState> }
interface Ports {
  config: CiConfig | null;
  github: GitHubCi;
  load(): unknown;
  save(state: State): void;
  deliverBot(target: string, event: CiEvent): Promise<void>;
  notify(target: string, event: CiEvent): Promise<void>;
  log(message: string): void;
}

export interface CiWatcher {
  poll(): Promise<void>;
  start(): void;
  stop(): void;
}

function order(a: Position, b: Position): number {
  return a.number - b.number || a.attempt - b.attempt;
}

function eventFor(config: RepoConfig, run: CiRun, kind: CiEvent['kind'], details?: CiFailureDetails): CiEvent {
  return {
    id: `ci:${config.repo.toLowerCase()}:${run.id}:${run.attempt}`,
    kind, repo: config.repo, workflow: config.workflow, branch: run.branch, sha: run.sha,
    title: run.title, url: run.url, runId: run.id, attempt: run.attempt,
    jobs: details?.jobs ?? [], tests: details?.tests ?? [], likelyKnownFlake: details?.likelyKnownFlake ?? false,
  };
}

export function createCiWatcher(ports: Ports): CiWatcher {
  const { config, github } = ports;
  const loaded = config ? ports.load() : null;
  let state: State = record(loaded) && loaded.version === 1 && record(loaded.repos)
    ? loaded as unknown as State : { version: 1, repos: {} };
  const etags = new Map<string, string>();
  const controller = new AbortController();
  const { signal } = controller;
  let flight: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  function save(key: string, repo: RepoState): void {
    const next = { ...state, repos: { ...state.repos, [key]: repo } };
    ports.save(next);
    state = next;
  }

  async function sample(config: RepoConfig, key: string): Promise<void> {
    const listing = await github.listRuns(config.repo, config.workflow, etags.get(key), signal);
    if (listing.notModified || signal.aborted) return;
    const prior = state.repos[key];
    const runs = listing.runs.sort(order);
    const floor = Math.max(prior?.floor ?? 0, runs.length === CI_RUN_WINDOW ? runs[0].number : 0);
    let changed = !prior || floor !== prior.floor;
    const next: RepoState = {
      floor,
      seen: { ...prior?.seen },
      branches: { ...prior?.branches },
      pending: [...(prior?.pending ?? [])],
    };
    for (const run of runs) {
      if (run.number < floor || run.status !== 'completed' || (next.seen[run.id]?.attempt ?? 0) >= run.attempt) continue;
      const failure = run.conclusion === 'failure' || run.conclusion === 'timed_out';
      const success = run.conclusion === 'success';
      const branchKey = `:${run.branch}`;
      const branch = next.branches[branchKey];
      const advances = (failure || success) && (!branch || order(run, branch) > 0);
      if (prior && failure) {
        const details = await github.failureDetails(config.repo, run, signal);
        if (signal.aborted) return;
        next.pending.push({ event: eventFor(config, run, 'failure', details), pushAttempted: false });
      } else if (prior && success && advances && branch?.failing && config.recovery) {
        next.pending.push({ event: eventFor(config, run, 'recovered'), pushAttempted: false });
      }
      const position = { number: run.number, attempt: run.attempt };
      if (advances) next.branches[branchKey] = { ...position, failing: !!prior && failure };
      next.seen[run.id] = position;
      changed = true;
    }
    if (changed) {
      for (const [id, position] of Object.entries(next.seen)) if (position.number < floor) delete next.seen[id];
      for (const [branch, position] of Object.entries(next.branches)) {
        if (!position.failing && position.number < floor) delete next.branches[branch];
      }
      save(key, next);
    }
    if (listing.etag) etags.set(key, listing.etag);
    else etags.delete(key);
  }

  async function flush(config: RepoConfig, key: string): Promise<void> {
    const pending = state.repos[key]?.pending;
    if (!pending?.length || signal.aborted) return;
    for (const [index, item] of pending.entries()) {
      if (signal.aborted) return;
      if (item.pushAttempted) continue;
      // Web Push has no durable receipt. Checkpoint before sending to avoid two alerts on a restart.
      const repo = state.repos[key];
      const next = [...repo.pending];
      next[index] = { ...item, pushAttempted: true };
      save(key, { ...repo, pending: next });
      try { await ports.notify(config.bot, item.event); }
      catch (error) { ports.log(`${item.event.id} Web Push: ${String(error)}`); }
    }
    while (!signal.aborted) {
      const repo = state.repos[key];
      const item = repo.pending[0];
      if (!item) break;
      // The bot relay uses the event ID as its durable request ID, including after a restart.
      await ports.deliverBot(config.bot, item.event);
      save(key, { ...repo, pending: repo.pending.slice(1) });
    }
  }

  async function tick(): Promise<void> {
    for (const repo of config?.repos ?? []) {
      if (signal.aborted) break;
      const key = `${repo.repo.toLowerCase()}:${repo.workflow}`;
      try { await sample(repo, key); }
      catch (error) { if (!signal.aborted) ports.log(`${repo.repo} poll: ${String(error)}`); }
      try { await flush(repo, key); }
      catch (error) { if (!signal.aborted) ports.log(`${repo.repo} delivery: ${String(error)}`); }
    }
  }

  function poll(): Promise<void> {
    if (!config || signal.aborted) return Promise.resolve();
    return flight ??= tick().finally(() => { flight = undefined; });
  }

  return {
    poll,
    start() {
      if (!config || timer || signal.aborted) return;
      void poll();
      timer = setInterval(() => { void poll(); }, POLL_MS).unref();
    },
    stop() {
      clearInterval(timer);
      controller.abort();
    },
  };
}
