/**
 * Vault approvals (lib/vault-approvals.js): the request lifecycle the
 * listener polls, time-boxed grants, input validation, and the loopback
 * bridge's admission rules against a real server — including that the fleet
 * proxy can never carry a request into a peer's bridge, even when the peer is
 * reached over loopback and the caller holds the token.
 *
 * HOME points at a temp dir so ~/.pi/dish/{vault/bridge.token,settings.json} are per-run state.
 *
 * Run with: npm test
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { record, records } from './test-types.js';
import {
  GRANT_WINDOW_MS, LISTENER_STALE_MS, createVaultApprovals, createVaultHandlers, vaultPushPayload,
} from '../lib/vault-approvals';
import type { VaultApprovals, VaultRequest } from '../lib/vault-approvals';
import type { Request, Response } from 'express';
import type { Server } from 'node:http';

const originalHome = process.env.HOME;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-vault-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';

const T0 = Date.parse('2026-10-19T00:00:00Z');
const device = { name: 'desktop', fingerprint: 'ab'.repeat(16) };
const session = { ref: 'desktop/01a0a845', name: 'Htpc provision', host: 'desktop' };

function vault() {
  const clock = { now: T0 };
  const notified: VaultRequest[] = [];
  const instance = createVaultApprovals({ notify: request => notified.push(request), now: () => clock.now });
  return { instance, clock, notified };
}

let nextId = 0;
function create(instance: VaultApprovals, overrides: Record<string, unknown> = {}) {
  nextId += 1;
  return instance.createRequest({
    id: `request-${String(nextId).padStart(4, '0')}`, device, item: 'fleet-sudo-desktop', fields: ['password'],
    reason: 'install rocprofiler', session, expiresAt: T0 + 60_000, ...overrides,
  });
}

function created(instance: VaultApprovals, overrides: Record<string, unknown> = {}): VaultRequest {
  const result = create(instance, overrides);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
}

test('a request is pending until decided once; a second decision conflicts', () => {
  const { instance, notified } = vault();
  const approved = created(instance);
  assert.equal(approved.status, 'pending');
  assert.deepEqual(notified.map(request => request.id), [approved.id]);
  assert.deepEqual(instance.overview().pending.map(request => request.id), [approved.id]);

  const decision = instance.decide(approved.id, 'approve');
  assert.ok(decision.ok);
  assert.equal(decision.value.status, 'approved');
  assert.deepEqual(instance.decide(approved.id, 'deny'), { ok: false, status: 409, error: 'This request is already approved' });

  const denied = created(instance);
  assert.equal(instance.decide(denied.id, 'deny').ok, true);
  const overview = instance.overview();
  assert.deepEqual(overview.pending, []);
  assert.deepEqual(overview.recent.map(request => [request.id, request.status]).sort(), [[approved.id, 'approved'], [denied.id, 'denied']].sort());
  assert.deepEqual(instance.decide('request-none', 'approve'), { ok: false, status: 404, error: 'Unknown vault request' });
  assert.equal(instance.decide(denied.id, 'maybe').ok, false);
});

test('an undecided request expires at its deadline, and an abandoned one immediately', () => {
  const { instance, clock } = vault();
  const late = created(instance, { expiresAt: T0 + 5_000 });
  const abandoned = created(instance);
  clock.now = T0 + 5_000;
  assert.equal(record(instance.requestStatus(late.id)).ok, true);
  assert.equal(late.status, 'expired');
  assert.equal(instance.decide(late.id, 'approve').ok, false);
  instance.abandon(abandoned.id);
  assert.equal(abandoned.status, 'expired');
});

test('a request cannot outlive the ten-minute cap', () => {
  const { instance } = vault();
  const request = created(instance, { expiresAt: T0 + 60 * 60_000 });
  assert.equal(request.expiresAt, T0 + 10 * 60_000);
});

test('a window approves the same device, item, fields and session for fifteen minutes only', () => {
  const { instance, clock, notified } = vault();
  const first = created(instance);
  const decision = instance.decide(first.id, 'approve-window');
  assert.ok(decision.ok);
  const [grant] = instance.overview().grants;
  assert.equal(grant.expiresAt, T0 + GRANT_WINDOW_MS);

  const repeat = created(instance);
  assert.equal(repeat.status, 'approved');
  assert.equal(repeat.auto, true);
  assert.equal(repeat.grantId, grant.id);
  assert.equal(notified.length, 1, 'auto-approvals do not ring');

  assert.equal(created(instance, { fields: ['username', 'password'] }).status, 'pending');
  assert.equal(created(instance, { session: { ref: 'desktop/other' } }).status, 'pending');
  assert.equal(created(instance, { device: { name: 'framework', fingerprint: 'cd'.repeat(16) } }).status, 'pending');

  clock.now = T0 + GRANT_WINDOW_MS;
  assert.deepEqual(instance.overview().grants, []);
  assert.equal(created(instance, { expiresAt: clock.now + 60_000 }).status, 'pending');
});

test('revoking a window makes the next identical request ask again', () => {
  const { instance } = vault();
  instance.decide(created(instance).id, 'approve-window');
  const [grant] = instance.overview().grants;
  assert.equal(instance.revokeGrant(grant.id).ok, true);
  assert.equal(instance.revokeGrant(grant.id).ok, false);
  assert.equal(created(instance).status, 'pending');
});

test('malformed requests are refused before anything is pending', () => {
  const { instance, notified } = vault();
  const status = (overrides: Record<string, unknown>) => {
    const result = create(instance, overrides);
    return result.ok ? 201 : result.status;
  };
  assert.equal(status({ fields: ['password', 'password'] }), 400);
  assert.equal(status({ fields: ['ssn'] }), 400);
  assert.equal(status({ fields: [] }), 400);
  assert.equal(status({ item: '  ' }), 400);
  assert.equal(status({ expiresAt: T0 }), 400);
  assert.equal(status({ device: { name: 'x', fingerprint: 'not-hex' } }), 400);
  assert.equal(status({ session: { name: 'no ref' } }), 400);
  assert.equal(status({ reason: 'x'.repeat(501) }), 400);
  assert.equal(status({ id: 'short' }), 400);
  const accepted = created(instance, { session: undefined, reason: undefined });
  assert.equal(accepted.session, null);
  assert.equal(instance.createRequest({ id: accepted.id, device, item: 'x', fields: ['password'], expiresAt: T0 + 1000 }).ok, false);
  assert.equal(notified.length, 1);
});

test('fields are reported in canonical order', () => {
  const { instance } = vault();
  assert.deepEqual(created(instance, { fields: ['totp', 'username', 'password'] }).fields, ['username', 'password', 'totp']);
});

test('the listener reads as stale without a heartbeat for 45 seconds', () => {
  const { instance, clock } = vault();
  assert.equal(instance.overview().listener, null);
  assert.equal(instance.reportStatus({ state: 'unlocked' }).ok, false);
  assert.equal(instance.reportStatus({ state: 'ready', account: 'me@example.com', devices: [device] }).ok, true);
  assert.equal(instance.overview().listener?.stale, false);
  clock.now = T0 + LISTENER_STALE_MS + 1;
  assert.equal(instance.overview().listener?.stale, true);
});

test('the notification names the claimed session, the device and the item', () => {
  const { instance } = vault();
  const payload = vaultPushPayload(created(instance));
  assert.equal(payload.kind, 'vault');
  assert.equal(payload.body, 'Htpc provision on desktop wants fleet-sudo-desktop (password) — install rocprofiler');
  assert.equal(payload.tag, `vault:${payload.vaultRequestId}`);
  assert.equal(vaultPushPayload(created(instance, { session: null, reason: 'r'.repeat(400) })).body.length, 180);
});

test('the bridge refuses a peer that is not loopback even with the token', () => {
  const handlers = createVaultHandlers(vault().instance, () => 'secret-token');
  const outcome = (remoteAddress: string, header: string | undefined) => {
    let status = 0;
    let passed = false;
    const req = { socket: { remoteAddress }, get: () => header } as unknown as Request;
    const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
    handlers.bridgeGate(req, res, () => { passed = true; });
    return passed ? 'next' : status;
  };
  assert.equal(outcome('127.0.0.1', 'secret-token'), 'next');
  assert.equal(outcome('::ffff:127.0.0.1', 'secret-token'), 'next');
  assert.equal(outcome('100.70.163.97', 'secret-token'), 403);
  assert.equal(outcome('127.0.0.1', 'wrong-token!'), 403);
  assert.equal(outcome('127.0.0.1', undefined), 403);
});

test.describe('server routes', () => {
  const server: Server = require('../server.js');
  let base = '';
  let token = '';
  test.before(async () => {
    if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server lacks TCP address');
    base = `http://127.0.0.1:${address.port}`;
    // The peer is this same server, reached over loopback: the worst case for the bridge.
    fs.writeFileSync(path.join(tmpHome, '.pi', 'dish', 'settings.json'), JSON.stringify({ remotes: [{ name: 'peer', url: base }] }));
  });
  test.after(() => {
    server.close();
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  async function call(method: string, route: string, body?: unknown, bridge?: string) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (bridge !== undefined) headers['X-Pi-Dish-Vault-Bridge'] = bridge;
    const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    const json = response.headers.get('content-type')?.includes('application/json');
    return { status: response.status, body: text && json ? JSON.parse(text) as unknown : text || null };
  }

  test('the listener drives a request through approval over the bridge', async () => {
    assert.equal((await call('POST', '/api/vault/bridge/status', { state: 'ready', devices: [] })).status, 403);
    const tokenFile = path.join(tmpHome, '.pi', 'dish', 'vault', 'bridge.token');
    assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(tokenFile)).mode & 0o777, 0o700);
    token = fs.readFileSync(tokenFile, 'utf8').trim();

    assert.equal((await call('POST', '/api/vault/bridge/status', { state: 'ready', account: 'me@example.com', devices: [device] }, token)).status, 204);
    const id = 'bridge-request-1';
    const posted = await call('POST', '/api/vault/bridge/requests', {
      id, device, item: 'github.com', fields: ['username', 'password'], session, expiresAt: Date.now() + 60_000,
    }, token);
    assert.deepEqual(posted, { status: 201, body: { status: 'pending' } });

    const overview = record((await call('GET', '/api/vault')).body);
    assert.equal(record(overview.listener).state, 'ready');
    assert.deepEqual(records(overview.pending).map(request => request.id), [id]);

    assert.deepEqual((await call('GET', `/api/vault/bridge/requests/${id}`, undefined, token)).body, { status: 'pending' });
    const decided = await call('POST', `/api/vault/requests/${id}/decision`, { decision: 'approve' });
    assert.equal(decided.status, 200);
    assert.deepEqual((await call('GET', `/api/vault/bridge/requests/${id}`, undefined, token)).body, { status: 'approved' });
    assert.equal((await call('POST', `/api/vault/requests/${id}/decision`, { decision: 'deny' })).status, 409);
  });

  test('the fleet proxy never forwards into a bridge, even a loopback peer with the token', async () => {
    const proxied = await call('POST', '/hosts/peer/api/vault/bridge/status', { state: 'locked', devices: [] }, token);
    assert.equal(proxied.status, 404);
    assert.equal(record((await call('GET', '/hosts/peer/api/vault')).body).listener !== undefined, true, 'the browser routes still proxy');
  });
});
