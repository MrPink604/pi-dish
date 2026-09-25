// Generated test/tool from test/cache-lifetime.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for lib/cache-lifetime.js — the learned provider cache-TTL
 * store: observation extraction from session entries, the gated logistic
 * warmth fit, serve-time overlay precedence, persistence, and the indexer
 * ingestion path.
 *
 * Run with: npm test
 */
const test = require("node:test");
const test_types_js_1 = require("./test-types.js");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-cl-'));
process.env.HOME = tmpHome;
const CL = require('../lib/cache-lifetime.js');
const index = require('../lib/session-index.js');
const SM = require('../lib/session-metadata.js');
const { sourceForIdentity } = require('../lib/session-source.js');
const dishDir = path.join(tmpHome, '.pi', 'dish');
const dishSettingsFile = path.join(dishDir, 'settings.json');
const sessionsDir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--proj--');
fs.mkdirSync(sessionsDir, { recursive: true });
test.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));
const MIN = 60_000;
const SEP = '\u0000';
let fileSeq = 0;
function cacheMsg(t, usage, provider = 'openai', model = 'gpt-4o', api = 'openai-responses') {
    return { type: 'message', timestamp: t, message: {
            role: 'assistant', api, provider, model, timestamp: t, content: [],
            usage: { input: 5, cacheRead: usage.read ?? 0, cacheWrite: usage.write ?? 0, cacheWrite1h: usage.write1h ?? 0 },
        } };
}
/**
 * A session probing a provider with a hard TTL cliff: alternating warm
 * returns (gap < ttl, cache read) and cold returns (gap > ttl, full
 * rewrite). Returns the entries and the last cache-active timestamp.
 */
