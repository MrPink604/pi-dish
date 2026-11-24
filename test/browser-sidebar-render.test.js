// Generated test/tool from test/browser-sidebar-render.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openBotRegistry } = require('../lib/bot-registry');
const { createBotHandlers } = require('../lib/bot-handlers');
const context = (0, browser_vm_js_1.browserSandbox)();
const { renderSidebar } = context.PiDishBrowser;
function options(overrides = {}) {
    return { active: [], previous: [], selected: null, tab: 'all', view: 'workspace', query: '', queriedFor: '', scope: '', indexing: false,
        contextMetric: 'percent', pending: [], selectedSpawn: null, expanded: new Set(), collapsed: new Set(), pinned: [], roots: new Map(),
        closeConfirm: null, closeBusy: null, multiHost: false, hosts: [], bots: [], botRetireArmed: null, unread: () => false, hostChip: () => '', ...overrides };
}
function render(overrides = {}) {
    return renderSidebar(options(overrides));
}
/** Run `body` with the vm's clock frozen at `start`, movable by the callback. */
function withClock(start, body) {
    const previous = Reflect.get(context, 'Date');
    let now = start;
    Reflect.set(context, 'Date', class extends Date {
        constructor(...args) { super(args.length ? args[0] : now); }
        static now() { return now; }
    });
    try {
        return body(ms => { now += ms; });
    }
    finally {
        if (previous === undefined)
            Reflect.deleteProperty(context, 'Date');
        else
            Reflect.set(context, 'Date', previous);
    }
}
test('bots have their own group, each under its parent, and their sessions leave the ordinary list', () => {
    const bot = (id, name, parentId, status = 'active') => ({
        id, name, parentId, status, model: 'claude-code/claude-opus-5-5', thinking: null, identity: `You are ${name}.`, places: [], sessionId: `route-${id}`,
    });
    const html = render({
        active: [
            { id: 'route-fleet', name: 'Fleet', harnessId: 'bot', cwd: '/home', isActive: true },
            { id: 'route-hosts', name: 'Hosts', harnessId: 'bot', cwd: '/home', isActive: true },
            { id: 'work', name: 'Ordinary work', cwd: '/repo', isActive: true },
        ],
        bots: [bot('fleet', 'Fleet', null), bot('hosts', 'Hosts', 'fleet'), bot('disks', 'Disks', 'hosts'), bot('old', 'Old', null, 'retired')],
        botRetireArmed: 'disks',
    }).html;
    const group = html.slice(html.indexOf('bots-segment'), html.indexOf('Ordinary work'));
    assert.match(group, /\+ New bot/);
    assert.deepEqual([...group.matchAll(/data-bot-id="(\w+)" style="padding-left:(\d+)px"/g)].map(match => [match[1], match[2]]), [['fleet', '0'], ['hosts', '14'], ['disks', '28']], 'nested under their parents; a retired bot is not listed');
    assert.match(group, /Disks<\/span><span class="bot-item-state">not running<\/span><button class="bot-edit-btn" data-bot-id="disks"[^>]*>edit<\/button><button class="bot-retire-btn confirm"[^>]*>retire\?</);
    assert.match(group, /<button class="bot-edit-btn" data-bot-id="fleet"[^>]*>edit<\/button><button class="bot-retire-btn"/, 'a running bot\u2019s row has both');
    assert.equal(html.split('data-id="route-fleet"').length, 2, 'a bot\u2019s session row appears once, in the group');
});
test('bot workers (local, remote, and sub-bot workers) nest under their owning bot, collapsible with closed-worker drawer', () => {
    const HUB = '11111111-1111-4111-8111-111111111111';
    const PEER = '22222222-2222-4222-8222-222222222222';
    const bot = (id, name, parentId, status = 'active') => ({
        id, name, parentId, status, model: 'claude-code/claude-opus-5-5', thinking: null, identity: `You are ${name}.`, places: [], sessionId: `route-${id}`,
    });
    const hosts = [
        { hostId: HUB, self: true, label: 'beelink', state: 'reachable', key: 'self', color: '#1af', dot: '', hasCache: true },
        { hostId: PEER, self: false, label: 'tycho', state: 'reachable', key: 'tycho', color: '#fa1', dot: '', hasCache: true },
    ];
    const bots = [bot('fleet', 'Fleet', null), bot('hosts', 'Hosts', 'fleet'), bot('retired', 'Retired', null, 'retired')];
    const active = [
        { id: 'route-fleet', host: HUB, name: 'Fleet', harnessId: 'bot', cwd: '/home', isActive: true, lastActivity: 1000 },
        { id: 'route-hosts', host: HUB, name: 'Hosts', harnessId: 'bot', cwd: '/home', isActive: true, lastActivity: 900 },
        { id: 'w-local', host: HUB, name: 'local-check', cwd: '/repo/a', parentId: 'route-fleet', parentSource: 'pi-dish-launch', isActive: true, turnInProgress: true, lastActivity: 2000 },
        { id: 'w-remote', host: PEER, name: 'remote-gpu', cwd: '/srv/gpu', parentId: `${HUB}:route-fleet`, parentSource: 'pi-dish-launch', isActive: true, lastActivity: 1500 },
        { id: 'w-sub', host: HUB, name: 'sub-worker', cwd: '/etc', parentId: 'route-hosts', parentSource: 'pi-dish-launch', isActive: true, lastActivity: 1400 },
        { id: 'w-retired', host: HUB, name: 'orphan-worker', cwd: '/repo/a', parentId: 'route-retired', parentSource: 'pi-dish-launch', isActive: true, lastActivity: 1200 },
        { id: 'ordinary', host: HUB, name: 'Ordinary work', cwd: '/repo/b', isActive: true, lastActivity: 1100 },
        { id: 'peer-ordinary', host: PEER, name: 'Peer ordinary', cwd: '/srv/app', isActive: true, lastActivity: 1050 },
    ];
    const previous = [
        { id: 'w-closed', host: HUB, name: 'old-check', cwd: '/repo/a', parentId: 'route-fleet', parentSource: 'pi-dish-launch', isActive: false, lastActivity: 500 },
    ];
    const hostChip = (id) => id === PEER ? '<span class="host-chip">tycho</span>' : '';
    // Active tab: active local + remote workers nest under Fleet, sub-bot worker under Hosts; closed worker hidden;
    // retired bot's worker and ordinary sessions stay in the flat workspace list.
    const activeHtml = render({ active, previous, tab: 'active', multiHost: true, hosts, selfHostId: HUB, bots, hostChip }).html;
    const botsSeg = activeHtml.slice(activeHtml.indexOf('bots-segment'), activeHtml.indexOf('host-section'));
    const restSeg = activeHtml.slice(activeHtml.indexOf('host-section'));
    assert.match(botsSeg, /data-bot-toggle="fleet" aria-expanded="true"/);
    assert.match(botsSeg, /data-id="w-local"/);
    assert.match(botsSeg, /data-id="w-remote" data-host="22222222-2222-4222-8222-222222222222"/);
    assert.match(botsSeg, /<span class="host-chip">tycho<\/span>/, 'remote worker shows its host chip inside the Bots group');
    assert.match(botsSeg, /data-bot-children="hosts"[\s\S]*?data-id="w-sub"/, 'sub-bot owns its own worker');
    assert.ok(botsSeg.indexOf('data-id="w-local"') < botsSeg.indexOf('data-bot-id="hosts"'), 'a bot\u2019s own workers render directly under it before its sub-bots');
    assert.doesNotMatch(botsSeg, /w-closed/, 'closed workers stay off the Active tab');
    assert.doesNotMatch(restSeg, /w-local|w-remote|w-sub/, 'bot workers leave the workspace/host list');
    assert.match(restSeg, /data-id="ordinary"/);
    assert.match(restSeg, /data-id="peer-ordinary"/);
    assert.match(restSeg, /data-id="w-retired"/, 'a retired bot\u2019s worker stays visible in the ordinary list');
    // Collapsing Fleet hides its workers and sub-bots and aggregates the working pulse onto Fleet's row.
    const collapsedHtml = render({
        active, previous, tab: 'active', multiHost: true, hosts, selfHostId: HUB, bots, hostChip,
        collapsed: new Set(['bot:fleet']),
    }).html;
    assert.match(collapsedHtml, /data-bot-toggle="fleet" aria-expanded="false"/);
    assert.doesNotMatch(collapsedHtml, /data-id="w-local"|data-id="w-remote"|data-bot-id="hosts"|data-id="w-sub"/);
    assert.match(collapsedHtml, /data-id="route-fleet"[\s\S]*?session-item-status working/, 'collapsed bot surfaces child working status');
    // All tab: closed workers are tucked into a collapsed drawer by default and expand on demand.
    const allCollapsed = render({ active, previous, tab: 'all', multiHost: true, hosts, selfHostId: HUB, bots, hostChip }).html;
    assert.match(allCollapsed, /data-bot-closed="fleet" aria-expanded="false"[\s\S]*?1 closed worker/);
    assert.doesNotMatch(allCollapsed, /data-id="w-closed"/);
    const allExpanded = render({
        active, previous, tab: 'all', multiHost: true, hosts, selfHostId: HUB, bots, hostChip,
        expanded: new Set(['bot-closed:fleet']),
    }).html;
    assert.match(allExpanded, /data-bot-closed="fleet" aria-expanded="true"/);
    assert.match(allExpanded, /bot-closed-list[\s\S]*?data-id="w-closed"/);
    // Neither bots nor their active/closed workers render pin buttons (they live in the Bots group, never Pinned).
    const botsSegExpanded = allExpanded.slice(allExpanded.indexOf('bots-segment'), allExpanded.indexOf('host-section'));
    assert.doesNotMatch(botsSegExpanded, /session-pin-btn/, 'bots and bot workers never render a pin button');
    assert.match(restSeg, /data-id="ordinary"[\s\S]*?session-pin-btn/, 'ordinary sessions still render a pin button');
    // Even in search results, a bot session row never renders a pin button.
    const searchHtml = render({ active, previous, tab: 'all', query: 'Fleet', queriedFor: 'Fleet', multiHost: true, hosts, selfHostId: HUB, bots, hostChip }).html;
    const fleetRowMatch = /data-id="route-fleet"[\s\S]*?<\/div>\s*<div class="session-item-meta"/.exec(searchHtml);
    assert.ok(fleetRowMatch && !fleetRowMatch[0].includes('session-pin-btn'), 'bot row omits pin button in search results too');
    // Search flattens bots and workers into the ranked list.
    const searched = render({ active, previous, tab: 'all', multiHost: true, hosts, selfHostId: HUB, bots, query: 'gpu' }).html;
    assert.doesNotMatch(searched, /bots-segment/);
    assert.match(searched, /ranked-segment[\s\S]*?data-id="w-remote"/);
});
test('bots hosted on a peer group the peer bot sessions, peer workers, and self-local workers into Bots', () => {
    const DESKTOP = '33333333-3333-4333-8333-333333333333';
    const HUB = '11111111-1111-4111-8111-111111111111';
    const bot = (id, name, parentId = null) => ({
        id, name, parentId, status: 'active', model: 'claude-code/claude-opus-5-5', thinking: null, identity: name, places: [], sessionId: `route-${id}`,
    });
    const hosts = [
        { hostId: DESKTOP, self: true, label: 'desktop', capabilities: { sessions: true }, state: 'reachable', key: 'self', color: '#fa1', dot: '', hasCache: true },
        { hostId: HUB, self: false, label: 'beelink', capabilities: { sessions: true, bots: true }, state: 'reachable', key: HUB, color: '#1af', dot: '', hasCache: true },
    ];
    const bots = [bot('fleet', 'Fleet')];
    const active = [
        { id: 'route-fleet', host: HUB, name: 'Fleet', harnessId: 'bot', cwd: '/home', isActive: true, lastActivity: 1000 },
        { id: 'w-hub', host: HUB, name: 'hub-worker', cwd: '/repo', parentId: 'route-fleet', parentSource: 'pi-dish-launch', isActive: true, lastActivity: 2000 },
        { id: 'w-desktop', host: DESKTOP, name: 'desktop-worker', cwd: '/work', parentId: `${HUB}:route-fleet`, parentSource: 'pi-dish-launch', isActive: true, lastActivity: 1500 },
        { id: 'desktop-ordinary', host: DESKTOP, name: 'Desktop ordinary', cwd: '/work', isActive: true, lastActivity: 1200 },
        { id: 'hub-ordinary', host: HUB, name: 'Hub ordinary', cwd: '/repo', isActive: true, lastActivity: 1100 },
    ];
    const hostChip = (id) => id === HUB ? '<span class="host-chip">beelink</span>' : id === DESKTOP ? '<span class="host-chip">desktop</span>' : '';
    for (const overrides of [{ botsHostId: HUB, selfHostId: DESKTOP }, { selfHostId: DESKTOP }]) {
        const html = render({ active, tab: 'active', multiHost: true, hosts, bots, hostChip, ...overrides }).html;
        const botsSeg = html.slice(html.indexOf('bots-segment'), html.indexOf('host-section'));
        const restSeg = html.slice(html.indexOf('host-section'));
        assert.match(botsSeg, /data-id="route-fleet" data-host="11111111-1111-4111-8111-111111111111"/);
        assert.match(botsSeg, /data-id="w-hub" data-host="11111111-1111-4111-8111-111111111111"/);
        assert.match(botsSeg, /data-id="w-desktop" data-host="33333333-3333-4333-8333-333333333333"/);
        assert.doesNotMatch(restSeg, /route-fleet|w-hub|w-desktop/, 'bot and workers leave both host sections');
        assert.match(restSeg, /data-id="desktop-ordinary"/);
        assert.match(restSeg, /data-id="hub-ordinary"/);
    }
});
test('sidebar presents decoded optional fields and retains explicit null family boundaries', () => {
    const parent = { id: 'parent', name: '<parent>', cwd: '/repo' };
    const implicitChild = { id: 'child', parentId: 'parent', cwd: '/repo', name: 'implicit child' };
    const separated = { id: 'separate', parentId: 'parent', familyParentId: null, cwd: '/repo', name: 'separate child' };
    const { html } = render({ previous: [parent, implicitChild, separated] });
    assert.match(html, /&lt;parent&gt;/);
    assert.match(html, /separate child/);
    assert.doesNotMatch(html, /implicit child/);
    assert.match(html, /0%/);
    assert.equal(Object.hasOwn(implicitChild, 'familyParentId'), false);
    assert.equal(separated.familyParentId, null);
});
test('sidebar places the warning cache countdown immediately before context', () => {
    const cacheExpiry = { refreshedAt: Date.now(), expiresAt: Date.now() + 4 * 60_000,
        retentionMs: 5 * 60_000, retention: '5m', basis: 'fixed', identity: '' };
    const { html } = render({ previous: [{ id: 'cached', name: 'Cached', cwd: '/repo',
                contextPercent: 42, cacheExpiry }] });
    assert.match(html, /session-item-cache warning[^>]*>~4m<\/span>/);
    assert.ok(html.indexOf('session-item-cache') < html.indexOf('session-item-context'), 'cache countdown precedes context utilization');
});
test('sidebar replaces an expired countdown with the cold-cache glyph', () => {
    const cacheExpiry = { refreshedAt: Date.now() - 6 * 60_000, expiresAt: Date.now() - 60_000,
        retentionMs: 5 * 60_000, retention: '5m', basis: 'fixed', identity: '' };
    const { html } = render({ previous: [{ id: 'cold', name: 'Cold', cwd: '/repo',
                contextPercent: 42, cacheExpiry }] });
    assert.match(html, /session-item-cache cold[^>]*title="Cache likely cold · 5m retention"[^>]*aria-label="Cache likely cold · 5m retention"[^>]*>❄<\/span>/);
    assert.doesNotMatch(html, /&lt;1m/);
});
test('host-qualified workspace collapse and family status stay independent for identical ids and paths', () => {
    const hosts = ['self', 'peer'].map(hostId => ({ hostId, label: hostId, state: 'reachable', key: hostId, color: '#abc', dot: '', hasCache: true }));
    const active = ['self', 'peer'].flatMap(host => [{ id: 'parent', host, cwd: '/repo', name: host + ' parent', isActive: true },
        { id: 'child', host, cwd: '/repo', name: host + ' child', parentId: 'parent', isActive: true, turnInProgress: host === 'peer' }]);
    const { html, count } = render({ active, hosts, multiHost: true, collapsed: new Set(['self /repo']), selected: active[2] });
    assert.equal(count, 4);
    assert.match(html, /data-cwd="self \/repo"/);
    assert.doesNotMatch(html, /self parent/);
    assert.match(html, /peer parent/);
    assert.match(html, /Session family working/);
    assert.match(html, /session-item active/);
    assert.doesNotMatch(html, /peer child/);
});
test('sidebar shows the asking bubble ahead of the working pulse', () => {
    const active = [{ id: 'blocked', name: 'Blocked', cwd: '/repo', isActive: true, askPending: true, turnInProgress: true },
        { id: 'busy', name: 'Busy', cwd: '/repo', isActive: true, turnInProgress: true }];
    const { html } = render({ active });
    assert.match(html, /data-id="blocked"[\s\S]*?session-item-status asking" title="Waiting for an answer to a question">\?</);
    assert.doesNotMatch(html, /data-id="blocked"[\s\S]*?session-item-status working[\s\S]*?data-id="busy"/);
    assert.match(html, /data-id="busy"[\s\S]*?session-item-status working/);
});
test('collapsed family aggregates a blocked child into the asking bubble', () => {
    const active = [{ id: 'parent', name: 'Parent', cwd: '/repo', isActive: true },
        { id: 'child', name: 'Child', cwd: '/repo', parentId: 'parent', isActive: true, askPending: true }];
    const { html } = render({ active });
    assert.doesNotMatch(html, />Child</);
    assert.match(html, /session-item-status asking/);
});
test('server content search stays authoritative while scopes and automation remain visible in audit notes', () => {
    const previous = [{ id: 'match', name: '<b>content match</b>', cwd: '/repo', searchScore: 12, searchSnippet: 'needle <img>', routine: '' },
        { id: 'auto', name: 'robot', routine: 'daily' }];
    const result = render({ previous, query: 'needle', queriedFor: 'needle' });
    assert.match(result.html, /&lt;b&gt;content match&lt;\/b&gt;/);
    assert.match(result.html, /&lt;img&gt;/);
    assert.match(result.html, /1 automation run hidden/);
    assert.doesNotMatch(result.html, /robot/);
    const scoped = render({ previous, query: 'needle', queriedFor: 'needle', scope: 'name:absent' });
    assert.match(scoped.html, /1 hidden by scopes/);
});
test('sidebar chips a private session and rebuilds when privacy changes', () => {
    const row = (isPrivate) => ({ id: 's', name: 'Session', cwd: '/repo', private: isPrivate });
    const memo = {};
    const plain = renderSidebar(options({ previous: [row()] }), memo);
    assert.doesNotMatch(plain.html, /private-chip/);
    const secret = renderSidebar(options({ previous: [row(true)] }), memo);
    assert.notEqual(secret, plain, 'a privacy change rebuilds the projection');
    assert.match(secret.html, /<span class="private-chip"[^>]*>private<\/span>/);
    assert.equal(renderSidebar(options({ previous: [row(true)] }), memo), secret);
});
test('debounced ranking preserves metadata tie order under equal stale server scores', () => {
    const previous = [
        { id: 'metadata', name: 'Other', cwd: '/work', searchScore: 10, lastActivity: 1000 },
        { id: 'named', name: 'Work', cwd: '/repo', searchScore: 10, lastActivity: 1000 },
        { id: 'content', name: 'Content only', cwd: '/repo', searchScore: 20, lastActivity: 1000 },
    ];
    const interim = render({ previous, query: 'work', queriedFor: 'old' }).html;
    assert.ok(interim.indexOf('data-id="named"') < interim.indexOf('data-id="metadata"'));
    assert.doesNotMatch(interim, /data-id="content"/);
    const authoritative = render({ previous, query: 'work', queriedFor: 'work' }).html;
    assert.ok(authoritative.indexOf('data-id="content"') < authoritative.indexOf('data-id="metadata"'));
    assert.ok(authoritative.indexOf('data-id="metadata"') < authoritative.indexOf('data-id="named"'));
});
test('an unchanged poll reuses the sidebar projection while semantic changes rebuild it', () => {
    const memo = {};
    const first = renderSidebar(options(), memo);
    assert.equal(renderSidebar(options(), memo), first, 'equal inputs reuse the built projection');
    const renamed = renderSidebar(options({ previous: [{ id: 'a', name: 'Renamed', cwd: '/repo' }] }), memo);
    assert.notEqual(renamed, first, 'a renamed session rebuilds');
    assert.match(renamed.html, /Renamed/);
    assert.equal(renderSidebar(options({ previous: [{ id: 'a', name: 'Renamed', cwd: '/repo' }] }), memo), renamed);
});
test('unread, selection, pins, host health and query state invalidate the reused projection', () => {
    const memo = {};
    const row = { id: 'a', name: 'Alpha', cwd: '/repo', isActive: false };
    const idle = renderSidebar(options({ active: [row] }), memo);
    const unread = renderSidebar(options({ active: [row], unread: () => true }), memo);
    assert.notEqual(unread, idle);
    assert.match(unread.html, /session-item-status unread/);
    const selected = renderSidebar(options({ active: [row], selected: row }), memo);
    assert.notEqual(selected, unread);
    assert.match(selected.html, /session-item active/);
    const pinned = renderSidebar(options({ active: [row], pinned: ['a'] }), memo);
    assert.notEqual(pinned, selected);
    assert.match(pinned.html, /pinned-header/);
    const host = { hostId: 'peer', label: 'Peer', state: 'reachable', key: 'peer', color: '#abc', dot: '', hasCache: true };
    const peer = { id: 'p', name: 'Peer root', cwd: '/repo', host: 'peer', isActive: true, lastActivity: 1 };
    const online = renderSidebar(options({ active: [peer], multiHost: true, hosts: [host] }), memo);
    const offline = renderSidebar(options({ active: [peer], multiHost: true, hosts: [{ ...host, state: 'backoff' }] }), memo);
    assert.notEqual(offline, online);
    assert.match(offline.html, /host-section offline/);
    const searched = renderSidebar(options({ active: [peer], multiHost: true, hosts: [host], query: 'peer' }), memo);
    assert.notEqual(searched, offline);
    assert.match(searched.html, /ranked-segment/);
});
test('relative-time labels roll with the clock while a poll inside their bucket reuses the projection', () => {
    withClock(1_700_000_000_000, advance => {
        const memo = {};
        const lastActivity = 1_700_000_000_000 - 90_000;
        const at = () => options({ active: [{ id: 'a', name: 'Alpha', cwd: '/repo', isActive: true, lastActivity }] });
        const first = renderSidebar(at(), memo);
        assert.match(first.html, /1m ago/);
        advance(5_000);
        assert.equal(renderSidebar(at(), memo), first, 'an unchanged poll inside the minute reuses');
        advance(55_000);
        const rolled = renderSidebar(at(), memo);
        assert.notEqual(rolled, first, 'the next minute rebuilds the label');
        assert.match(rolled.html, /2m ago/);
    });
});
test('the cache countdown rolls its minute while sub-minute polls reuse the projection', () => {
    withClock(1_700_000_000_000, advance => {
        const memo = {};
        const cacheExpiry = { refreshedAt: 1_700_000_000_000, expiresAt: 1_700_000_000_000 + 4 * 60_000 + 20_000,
            retentionMs: 5 * 60_000, retention: '5m', basis: 'fixed' };
        const at = () => options({ active: [{ id: 'a', name: 'Alpha', cwd: '/repo', cacheExpiry: { ...cacheExpiry } }] });
        const first = renderSidebar(at(), memo);
        assert.match(first.html, /~5m/);
        advance(10_000);
        assert.equal(renderSidebar(at(), memo), first, 'a sub-minute countdown tick reuses');
        advance(50_000);
        assert.notEqual(renderSidebar(at(), memo), first, 'the countdown minute rolls');
    });
});
test('the sidebar without a memo still builds an independent projection', () => {
    assert.notEqual(render(), render());
});
test('the user moves a top-level bot under another: its parent, family, room and sidebar place change, and undo moves it back', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bots-'));
    const registry = openBotRegistry(path.join(dir, 'bots.sqlite'));
    t.after(() => { registry.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    const handlers = createBotHandlers(() => registry, {
        route: id => `route-${id}`, start: async () => { }, stop: async () => { }, deliver: async () => false,
        state: () => ({ running: false, lastTurnAt: null }),
    });
    const call = async (handler, params, body = {}) => {
        let status = 200;
        let sent = {};
        const res = { status(code) { status = code; return res; }, json(value) { sent = value; return res; } };
        await handler({ params, body }, res, () => { });
        return { status, body: sent };
    };
    const make = (name, parentId = null) => registry.create({ name, identity: `You are ${name}.`, parentId }, { actor: 'user' });
    const fleet = registry.seedFleet();
    const backups = make('Backups', fleet.id);
    const chief = make('Chief');
    registry.post({ family: fleet.id, from: fleet.id, to: [backups.id], text: 'before the move', chain: 'c1', hop: 1 });
    registry.post({ family: chief.id, from: chief.id, to: [], text: 'chief alone', chain: 'c2', hop: 1 });
    /** The Bots group as the sidebar draws it from `/api/bots`: each bot's name and depth. */
    const sidebar = async () => {
        const { html } = render({ bots: (await call(handlers.list, {})).body.bots });
        return [...html.matchAll(/class="bot-node" data-bot-id="([^"]+)" style="padding-left:(\d+)px"/g)]
            .map(match => `${registry.get(match[1]).name}@${Number(match[2]) / 14}`);
    };
    assert.deepEqual(await sidebar(), ['Fleet@0', 'Backups@1', 'Chief@0']);
    const moved = await call(handlers.update, { id: fleet.id }, { parentId: chief.id });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.bot.parentId, chief.id);
    assert.deepEqual(registry.lineage(backups.id), [backups.id, fleet.id, chief.id], 'its sub-bots come with it');
    assert.deepEqual(registry.family(chief.id).map(row => row.name), ['Fleet', 'Backups', 'Chief']);
    assert.deepEqual(registry.family(fleet.id), [], 'Fleet heads no family of its own now');
    const revision = registry.revisions(fleet.id).at(-1);
    assert.deepEqual([revision.actor, revision.fields, revision.before?.parentId, revision.after.parentId], ['user', ['parentId'], null, chief.id]);
    assert.deepEqual(await sidebar(), ['Chief@0', 'Fleet@1', 'Backups@2']);
    // Its family's room history comes with it: the room of the family it joined holds both.
    assert.deepEqual(registry.room(chief.id, 10).map(message => message.text), ['before the move', 'chief alone']);
    const undone = await call(handlers.restore, { id: fleet.id }, { revision: revision.revision - 1, fields: ['parentId'] });
    assert.equal(undone.status, 200);
    assert.equal(registry.get(fleet.id).parentId, null);
    assert.deepEqual(registry.revisions(fleet.id).at(-1).fields, ['parentId']);
    assert.deepEqual(await sidebar(), ['Fleet@0', 'Backups@1', 'Chief@0']);
    assert.deepEqual(registry.room(fleet.id, 10).map(message => message.text), ['before the move'], 'and leaves with it');
    assert.deepEqual(registry.room(chief.id, 10).map(message => message.text), ['chief alone']);
    // The user cannot make a cycle or pass the nesting limit either.
    const cycle = await call(handlers.update, { id: fleet.id }, { parentId: backups.id });
    assert.deepEqual([cycle.status, cycle.body.error], [400, 'Refused: Backups is one of Fleet\'s own sub-bots, so Fleet cannot move under it.']);
    const self = await call(handlers.update, { id: fleet.id }, { parentId: fleet.id });
    assert.match(String(self.body.error), /a bot cannot be its own parent/);
    const a = make('A', chief.id);
    const b = make('B', a.id);
    const deep = await call(handlers.update, { id: fleet.id }, { parentId: b.id });
    assert.deepEqual([deep.status, deep.body.error], [400, 'Refused: B is 3 levels deep, so Fleet and its sub-bots would reach level 5 under it, and bots nest at most 4 levels.']);
    assert.equal((await call(handlers.update, { id: fleet.id }, { parentId: a.id })).status, 200, 'one level higher fits');
});
test('cross-cwd and cross-host children nest once under their parent with host/cwd hints, falling back when parent host is offline', () => {
    const HUB = '11111111-1111-4111-8111-111111111111';
    const PEER = '22222222-2222-4222-8222-222222222222';
    const hosts = [
        { hostId: HUB, self: true, label: 'beelink', state: 'reachable', key: 'self', color: '#1af', dot: '', hasCache: true },
        { hostId: PEER, self: false, label: 'tycho', state: 'reachable', key: 'tycho', color: '#fa1', dot: '', hasCache: true },
    ];
    const hostChip = (id) => id === PEER ? '<span class="host-chip">tycho</span>' : id === HUB ? '<span class="host-chip">beelink</span>' : '';
    const active = [
        { id: 'orch', host: HUB, name: 'ORCH', cwd: '/orch', isActive: true, lastActivity: 1000 },
        { id: 'w-cwd', host: HUB, name: 'Repo Worker', cwd: '/repo', parentId: 'orch', isActive: true, lastActivity: 2000 },
        { id: 'w-sub', host: HUB, name: 'Same CWD Sub', cwd: '/repo', parentId: 'w-cwd', isActive: true, lastActivity: 2500 },
        { id: 'w-remote', host: PEER, name: 'GPU Worker', cwd: '/srv/gpu', parentId: `${HUB}:w-cwd`, isActive: true, lastActivity: 3000 },
        { id: 'w-deep', host: PEER, name: 'Deep Child', cwd: '/srv/gpu', parentId: 'w-remote', isActive: true, lastActivity: 3500 },
        { id: 'w-deepest', host: PEER, name: 'Deepest Leaf', cwd: '/srv/gpu', parentId: 'w-deep', isActive: true, lastActivity: 4000 },
    ];
    const expanded = new Set([`${HUB} orch`, `${HUB} w-cwd`, `${PEER} w-remote`, `${PEER} w-deep`]);
    const onlineHtml = render({ active, tab: 'active', view: 'workspace', multiHost: true, hosts, expanded, hostChip }).html;
    assert.equal(onlineHtml.split('data-id="w-cwd"').length, 2, 'cross-cwd child appears once');
    assert.equal(onlineHtml.split('data-id="w-remote"').length, 2, 'cross-host child appears once');
    assert.doesNotMatch(onlineHtml, /data-cwd="[^"]*\/repo"/, 'cross-cwd child does not create its own workspace group');
    assert.doesNotMatch(onlineHtml, /data-host-section="host:tycho"/, 'cross-host child leaves peer section empty when nested under hub');
    // Cross-cwd child gets cwd hint (no host chip); cross-host child gets both host chip and cwd hint; depth 4 gets depth-capped + L4 badge.
    const wCwdCard = onlineHtml.slice(onlineHtml.indexOf('data-id="w-cwd"'), onlineHtml.indexOf('data-id="w-remote"'));
    assert.match(wCwdCard, /session-item-cwd">\/repo<\/span>/);
    assert.doesNotMatch(wCwdCard, /host-chip/);
    const wRemoteCard = onlineHtml.slice(onlineHtml.indexOf('data-id="w-remote"'), onlineHtml.indexOf('data-id="w-deep"'));
    assert.match(wRemoteCard, /<span class="host-chip">tycho<\/span>/);
    assert.match(wRemoteCard, /session-item-cwd">\/srv\/gpu<\/span>/);
    assert.match(onlineHtml, /session-family-children depth-capped[\s\S]*?data-id="w-deepest"[\s\S]*?session-depth-badge[^>]*>L4<\/span>/, 'depth 4 keeps depth-3 indent and shows an L4 marker');
    // When HUB is offline (no HUB sessions loaded), PEER's worker+leaf stay visible in PEER's host section.
    const offlineHosts = [
        { ...hosts[0], state: 'backoff', hasCache: false },
        hosts[1],
    ];
    const offlineHtml = render({
        active: active.filter(s => s.host === PEER), tab: 'active', view: 'workspace', multiHost: true,
        hosts: offlineHosts, expanded: new Set([`${PEER} w-remote`]), hostChip,
    }).html;
    assert.match(offlineHtml, /data-host-section="host:tycho"[\s\S]*?data-id="w-remote"[\s\S]*?data-id="w-deep"/);
});
test('4-level bot hierarchy caps worker indent at depth 3 and keeps cross-cwd/cross-host worker descendants under the bot', () => {
    const HUB = '11111111-1111-4111-8111-111111111111';
    const PEER = '22222222-2222-4222-8222-222222222222';
    const bot = (id, name, parentId) => ({
        id, name, parentId, status: 'active', model: 'claude-code/claude-opus-5-5', thinking: null, identity: name, places: [], sessionId: `route-${id}`,
    });
    const bots = [bot('b1', 'RootBot', null), bot('b2', 'SubBot', 'b1'), bot('b3', 'SubSubBot', 'b2'), bot('b4', 'LeafBot', 'b3')];
    const hosts = [
        { hostId: HUB, self: true, label: 'beelink', state: 'reachable', key: 'self', color: '#1af', dot: '', hasCache: true },
        { hostId: PEER, self: false, label: 'tycho', state: 'reachable', key: 'tycho', color: '#fa1', dot: '', hasCache: true },
    ];
    const hostChip = (id) => id === PEER ? '<span class="host-chip">tycho</span>' : '';
    const active = [
        { id: 'route-b1', host: HUB, name: 'RootBot', harnessId: 'bot', cwd: '/home', isActive: true },
        { id: 'route-b2', host: HUB, name: 'SubBot', harnessId: 'bot', cwd: '/home', isActive: true },
        { id: 'route-b3', host: HUB, name: 'SubSubBot', harnessId: 'bot', cwd: '/home', isActive: true },
        { id: 'route-b4', host: HUB, name: 'LeafBot', harnessId: 'bot', cwd: '/home', isActive: true },
        { id: 'w4', host: HUB, name: 'Level4 Worker', cwd: '/repo', parentId: 'route-b4', isActive: true },
        { id: 'w4-sub', host: PEER, name: 'Remote Grandchild', cwd: '/srv/other', parentId: `${HUB}:w4`, isActive: true },
    ];
    const html = render({
        active, tab: 'active', multiHost: true, hosts, selfHostId: HUB, bots, hostChip,
        expanded: new Set([`${HUB} w4`]),
    }).html;
    assert.deepEqual([...html.matchAll(/data-bot-id="(\w+)" style="padding-left:(\d+)px"/g)].map(m => [m[1], m[2]]), [['b1', '0'], ['b2', '14'], ['b3', '28'], ['b4', '42']], '4 bot levels render at 0/14/28/42px');
    assert.match(html, /bot-worker-node" style="padding-left:42px"[\s\S]*?data-id="w4"[\s\S]*?session-depth-badge[^>]*>L4<\/span>/, 'worker under level-4 bot caps indent at 42px and shows L4 badge');
    assert.match(html, /session-family-children depth-capped[\s\S]*?data-id="w4-sub"[\s\S]*?session-depth-badge[^>]*>L5<\/span>[\s\S]*?<span class="host-chip">tycho<\/span>/, 'cross-host, cross-cwd child of bot worker stays inside Bots with L5 badge and host chip');
    assert.doesNotMatch(html, /host-section/, 'nothing leaks out of the Bots section');
});
test('Active tab renders closed intermediate parents as dimmed bridge rows instead of orphaning active grandchildren', () => {
    const HUB = '11111111-1111-4111-8111-111111111111';
    const bot = { id: 'fleet', name: 'Fleet', parentId: null, status: 'active', model: 'claude-code/claude-opus-5-5', thinking: null, identity: 'Fleet', places: [], sessionId: 'route-fleet' };
    const active = [
        { id: 'route-fleet', host: HUB, name: 'Fleet', harnessId: 'bot', cwd: '/home', isActive: true, lastActivity: 1000 },
        { id: 'bot-leaf', host: HUB, name: 'Bot Active Leaf', cwd: '/repo', parentId: 'bot-mid', isActive: true, lastActivity: 4000 },
        { id: 'orch', host: HUB, name: 'ORCH', cwd: '/orch', isActive: true, lastActivity: 1000 },
        { id: 'orch-leaf', host: HUB, name: 'ORCH Active Leaf', cwd: '/repo', parentId: 'orch-mid', isActive: true, lastActivity: 5000 },
    ];
    const previous = [
        { id: 'bot-mid', host: HUB, name: 'Closed Bot Worker', cwd: '/repo', parentId: 'route-fleet', isActive: false, lastActivity: 2000 },
        { id: 'orch-mid', host: HUB, name: 'Closed Middle', cwd: '/mid', parentId: 'orch', isActive: false, lastActivity: 2000 },
        { id: 'unused-closed', host: HUB, name: 'Unrelated Closed', cwd: '/orch', parentId: 'orch', isActive: false, lastActivity: 1500 },
    ];
    const html = render({
        active, previous, tab: 'active', selfHostId: HUB, bots: [bot],
        expanded: new Set([`${HUB} orch`]),
    }).html;
    assert.match(html, /data-bot-children="fleet"[\s\S]*?session-item-bridge" data-id="bot-mid"[\s\S]*?session-bridge-chip[^>]*>closed<\/span>[\s\S]*?data-id="bot-leaf"/, 'closed worker bridges active grandchild under its bot on Active tab');
    assert.match(html, /data-id="orch"[\s\S]*?session-item-bridge" data-id="orch-mid"[\s\S]*?data-id="orch-leaf"/, 'closed intermediate parent bridges active grandchild under ORCH on Active tab');
    assert.doesNotMatch(html, /unused-closed/, 'closed leaves without active descendants stay hidden on Active');
});
test('collapsed host, workspace, and date group headers bubble up askPending ahead of working and unread', () => {
    const HUB = '11111111-1111-4111-8111-111111111111';
    const hosts = [{ hostId: HUB, self: true, label: 'beelink', state: 'reachable', key: 'self', color: '#1af', dot: '', hasCache: true }];
    const active = [
        { id: 's1', host: HUB, name: 'Asking', cwd: '/repo', isActive: true, askPending: true, turnInProgress: true, lastActivity: Date.now() },
    ];
    const collapsedHost = render({ active, multiHost: true, hosts, collapsed: new Set(['host:self']) }).html;
    assert.match(collapsedHost, /host-section-header[\s\S]*?session-item-status asking"[^>]*>\?<\/span>/);
    const collapsedWs = render({ active, multiHost: true, hosts, collapsed: new Set([`${HUB} /repo`]) }).html;
    assert.match(collapsedWs, /workspace-group-header[\s\S]*?session-item-status asking"[^>]*>\?<\/span>/);
    const collapsedDate = render({ active, view: 'recent', collapsed: new Set(['date:today']) }).html;
    assert.match(collapsedDate, /workspace-group-header[\s\S]*?session-item-status asking"[^>]*>\?<\/span>/);
});
test('bot cycles and self-parents break into visible roots without dropping claimed workers, and deep bot chains stay fast', () => {
    const bot = (id, name, parentId) => ({
        id, name, parentId, status: 'active', model: 'claude-code/claude-opus-5-5', thinking: null, identity: name, places: [], sessionId: `route-${id}`,
    });
    const bots = [bot('a', 'BotA', 'b'), bot('b', 'BotB', 'a'), bot('self', 'SelfBot', 'self'), bot('child', 'ChildOfA', 'a')];
    const active = [
        { id: 'route-a', name: 'BotA', harnessId: 'bot', cwd: '/home', isActive: true },
        { id: 'route-b', name: 'BotB', harnessId: 'bot', cwd: '/home', isActive: true },
        { id: 'route-self', name: 'SelfBot', harnessId: 'bot', cwd: '/home', isActive: true },
        { id: 'w-a', name: 'WorkerA', cwd: '/repo', parentId: 'route-a', isActive: true },
        { id: 'w-self', name: 'WorkerSelf', cwd: '/repo', parentId: 'route-self', isActive: true },
    ];
    const html = render({ active, tab: 'active', bots }).html;
    assert.match(html, /data-bot-id="a" style="padding-left:0px"/);
    assert.match(html, /data-bot-id="b" style="padding-left:0px"/);
    assert.match(html, /data-bot-id="self" style="padding-left:0px"/);
    assert.match(html, /data-bot-id="child" style="padding-left:14px"/);
    assert.match(html, /data-id="w-a"/);
    assert.match(html, /data-id="w-self"/);
    // S6: saved scopes filter bridge rows too, leaving the active leaf visible rather than bypassing the scope.
    const scopedHtml = render({
        active: [
            { id: 'orch', name: 'ORCH', cwd: '/orch', isActive: true, lastActivity: 1000 },
            { id: 'leaf', name: 'Active Leaf', cwd: '/repo', parentId: 'mid', isActive: true, lastActivity: 3000 },
        ],
        previous: [
            { id: 'mid', name: 'Secret Mid', cwd: '/secret', parentId: 'orch', isActive: false, lastActivity: 2000 },
        ],
        tab: 'active',
        scope: '-secret',
    }).html;
    assert.doesNotMatch(scopedHtml, /data-id="mid"/, 'bridge row rejected by saved scope is not rendered');
    assert.match(scopedHtml, /data-id="leaf"/, 'active leaf stays visible when its bridge is filtered out');
    // B3: 2,000-deep worker chain under a bot resolves iteratively in linear time.
    const deepBot = [bot('root', 'RootBot', null)];
    const deepSessions = [{ id: 'route-root', name: 'RootBot', harnessId: 'bot', cwd: '/home', isActive: true, lastActivity: 1 }];
    for (let i = 0; i < 2000; i++) {
        deepSessions.push({
            id: `w-${i}`, name: `W${i}`, harnessId: 'pi', cwd: '/repo',
            parentId: i === 0 ? 'route-root' : `w-${i - 1}`, isActive: true, lastActivity: i + 2,
        });
    }
    const start = Date.now();
    const rendered = render({ active: deepSessions, tab: 'active', bots: deepBot }).html;
    const elapsed = Date.now() - start;
    assert.match(rendered, /data-bot-toggle="root"[\s\S]*?<small>2000<\/small>/);
    assert.ok(elapsed < 150, `expected linear-time 2,000-node bot tree render, took ${elapsed}ms`);
});
