import { ApiHttpError, sendJson } from './api-client';
import type { ApiRequest } from './api-client';
import type { BrowserHost } from './host-view';
import { record } from '../core/helper-values';
import { escapeHtml } from '../core/helper-format';

const ENABLED_KEY = 'pi-dish-push';

type HostPushState = { readonly state: 'on' | 'pending' } | { readonly state: 'failed'; readonly message: string };

interface InstallPrompt extends Event { prompt(): Promise<void> }

/** Why Web Push cannot work in this browser context, or null when it can. */
export function pushUnavailableReason(window: Window): string | null {
  if (!window.isSecureContext) return 'Notifications need a secure origin: open pi-dish over https (e.g. tailscale serve) or on localhost.';
  if (!('serviceWorker' in window.navigator) || !('PushManager' in window) || !('Notification' in window)) return 'This browser does not support Web Push.';
  return null;
}

function decodeKey(base64url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '='));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export interface PushNotifications {
  /** Registers the service worker and routes notification clicks. */
  mount(): void;
  /** Registers this device's subscription with hosts not yet registered on this page load. */
  sync(): Promise<void>;
  renderSettings(container: HTMLElement, signal: AbortSignal): void;
}

/**
 * Device-local Web Push. The subscription is created with the serving host's
 * VAPID key and registered with every host that advertises `push`; each host
 * then notifies for its own sessions. The service worker also makes the app
 * installable as a standalone window.
 */
