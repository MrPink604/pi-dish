// Generated from src/core/message-hold.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_MESSAGE_HOLD_WINDOW_MS = void 0;
exports.messageHoldWindowMs = messageHoldWindowMs;
exports.peerSender = peerSender;
exports.createMessageHold = createMessageHold;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const RETRY_MS = 5000;
exports.MAX_MESSAGE_HOLD_WINDOW_MS = 24 * 60 * 60 * 1000;
function messageHoldWindowMs(settings) {
    const value = settings.messageHoldWindowMs;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= exports.MAX_MESSAGE_HOLD_WINDOW_MS ? value : 0;
}
function peerSender(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const sender = value;
    return typeof sender.id === 'string' && sender.id.length > 0 && sender.id.length <= 200
        && typeof sender.ref === 'string' && sender.ref.length > 0 && sender.ref.length <= 200
        && typeof sender.name === 'string' && sender.name.length > 0 && sender.name.length <= 200
        && !/[\r\n]/.test(sender.ref + sender.name)
        ? { id: sender.id, ref: sender.ref, name: sender.name } : null;
}
function readBatches(file) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    const store = JSON.parse(text);
    if (!store || typeof store !== 'object' || !Array.isArray(store.batches)) {
        throw new Error('Invalid peer-message inbox; refusing to discard pending messages');
    }
    const batches = store.batches;
    if (!batches.every(batch => batch && typeof batch.sessionId === 'string'
        && (batch.delivery === 'prompt' || batch.delivery === 'followUp')
        && Number.isFinite(batch.until) && Array.isArray(batch.entries) && batch.entries.length > 0
        && batch.entries.every(entry => entry && typeof entry.message === 'string'
            && typeof entry.sentAt === 'string' && peerSender(entry.sender)))) {
        throw new Error('Invalid peer-message inbox; refusing to discard pending messages');
    }
    return batches;
}
function saveBatches(file, batches) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify({ batches }), { mode: 0o600 });
        const fd = fs.openSync(tmp, 'r');
        try {
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);
        const dirFd = fs.openSync(dir, 'r');
        try {
            fs.fsyncSync(dirFd);
        }
        finally {
            fs.closeSync(dirFd);
        }
    }
    catch (error) {
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
        throw error;
    }
}
function batchText(batch) {
    return batch.entries.map(entry => `[${entry.sender.ref} · ${entry.sender.name} · ${entry.sentAt}]\n${entry.message}`).join('\n\n');
}
/** Recipient-owned durable inbox. Each delivery mode keeps its own fixed window. */
function createMessageHold(ports) {
    const file = path.join(os.homedir(), '.pi', 'dish', 'message-holds.json');
    let batches = readBatches(file);
    let timer;
    let running = false;
    let stopped = false;
    const inFlight = new Set();
    const retryAt = new Map();
    function schedule() {
        clearTimeout(timer);
        if (stopped || !running || !batches.length)
            return;
        let next = Infinity;
        for (const batch of batches) {
            if (!inFlight.has(batch))
                next = Math.min(next, Math.max(batch.until, retryAt.get(batch) ?? 0));
        }
        if (!Number.isFinite(next))
            return;
        timer = setTimeout(() => { timer = undefined; flush().catch(report); }, Math.max(0, next - Date.now()));
        timer.unref();
    }
    function report(error) {
        if (ports.onError)
            ports.onError(error);
        else
            console.error('Peer-message delivery failed:', error);
    }
    async function deliver(batch) {
        if (inFlight.has(batch) || stopped)
            return;
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
        }
        catch (error) {
            retryAt.set(batch, Date.now() + RETRY_MS);
            report(error);
        }
        finally {
            inFlight.delete(batch);
            schedule();
        }
    }
    async function flush(sessionId) {
        if (stopped)
            return;
        const now = Date.now();
        for (const batch of batches) {
            if (batch.until <= now && (retryAt.get(batch) ?? 0) <= now
                && (!sessionId || batch.sessionId === sessionId))
                await deliver(batch);
        }
        schedule();
    }
    return {
        enqueue(sessionId, delivery, message, sender) {
            if (stopped)
                throw new Error('Peer-message inbox is closed');
            const now = Date.now();
            const window = messageHoldWindowMs(ports.readSettings());
            if (!window)
                throw new Error('Peer-message hold is disabled');
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
        start() { running = true; schedule(); },
        wake(sessionId) {
            if (stopped)
                return;
            for (const batch of batches)
                if (batch.sessionId === sessionId && batch.until <= Date.now()) {
                    retryAt.delete(batch);
                }
            schedule();
        },
        stop() { stopped = true; clearTimeout(timer); timer = undefined; },
    };
}
