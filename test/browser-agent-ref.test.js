// Generated test/tool from test/browser-agent-ref.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const context = (0, browser_vm_js_1.browserSandbox)({ atob: globalThis.atob });
const { createSessionState, createSessionReferences, createAgentRefResolver, parseAgentRef, shortAgentDisplayId, isPlausibleShortSessionId, mayContainHostAgentRef, matchCodeAgentRef, findInlineAgentRefs, parseSpawnWorkerResult, deriveAgentState, renderAgentRefChip, renderAgentRefCard, parseInjectedBotMessage, } = context.PiDishBrowser;
const AGY_ID = '~sk1_' + Buffer.from(JSON.stringify(['agy', 'd46c28bc-43d2-45e2-b941-b9f3c6099ad2'])).toString('base64url');
const OMP_ID = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-11-23T19-59-55-396Z_01a209fe-6004-728d-a054-3eb58c976ccb'])).toString('base64url');
const HOST_UUID = '0c6ca019-19c1-4b4d-92c7-0218bfe8dbf5';
test('parseAgentRef decodes ~sk1_, host/~sk1_, hostUuid:~sk1_, and short forms cleanly', () => {
    const bare = parseAgentRef(AGY_ID);
    assert.ok(bare);
    assert.equal(bare.isEncoded, true);
    assert.equal(bare.hostPart, null);
    assert.equal(bare.decoded?.harnessId, 'agy');
    assert.equal(bare.shortId, 'd46c28bc');
    assert.equal(bare.shortRef, 'd46c28bc');
    const hosted = parseAgentRef(`framework/${OMP_ID}`);
    assert.ok(hosted);
    assert.equal(hosted.isEncoded, true);
    assert.equal(hosted.hostPart, 'framework');
    assert.equal(hosted.decoded?.harnessId, 'omp');
    assert.equal(hosted.shortId, '01a209fe');
    assert.equal(hosted.shortRef, 'framework/01a209fe');
    const uuidHosted = parseAgentRef(`${HOST_UUID}:${AGY_ID}`);
    assert.ok(uuidHosted);
    assert.equal(uuidHosted.hostIdForm, true);
    assert.equal(uuidHosted.hostPart, HOST_UUID);
    assert.equal(uuidHosted.isEncoded, true);
    const shortHosted = parseAgentRef('framework/01a1fc7c');
    assert.ok(shortHosted);
    assert.equal(shortHosted.isEncoded, false);
    assert.equal(shortHosted.hostPart, 'framework');
    assert.equal(shortHosted.id, '01a1fc7c');
    assert.equal(shortHosted.shortRef, 'framework/01a1fc7c');
    // Ellipsized or corrupt ~sk1_ strings do not claim to be valid encoded refs.
    assert.equal(parseAgentRef('~sk1_…MmFiODkxYTAwMzIiXQ')?.isEncoded, false);
    assert.equal(parseAgentRef('~sk1_notbase64!!')?.isEncoded, false);
    assert.equal(shortAgentDisplayId(OMP_ID), '01a209fe');
    assert.equal(isPlausibleShortSessionId('01a1fc7c'), true);
    assert.equal(isPlausibleShortSessionId('d46c28bc-43d2-45e2-b941-b9f3c6099ad2'), true);
    assert.equal(isPlausibleShortSessionId('2026-09-09T00-01-00-shared-child'), true);
    assert.equal(isPlausibleShortSessionId('README.md'), false);
    assert.equal(isPlausibleShortSessionId('abc'), false);
});
test('findInlineAgentRefs and matchCodeAgentRef link ~sk1_, host/~sk1_, and known host/shortid while ignoring random hex', () => {
    const knownHosts = new Set(['framework', 'desktop', 'beelink', 'self']);
    const isKnownHost = (host) => knownHosts.has(host.toLowerCase());
    const matchRef = (ref) => (ref === 'local-child-1' ? { id: 'local-child-1', name: 'Local child', isActive: true } : null);
    const prose = [
        `Started ${AGY_ID} and framework/${OMP_ID}.`,
        `Also #${AGY_ID}, #framework/${OMP_ID}, and #local-child-1.`,
        `Short ref framework/01a1fc7c works too.`,
        `Ignore random hex deadbeef, 0eea720, 01a1fc7c, origin/01a1fc7c, framework/README.md,`,
        `URL https://example.com/framework/01a1fc7c, path /home/framework/01a1fc7c,`,
        `ellipsized ~sk1_…MmFiODkxYTAwMzIiXQ, and glued word#${AGY_ID}.`,
    ].join(' ');
    const found = findInlineAgentRefs(prose, { matchRef, isKnownHost });
    assert.deepEqual([...found].map(m => ({ ref: m.ref, preserveLabel: m.preserveLabel })), [
        { ref: AGY_ID, preserveLabel: false },
        { ref: `framework/${OMP_ID}`, preserveLabel: false },
        { ref: AGY_ID, preserveLabel: false },
        { ref: `framework/${OMP_ID}`, preserveLabel: false },
        { ref: 'local-child-1', preserveLabel: true },
        { ref: 'framework/01a1fc7c', preserveLabel: true },
    ]);
    // Code spans
    const codeEncoded = matchCodeAgentRef(`framework/${OMP_ID}`, { matchRef, isKnownHost });
    assert.ok(codeEncoded && codeEncoded.replaceCode === true && codeEncoded.preserveLabel === false);
    const codeShortHosted = matchCodeAgentRef('framework/01a1fc7c', { matchRef, isKnownHost });
    assert.ok(codeShortHosted && codeShortHosted.preserveLabel === true && codeShortHosted.replaceCode === true);
    const codeMatchedShort = matchCodeAgentRef('local-child-1', { matchRef, isKnownHost });
    assert.ok(codeMatchedShort && codeMatchedShort.preserveLabel === true && codeMatchedShort.session?.id === 'local-child-1');
    // Negative code-span cases
    assert.equal(matchCodeAgentRef('0eea720', { matchRef, isKnownHost }), null);
    assert.equal(matchCodeAgentRef('deadbeef', { matchRef, isKnownHost }), null);
    assert.equal(matchCodeAgentRef('origin/01a1fc7c', { matchRef, isKnownHost }), null);
    assert.equal(matchCodeAgentRef('framework/README.md', { matchRef, isKnownHost }), null);
    assert.equal(matchCodeAgentRef('~sk1_…', { matchRef, isKnownHost }), null);
    assert.equal(matchCodeAgentRef(`command ${AGY_ID}`, { matchRef, isKnownHost }), null);
    // Fast-path HTML prefilter skips plain tags/paths and catches known-host refs
    assert.equal(mayContainHostAgentRef('<p>All hosts are <strong>healthy</strong> and/or ready.</p>', isKnownHost), false);
    assert.equal(mayContainHostAgentRef('<p>Check origin/01a1fc7c or https://example.com/01a1fc7c</p>', isKnownHost), false);
    assert.equal(mayContainHostAgentRef('<p>framework/01a1fc7c</p>', isKnownHost), true);
    assert.equal(mayContainHostAgentRef('<p>See desktop/2026-11-21T05-03-14-013Z_abc</p>', isKnownHost), true);
});
test('parseSpawnWorkerResult parses bot-runtime spawn outputs and rejects errors/multi-worker JSON', () => {
    const local = parseSpawnWorkerResult(`Started worker "carbon-review-ux" (agy). Ref: ${AGY_ID}. Each answer it gives arrives as a "[worker report]" message.`);
    assert.ok(local);
    assert.deepEqual({ ...local }, { name: 'carbon-review-ux', harness: 'agy', host: null, ref: AGY_ID });
    const remote = parseSpawnWorkerResult(`Started worker "audit-fleet" (omp on framework). Ref: framework/${OMP_ID}. Each answer it gives arrives as a "[worker report]" message.`);
    assert.ok(remote);
    assert.deepEqual({ ...remote }, { name: 'audit-fleet', harness: 'omp', host: 'framework', ref: `framework/${OMP_ID}` });
    const singleJson = parseSpawnWorkerResult(JSON.stringify({ ref: `desktop/${AGY_ID}`, name: 'worker-a', host: 'desktop' }));
    assert.ok(singleJson);
    assert.deepEqual({ ...singleJson }, { name: 'worker-a', harness: 'agy', host: 'desktop', ref: `desktop/${AGY_ID}` });
    assert.equal(parseSpawnWorkerResult(JSON.stringify({ status: 'ok', workers: [{ ref: AGY_ID }] })), null);
    assert.equal(parseSpawnWorkerResult('Refused: unknown host'), null);
});
test('deriveAgentState and shared card/chip renderers cover all states and degrade gracefully', () => {
    assert.equal(deriveAgentState({ isActive: true, turnInProgress: true }).state, 'working');
    assert.equal(deriveAgentState({ isActive: true, askPending: true }).state, 'waiting');
    assert.equal(deriveAgentState({ isActive: true, turnInProgress: false }).state, 'idle');
    assert.equal(deriveAgentState({ isActive: false }, { reportStatus: 'finished', reportTone: 'ok' }).state, 'finished');
    assert.equal(deriveAgentState({ isActive: false }).state, 'closed');
    const ambig = deriveAgentState(null, { resolveStatus: 'ambiguous' });
    assert.equal(ambig.state, 'ambiguous');
    assert.equal(ambig.label, 'ambiguous ref');
    assert.equal(ambig.tone, 'warn');
    assert.equal(deriveAgentState(null, { resolveStatus: 'missing' }).state, 'unavailable');
    // Short worker reports open by default (<= 8 lines and <= 600 chars); longer ones collapse.
    const shortReport = parseInjectedBotMessage('bot-worker-report', '[worker report] "quick" (framework/01a1fc7c) finished.\n\nAll 42 tests passed.');
    assert.equal(shortReport?.defaultOpen, true);
    const longLines = Array.from({ length: 10 }, (_, i) => `- line ${i + 1}`).join('\n');
    const longReport = parseInjectedBotMessage('bot-worker-report', `[worker report] "audit" (framework/01a1fc7c) finished.\n\n${longLines}`);
    assert.equal(longReport?.defaultOpen, false);
    const longChars = parseInjectedBotMessage('bot-worker-report', `[worker report] "wall" (framework/01a1fc7c) finished.\n\n${'x'.repeat(650)}`);
    assert.equal(longChars?.defaultOpen, false);
    // Card with full metadata
    const richCard = renderAgentRefCard({
        ref: `framework/${OMP_ID}`,
        session: {
            id: OMP_ID,
            host: HOST_UUID,
            hostLabel: 'framework',
            name: 'kit wave1: scout_rifle',
            harnessId: 'omp',
            model: 'anthropic/claude-opus-5-5',
            isActive: true,
            turnInProgress: true,
        },
        bodyHtml: '<p>Report content</p>',
        bodyPreview: 'Report content',
        bodyDefaultOpen: false,
    });
    assert.match(richCard, /agent-ref-card/);
    assert.match(richCard, /data-agent-state="working"/);
    assert.match(richCard, /kit wave1: scout_rifle/);
    assert.match(richCard, /OMP/);
    assert.match(richCard, /claude-opus-5-5/);
    assert.match(richCard, /framework/);
    assert.match(richCard, /01a209fe/);
    assert.match(richCard, /agent-ref-open/);
    assert.match(richCard, /<details class="agent-ref-details">/);
    // Graceful degradation when session metadata is unavailable
    const degraded = renderAgentRefCard({
        ref: `framework/${AGY_ID}`,
        session: null,
        hint: { resolveStatus: 'missing' },
    });
    assert.match(degraded, /data-agent-state="unavailable"/);
    assert.match(degraded, /AGY/);
    assert.match(degraded, /framework/);
    assert.match(degraded, /d46c28bc/);
    assert.match(degraded, /agent-ref-open/);
    // Shared chip for opaque ~sk1_ ref replaces raw blob with compact label + harness
    const chip = renderAgentRefChip({ ref: AGY_ID, session: null });
    assert.match(chip, /agent-ref-chip/);
    assert.match(chip, /d46c28bc/);
    assert.match(chip, /AGY/);
    assert.doesNotMatch(chip, /<span class="agent-ref-chip-label">~sk1_/);
});
test('sessionReferences matches self host by label as well as peer hosts by name or label', () => {
    const selfId = 'b0bda1c9-66b1-4347-9e74-37909e3edd8b';
    const state = createSessionState({ getSelfHostId: () => selfId, getHostLabel: id => (id === selfId ? 'beelink' : 'framework'), onListsChanged() { }, onCurrentChanged() { } });
    state.setSessionLists([
        { hostId: selfId, active: [{ id: AGY_ID, name: 'Local Agy', isActive: true }] },
        { hostId: HOST_UUID, active: [{ id: OMP_ID, name: 'Remote OMP', isActive: true }] },
    ]);
    const selfHost = { hostId: selfId, key: selfId, source: 'self', base: '', self: true, name: null, label: 'beelink', capabilities: {} };
    const peerHost = { hostId: HOST_UUID, key: HOST_UUID, source: 'fleet', base: '/hosts/framework', name: 'framework', label: 'framework', capabilities: {} };
    const refs = createSessionReferences({
        sessionState: state,
        selfId: () => selfId,
        host: id => (id === HOST_UUID ? peerHost : selfHost),
        hostLabel: id => (id === HOST_UUID ? 'framework' : 'beelink'),
        config: () => ({}),
    });
    // Self host has name: null and label: 'beelink' — beelink/<ref> must still resolve!
    assert.equal(refs.match(`beelink/${AGY_ID}`)?.id, AGY_ID);
    assert.equal(refs.match(`framework/${OMP_ID}`)?.id, OMP_ID);
    assert.equal(refs.match('framework/01a209fe')?.id, OMP_ID);
});
test('createAgentRefResolver batches requests, caches results, falls back on 404, and opens closed refs on demand', async () => {
    const selfId = 'b0bda1c9-66b1-4347-9e74-37909e3edd8b';
    const selfHost = { hostId: selfId, key: selfId, source: 'self', base: '', self: true, name: null, label: 'beelink', reachable: true, capabilities: { resolve: true } };
    const peerHost = { hostId: HOST_UUID, key: HOST_UUID, source: 'fleet', base: '/hosts/framework', name: 'framework', label: 'framework', reachable: true, capabilities: { resolve: true } };
    const hosts = [selfHost, peerHost];
    const state = createSessionState({
        getSelfHostId: () => selfId,
        getHostLabel: id => (id === HOST_UUID ? 'framework' : 'beelink'),
        onListsChanged() { },
        onCurrentChanged() { },
    });
    state.setSessionLists([{ hostId: selfId, active: [{ id: 'bot-1', name: 'pi-dish', isActive: true }] }]);
    state.setCurrentSession('bot-1', selfId);
    const refs = createSessionReferences({
        sessionState: state,
        selfId: () => selfId,
        host: id => (id === HOST_UUID ? peerHost : selfHost),
        hostLabel: id => (id === HOST_UUID ? 'framework' : 'beelink'),
        config: () => ({}),
    });
    const requests = [];
    const selected = [];
    const statuses = [];
    const mockDoc = {
        getElementById: () => null,
        createElement: () => ({}),
    };
    const resolver = createAgentRefResolver({
        document: mockDoc,
        sessionState: state,
        request: async (target, reqPath, init) => {
            const base = typeof target === 'object' && target ? target.base : '';
            const method = init?.method || 'GET';
            requests.push({ base, path: reqPath, method });
            // Peer simulates an older server without /api/sessions/resolve-batch (404 fallback).
            if (base === '/hosts/framework' && reqPath === '/api/sessions/resolve-batch') {
                return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
            }
            if (reqPath === '/api/sessions/resolve-batch') {
                return new Response(JSON.stringify({
                    results: {
                        [AGY_ID]: { status: 'ok', session: { id: AGY_ID, name: 'Closed Local Agy', harnessId: 'agy', model: 'gemini-4-carbon', isActive: false } },
                    },
                }), { status: 200 });
            }
            if (reqPath.startsWith('/api/sessions/resolve?id=')) {
                const id = decodeURIComponent(reqPath.slice('/api/sessions/resolve?id='.length));
                if (id === OMP_ID || id === '01a209fe') {
                    return new Response(JSON.stringify({
                        session: { id: OMP_ID, name: 'Closed Peer OMP', harnessId: 'omp', model: 'claude-opus-5-5', isActive: false },
                    }), { status: 200 });
                }
                if (id === '01a2aaaa') {
                    return new Response(JSON.stringify({ error: 'ambiguous session id prefix', matches: [] }), { status: 409 });
                }
                return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
            }
            return new Response('{}', { status: 404 });
        },
        hosts: () => hosts,
        selfId: () => selfId,
        hostLabel: id => (id === HOST_UUID ? 'framework' : 'beelink'),
        matchRef: (ref, localHostId) => refs.match(ref, localHostId),
        selectSession: async (id, opts) => { selected.push({ id, host: opts.host }); },
        loadHostPrevious: async () => { },
        status: msg => { statuses.push(msg); },
        batchDelayMs: 5,
    });
    // Opening a closed peer ~sk1_ ref resolves on demand via /hosts/framework and selects it.
    await resolver.open(`framework/${OMP_ID}`, { contextHostId: selfId });
    assert.deepEqual(selected, [{ id: OMP_ID, host: HOST_UUID }]);
    assert.ok(state.findSession(OMP_ID, HOST_UUID), 'resolved closed session is ensured in sessionState');
    // Opening a short peer ref hits the ensured session without another network request.
    const countBefore = requests.length;
    await resolver.open('framework/01a209fe', { contextHostId: selfId });
    assert.equal(requests.length, countBefore);
    assert.equal(selected.length, 2);
    // Opening a missing session degrades cleanly with an error status and does not select.
    await resolver.open('framework/deadbeef', { contextHostId: selfId });
    assert.equal(selected.length, 2);
    assert.ok(statuses.some(s => s.includes('Session not found')));
    // Opening an ambiguous ref reports "Ambiguous ref", not "Session not found".
    statuses.length = 0;
    await resolver.open('framework/01a2aaaa', { contextHostId: selfId });
    assert.equal(selected.length, 2);
    assert.ok(statuses.some(s => s.includes('Ambiguous ref')));
    assert.equal(statuses.some(s => s.includes('Session not found')), false);
    resolver.dispose();
});