export function createPushNotifications(options: {
  window: Window; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; request: ApiRequest;
  hosts: () => readonly Readonly<BrowserHost>[]; supports: (host: Readonly<BrowserHost>) => boolean; label: (host: Readonly<BrowserHost>) => string;
  open: (hostId: string, sessionId: string) => void; openVault: () => void; changed: () => void;
}): PushNotifications {
  const { window, storage } = options, navigator = window.navigator;
  const states = new Map<string, HostPushState>();
  let registration: Promise<ServiceWorkerRegistration> | null = null;
  let installPrompt: InstallPrompt | null = null;
  let syncing: Promise<void> | null = null;
  let resync = false;

  const pushHosts = () => options.hosts().filter(options.supports);
  const enabled = () => storage.getItem(ENABLED_KEY) === '1';
  // The DOM program types Notification as a global, not as a Window member.
  const notifications = () => (window as Window & typeof globalThis).Notification;

  async function serverKey(): Promise<string> {
    const self = options.hosts().find(host => host.self);
    if (!self) throw new Error('This host is not identified yet.');
    const response = await options.request(self, '/api/push');
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok || !record(data) || typeof data.publicKey !== 'string') throw new Error(`This host does not offer notifications (${response.status}).`);
    return data.publicKey;
  }

  /** The current subscription, replaced when it was made with another key. */
  async function subscription(publicKey: string): Promise<PushSubscription> {
    const reg = await registration!;
    const key = decodeKey(publicKey);
    const existing = await reg.pushManager.getSubscription();
    const current = existing?.options.applicationServerKey;
    if (existing && current && new Uint8Array(current).every((byte, i) => byte === key[i]) && current.byteLength === key.length) return existing;
    if (existing) await existing.unsubscribe();
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }

  async function syncHosts(): Promise<void> {
    const publicKey = await serverKey();
    const body = { subscription: (await subscription(publicKey)).toJSON(), publicKey };
    await Promise.all(pushHosts().map(async host => {
      if (states.get(host.key)?.state === 'on') return;
      states.set(host.key, { state: 'pending' });
      try {
        await sendJson(options.request, host, '/api/push/subscriptions', body);
        states.set(host.key, { state: 'on' });
      } catch (error) {
        states.set(host.key, { state: 'failed', message: error instanceof ApiHttpError || error instanceof Error ? error.message : String(error) });
      }
    }));
  }

  function sync(): Promise<void> {
    if (!enabled() || !registration || notifications().permission !== 'granted') return Promise.resolve();
    if (syncing) { resync = true; return syncing; }
    syncing = syncHosts()
      .catch(error => { for (const host of pushHosts()) if (!states.has(host.key)) states.set(host.key, { state: 'failed', message: error instanceof Error ? error.message : String(error) }); })
      .finally(() => {
        syncing = null; options.changed();
        if (resync) { resync = false; void sync(); }
      });
    return syncing;
  }

  async function enable(): Promise<void> {
    if (!registration) throw new Error('The service worker is not registered; reload pi-dish and try again.');
    const permission = await notifications().requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted.');
    storage.setItem(ENABLED_KEY, '1');
    states.clear();
    await sync();
  }

  async function disable(): Promise<void> {
    storage.removeItem(ENABLED_KEY);
    const existing = registration ? await (await registration).pushManager.getSubscription() : null;
    if (existing) {
      // Unreachable hosts keep a dead endpoint until their next push gets 410 and prunes it.
      await Promise.allSettled(pushHosts().map(host => sendJson(options.request, host, '/api/push/subscriptions', { endpoint: existing.endpoint }, 'DELETE')));
      await existing.unsubscribe();
    }
    states.clear();
    options.changed();
  }

  async function test(): Promise<string> {
    const existing = registration ? await (await registration).pushManager.getSubscription() : null;
    if (!existing) return 'Notifications are off.';
    const targets = pushHosts().filter(host => states.get(host.key)?.state === 'on');
    const results = await Promise.allSettled(targets.map(host => sendJson(options.request, host, '/api/push/test', { endpoint: existing.endpoint })));
    const failures = results.flatMap((result, i) => result.status === 'rejected'
      ? [`${options.label(targets[i])}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []);
    return failures.length ? failures.join(' ') : `Sent a test from ${targets.length} host${targets.length === 1 ? '' : 's'}.`;
  }

  function mount(): void {
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event as InstallPrompt; options.changed(); });
    window.addEventListener('appinstalled', () => { installPrompt = null; options.changed(); });
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', event => {
      const data: unknown = event.data;
      if (record(data) && data.type === 'pi-dish-open-session' && typeof data.hostId === 'string' && typeof data.sessionId === 'string') {
        options.open(data.hostId, data.sessionId);
      } else if (record(data) && data.type === 'pi-dish-open-vault') {
        options.openVault();
      }
    });
    registration = navigator.serviceWorker.register('sw.js');
    registration.then(() => sync(), error => { registration = null; console.warn('Service worker registration failed:', error); });
  }

  function renderSettings(container: HTMLElement, signal: AbortSignal): void {
    const unavailable = pushUnavailableReason(window);
    const on = enabled() && !unavailable && notifications().permission === 'granted';
    const rows = on ? pushHosts().map(host => {
      const entry = states.get(host.key);
      const text = !entry ? 'Not registered yet' : entry.state === 'failed' ? entry.message : entry.state === 'on' ? 'On' : 'Registering…';
      return `<li class="push-host${entry?.state === 'failed' ? ' failed' : ''}"><span>${escapeHtml(options.label(host))}</span><small>${escapeHtml(text)}</small></li>`;
    }).join('') : '';
    container.innerHTML = `<div class="preference-row push-row"><label><strong>Notifications</strong><small>Stored on this device. Each host notifies when one of its sessions finishes or waits for an answer, or when its vault listener needs an approval, unless pi-dish is focused.</small></label>
      <div class="push-controls">${unavailable ? '' : `<button class="btn-small" id="pushToggle">${on ? 'Turn off' : 'Turn on'}</button>${on ? '<button class="btn-small" id="pushTest">Send test</button>' : ''}`}${installPrompt ? '<button class="btn-small" id="pushInstall">Install app</button>' : ''}</div>
      ${rows ? `<ul class="push-hosts">${rows}</ul>` : ''}<small id="pushStatus">${unavailable ? escapeHtml(unavailable) : ''}</small></div>`;
    const status = container.querySelector<HTMLElement>('#pushStatus')!;
    const run = (button: HTMLButtonElement, pending: string, action: () => Promise<string | void>) => {
      button.addEventListener('click', async () => {
        button.disabled = true; status.textContent = pending;
        try { const message = await action(); if (!signal.aborted) status.textContent = message || ''; }
        catch (error) { if (!signal.aborted) status.textContent = error instanceof Error ? error.message : String(error); }
        finally { button.disabled = false; }
      }, { signal });
    };
    const toggle = container.querySelector<HTMLButtonElement>('#pushToggle');
    if (toggle) run(toggle, on ? 'Turning off…' : 'Turning on…', () => on ? disable() : enable());
    const testButton = container.querySelector<HTMLButtonElement>('#pushTest');
    if (testButton) run(testButton, 'Sending…', test);
    const install = container.querySelector<HTMLButtonElement>('#pushInstall');
    if (install) run(install, '', async () => { const prompt = installPrompt; installPrompt = null; await prompt?.prompt(); options.changed(); });
  }

  return { mount, sync, renderSettings };
}