function cliffEntries(startMs, ttlMs, probes, provider, model, api) {
    const entries = [cacheMsg(startMs, { write: 100 }, provider, model, api)];
    const warmGaps = [0.4, 0.55, 0.7, 0.85];
    const coldGaps = [1.3, 1.6, 2.0, 2.5];
    let t = startMs;
    for (let i = 0; i < probes; i++) {
        const warm = i % 2 === 0;
        t += Math.round(ttlMs * (warm ? warmGaps[i % warmGaps.length] : coldGaps[i % coldGaps.length]));
        entries.push(cacheMsg(t, warm ? { read: 90, write: 10 } : { write: 100 }, provider, model, api));
    }
    return { entries, lastT: t };
}
function cliffStart(ttlMs, probes) {
    return Date.now() - Math.round(probes * ttlMs * 1.4) - 30 * MIN;
}
function observe(entries, file = path.join(tmpHome, `learn-${fileSeq++}.jsonl`)) {
    CL.observeCacheLifetimeFromEntries(entries, file);
    return file;
}
function snapshotFor(identity) {
    return CL.cacheLifetimeSnapshot().find(entry => entry.identity === identity);
}
const openAiIdentity = ['openai-responses', 'openai', 'gpt-4o'].join(SEP);
test('fit activates on a clean cliff and lands on the true TTL', () => {
    const ttl = 20 * MIN;
    observe(cliffEntries(cliffStart(ttl, 40), ttl, 40).entries);
    const entry = (0, test_types_js_1.present)(snapshotFor(openAiIdentity));
    assert.equal(entry.active, true);
    assert.ok(entry.ttlMs > ttl * 0.7 && entry.ttlMs < ttl * 1.4, `learned ${entry.ttlMs} near ${ttl}`);
    assert.equal(entry.stats.warmHitRate, 1, 'deterministic provider: every warm-window probe hits');
    assert.ok(entry.stats.slope < -1, `cliff slope, got ${entry.stats.slope}`);
});
test('overlay substitutes learned TTL for estimates but never fixed or overridden', () => {
    const refreshedAt = Date.now() - 30 * MIN;
    const expiry = { refreshedAt, expiresAt: refreshedAt + 10 * MIN, retentionMs: 10 * MIN,
        retention: '~10m', basis: 'estimate', identity: openAiIdentity };
    const learned = (0, test_types_js_1.present)(CL.applyLearnedCacheExpiry(expiry));
    assert.equal(learned.basis, 'learned');
    assert.ok(learned.retentionMs > 14 * MIN && learned.retentionMs < 28 * MIN);
    assert.equal(learned.expiresAt, refreshedAt + learned.retentionMs);
    const fixed = { ...expiry, basis: 'fixed', retention: '5m', retentionMs: 5 * MIN };
    assert.equal(CL.applyLearnedCacheExpiry(fixed), fixed, 'documented fixed retention stands');
    fs.mkdirSync(dishDir, { recursive: true });
    fs.writeFileSync(dishSettingsFile, JSON.stringify({ cacheTtlOverrides: [{ provider: 'openai', ttl: '2h' }] }) + '\n');
    try {
        assert.equal(CL.applyLearnedCacheExpiry(expiry), expiry, 'user override beats the learned model');
    }
    finally {
        fs.rmSync(dishSettingsFile, { force: true });
    }
});
test('gates reject thin and one-sided evidence', () => {
    observe(cliffEntries(cliffStart(10 * MIN, 6), 10 * MIN, 6, 'acme', 'model-a', 'acme-api').entries);
    assert.equal((0, test_types_js_1.present)(snapshotFor(['acme-api', 'acme', 'model-a'].join(SEP))).active, false, 'six probes is not support');
    const t0 = Date.now() - 40 * MIN;
    const hitsOnly = [cacheMsg(t0, { write: 100 }, 'acme', 'model-b', 'acme-api')];
    for (let i = 1; i <= 30; i++) {
        hitsOnly.push(cacheMsg(t0 + i * MIN, { read: 90, write: 5 }, 'acme', 'model-b', 'acme-api'));
    }
    observe(hitsOnly);
    assert.equal((0, test_types_js_1.present)(snapshotFor(['acme-api', 'acme', 'model-b'].join(SEP))).active, false, 'no misses: crossing never bracketed');
});
test('compaction resets the probe chain and re-parsing is idempotent', () => {
    const t0 = Date.now() - 20 * MIN;
    const entries = [
        cacheMsg(t0, { write: 100 }, 'acme', 'model-c', 'acme-api'),
        { type: 'compaction' },
        cacheMsg(t0 + 10 * MIN, { write: 100 }, 'acme', 'model-c', 'acme-api'),
    ];
    const file = observe(entries);
    assert.equal(snapshotFor(['acme-api', 'acme', 'model-c'].join(SEP)), undefined, 'no anchor, no observation');
    observe(entries, file);
    observe(entries, file);
    assert.equal(CL.cacheLifetimeSnapshot().length, 3, 're-parsing the same file adds nothing');
});
test('extended cache tier learns separately from the default tier', () => {
    const t0 = Date.now() - 90 * MIN;
    const anthropic = (t, usage) => cacheMsg(t, usage, 'anthropic', 'claude-opus-4', 'anthropic-messages');
    observe([
        anthropic(t0, { write: 80, write1h: 80 }), // anchors the 1h chain
        anthropic(t0 + 30 * MIN, { read: 70, write: 5, write1h: 5 }), // 1h probe: hit at 30m
        anthropic(t0 + 40 * MIN, { write: 90 }), // 1h probe: miss at 10m; re-anchors as 5m
        anthropic(t0 + 70 * MIN, { write: 90 }), // 5m probe: miss at 30m
    ]);
    const identity = ['anthropic-messages', 'anthropic', 'claude-opus-4'].join(SEP);
    const snapshot = CL.cacheLifetimeSnapshot().filter(entry => entry.identity === identity);
    assert.equal(snapshot.length, 2, '5m and 1h probes land in separate models');
    assert.deepEqual(snapshot.map(entry => entry.tier).sort(), ['1h', null]);
    assert.equal((0, test_types_js_1.present)(snapshot.find(entry => entry.tier === '1h')).rawObservations, 2);
    assert.equal((0, test_types_js_1.present)(snapshot.find(entry => entry.tier === null)).rawObservations, 1);
});
test('long-idle probes survive a window flooded by tool-loop chatter', () => {
    // Early in the window: long idles bracketing a 20m cliff. Then far more
    // seconds-apart tool-loop hits than the window holds; a FIFO would keep
    // only the chatter and never see a cold return again. Chatter is not
    // support either: it is capped to its own gap bucket.
    const ttl = 20 * MIN;
    const start = Date.now() - 7 * 24 * 60 * MIN;
    const { entries, lastT } = cliffEntries(start, ttl, 40, 'chatty', 'model-d', 'chatty-api');
    let t = lastT;
    for (let i = 0; i < 600; i++) {
        t += 4_000 + (i % 7) * 1_000;
        entries.push(cacheMsg(t, { read: 95, write: 1 }, 'chatty', 'model-d', 'chatty-api'));
    }
    observe(entries);
    const identity = ['chatty-api', 'chatty', 'model-d'].join(SEP);
    const report = (0, test_types_js_1.present)(CL.cacheLifetimeReport().find(entry => entry.model === 'model-d'));
    assert.ok(report.probes.total <= 240, `window bounded, got ${report.probes.total}`);
    assert.equal(report.probes.misses, 20, 'every cold return kept');
    assert.ok(report.points.filter(([gap]) => gap < 15_000).length <= 24, 'chatter capped to its gap bucket');
    const entry = (0, test_types_js_1.present)(snapshotFor(identity));
    assert.equal(entry.active, true, 'cliff still learnable after the flood');
    assert.ok(entry.ttlMs > ttl * 0.7 && entry.ttlMs < ttl * 1.4, `learned ${entry.ttlMs} near ${ttl}`);
});
test('a learned TTL serves providers with no built-in window, and only once active', () => {
    const identity = ['mystery-api', 'mystery', 'model-e'].join(SEP);
    const refreshedAt = Date.now() - 5 * MIN;
    const anchor = SM.cacheExpiryForMessage({ api: 'mystery-api', provider: 'mystery', model: 'model-e', timestamp: refreshedAt,
        usage: { input: 5, cacheRead: 0, cacheWrite: 100 } });
    const unknown = (0, test_types_js_1.present)(anchor);
    assert.equal(unknown.basis, 'unknown', 'no built-in window keeps an anchor');
    assert.equal(CL.applyLearnedCacheExpiry(unknown), null, 'an unlearned anchor is never served');
    const ttl = 8 * MIN;
    observe(cliffEntries(cliffStart(ttl, 40), ttl, 40, 'mystery', 'model-e', 'mystery-api').entries);
    assert.equal((0, test_types_js_1.present)(snapshotFor(identity)).active, true);
    const served = (0, test_types_js_1.present)(CL.applyLearnedCacheExpiry(unknown));
    assert.equal(served.basis, 'learned');
    assert.equal(served.expiresAt, refreshedAt + served.retentionMs);
    const report = (0, test_types_js_1.present)(CL.cacheLifetimeReport().find(entry => entry.model === 'model-e'));
    assert.equal(report.source, 'learned');
    assert.equal(report.builtin, null);
    assert.ok(report.gates.every(gate => gate.pass));
});
test('the report explains precedence and the first failing gate', () => {
    const byModel = (model) => (0, test_types_js_1.present)(CL.cacheLifetimeReport().find(entry => entry.model === model && entry.tier === null));
    const hitsOnly = byModel('model-b');
    assert.equal(hitsOnly.source, 'none', 'unknown provider, nothing learned');
    assert.equal(hitsOnly.effective, null);
    assert.equal(hitsOnly.probes.misses, 0);
    assert.equal((0, test_types_js_1.present)(hitsOnly.gates.find(gate => !gate.pass)).id, 'cold');
    const estimated = byModel('gpt-4o');
    assert.equal(estimated.source, 'learned', 'a learned fit replaces the ~10m estimate');
    assert.equal((0, test_types_js_1.present)(estimated.builtin).basis, 'estimate');
    assert.equal((0, test_types_js_1.present)(estimated.effective).basis, 'learned');
    const documented = byModel('claude-opus-4');
    assert.equal(documented.source, 'documented', 'Anthropic 5m is published, never replaced');
    assert.equal((0, test_types_js_1.present)(documented.effective).retention, '5m');
    fs.mkdirSync(dishDir, { recursive: true });
    fs.writeFileSync(dishSettingsFile, JSON.stringify({ cacheTtlOverrides: [{ provider: 'openai', ttl: '2h' }] }) + '\n');
    try {
        const overridden = byModel('gpt-4o');
        assert.equal(overridden.source, 'override');
        assert.equal((0, test_types_js_1.present)(overridden.effective).retention, '2h');
    }
    finally {
        fs.rmSync(dishSettingsFile, { force: true });
    }
});
test('store survives a flush and reload', () => {
    CL.flushCacheLifetime();
    const persisted = JSON.parse(fs.readFileSync(path.join(dishDir, 'cache-lifetime.json'), 'utf8'));
    assert.ok(persisted.identities[openAiIdentity].obs.length >= 40);
    CL.resetCacheLifetimeForTests();
    const entry = (0, test_types_js_1.present)(snapshotFor(openAiIdentity));
    assert.equal(entry.active, true, 'fitted state rebuilt from disk');
    assert.ok(entry.ttlMs > 14 * MIN && entry.ttlMs < 28 * MIN);
});
test('scanSessions mines observations from indexed sessions and their appends', () => {
    const ttl = 15 * MIN;
    const { entries, lastT } = cliffEntries(cliffStart(ttl, 40), ttl, 40);
    const file = path.join(sessionsDir, 'learned-scan.jsonl');
    fs.writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const source = sourceForIdentity('pi', (0, test_types_js_1.nativeId)('learned-scan'), file);
    index.scanSessions([source]);
    const mined = (0, test_types_js_1.present)(snapshotFor(openAiIdentity));
    assert.ok(mined.rawObservations >= 40, 'full parse mined the probes');
    fs.appendFileSync(file, JSON.stringify(cacheMsg(lastT + 2 * ttl, { write: 100 })) + '\n');
    index.scanSessions([source]);
    assert.equal((0, test_types_js_1.present)(snapshotFor(openAiIdentity)).rawObservations, mined.rawObservations + 1, 'append extends the chain');
});
