import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LiveSession } from './session-ownership';

export interface PeerSender { id: string; ref: string; name: string }
type Delivery = 'prompt' | 'followUp';
interface Entry { message: string; sender: PeerSender; sentAt: string }
interface Batch { sessionId: string; delivery: Delivery; until: number; entries: Entry[] }
interface Store { batches: Batch[] }
interface HoldPorts {
  getLiveSession(id: string): Promise<LiveSession | null>;
  supports(session: LiveSession, capability: Delivery): boolean;
  readSettings(): Record<string, unknown>;
  onError?(error: unknown): void;
}
export interface MessageHold {
  enqueue(sessionId: string, delivery: Delivery, message: string, sender: PeerSender): { held: true; until: string };
  start(): void;
  wake(sessionId: string): void;
  stop(): void;
}

const RETRY_MS = 5000;
export const MAX_MESSAGE_HOLD_WINDOW_MS = 24 * 60 * 60 * 1000;

export function messageHoldWindowMs(settings: Record<string, unknown>): number {
  const value = settings.messageHoldWindowMs;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_MESSAGE_HOLD_WINDOW_MS ? value : 0;
}

export function peerSender(value: unknown): PeerSender | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sender = value as Record<string, unknown>;
  return typeof sender.id === 'string' && sender.id.length > 0 && sender.id.length <= 200
    && typeof sender.ref === 'string' && sender.ref.length > 0 && sender.ref.length <= 200
    && typeof sender.name === 'string' && sender.name.length > 0 && sender.name.length <= 200
    && !/[\r\n]/.test(sender.ref + sender.name)
    ? { id: sender.id, ref: sender.ref, name: sender.name } : null;
}

function readBatches(file: string): Batch[] {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const store: unknown = JSON.parse(text);
  if (!store || typeof store !== 'object' || !Array.isArray((store as Store).batches)) {
    throw new Error('Invalid peer-message inbox; refusing to discard pending messages');
  }
  const batches = (store as Store).batches;
  if (!batches.every(batch => batch && typeof batch.sessionId === 'string'
      && (batch.delivery === 'prompt' || batch.delivery === 'followUp')
      && Number.isFinite(batch.until) && Array.isArray(batch.entries) && batch.entries.length > 0
      && batch.entries.every(entry => entry && typeof entry.message === 'string'
        && typeof entry.sentAt === 'string' && peerSender(entry.sender)))) {
    throw new Error('Invalid peer-message inbox; refusing to discard pending messages');
  }
  return batches;
}

function saveBatches(file: string, batches: Batch[]): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ batches }), { mode: 0o600 });
    const fd = fs.openSync(tmp, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

function batchText(batch: Batch): string {
  return batch.entries.map(entry => `[${entry.sender.ref} · ${entry.sender.name} · ${entry.sentAt}]\n${entry.message}`).join('\n\n');
}

/** Recipient-owned durable inbox. Each delivery mode keeps its own fixed window. */
export function createMessageHold(ports: HoldPorts): MessageHold {
  const file = path.join(os.homedir(), '.pi', 'dish', 'message-holds.json');
  let batches = readBatches(file);
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let stopped = false;
  const inFlight = new Set<Batch>();
  const retryAt = new Map<Batch, number>();

  function schedule(): void {
    clearTimeout(timer);
    if (stopped || !running || !batches.length) return;
    let next = Infinity;
    for (const batch of batches) {
      if (!inFlight.has(batch)) next = Math.min(next, Math.max(batch.until, retryAt.get(batch) ?? 0));
    }
    if (!Number.isFinite(next)) return;
    timer = setTimeout(() => { timer = undefined; flush().catch(report); }, Math.max(0, next - Date.now()));
    timer.unref();
  }

  function report(error: unknown): void {
    if (ports.onError) ports.onError(error);
    else console.error('Peer-message delivery failed:', error);
  }

  async function deliver(batch: Batch): Promise<void> {
    if (inFlight.has(batch) || stopped) return;
    inFlight.add(batch);
    try {
      const session = await ports.getLiveSession(batch.sessionId);
      if (!session || !ports.supports(session, batch.delivery)) {
        retryAt.set(batch, Date.now() + RETRY_MS);
        return;
      }
      await session.prompt(batchText(batch), batch.delivery === 'followUp' ? { deliverAs: 'followUp' } : {});
      // Only an acknowledged harness delivery retires the durable batch.
      const index = batches.indexOf(batch);
      if (index !== -1) {
        const updated = batches.filter(item => item !== batch);
        saveBatches(file, updated);
        batches = updated;
        retryAt.delete(batch);
      }
    } catch (error) {
      retryAt.set(batch, Date.now() + RETRY_MS);
      report(error);
    } finally {
      inFlight.delete(batch);
      schedule();
    }
  }

  async function flush(sessionId?: string): Promise<void> {
    if (stopped) return;
    const now = Date.now();
    for (const batch of batches) {
      if (batch.until <= now && (retryAt.get(batch) ?? 0) <= now
          && (!sessionId || batch.sessionId === sessionId)) await deliver(batch);
    }
    schedule();
  }

  return {
    enqueue(sessionId: string, delivery: Delivery, message: string, sender: PeerSender): { held: true; until: string } {
      if (stopped) throw new Error('Peer-message inbox is closed');
      const now = Date.now();
      const window = messageHoldWindowMs(ports.readSettings());
      if (!window) throw new Error('Peer-message hold is disabled');
      // An expired or currently delivering batch is immutable; new arrivals start a new window.
      const batch = batches.find(item => item.sessionId === sessionId && item.delivery === delivery
        && item.until > now && !inFlight.has(item));
      const until = batch?.until ?? now + window;
      const entry = { message, sender, sentAt: new Date(now).toISOString() };
      const updated = batch
        ? batches.map(item => item === batch ? { ...batch, entries: [...batch.entries, entry] } : item)
        : [...batches, { sessionId, delivery, until, entries: [entry] }];
      saveBatches(file, updated);
      batches = updated;
      schedule();
      return { held: true, until: new Date(until).toISOString() };
    },
    start(): void { running = true; schedule(); },
    wake(sessionId: string): void {
      if (stopped) return;
      for (const batch of batches) if (batch.sessionId === sessionId && batch.until <= Date.now()) {
        retryAt.delete(batch);
      }
      schedule();
    },
    stop(): void { stopped = true; clearTimeout(timer); timer = undefined; },
  };
}
