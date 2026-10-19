// Service worker: shows Web Push notifications and routes their clicks back to
// the app. It deliberately has no fetch handler and no cache: pi-dish ships
// regenerated scripts on every upgrade, and a cached app shell would serve a
// stale UI against a newer server.

// The browser program types the DOM; only the worker surface used here is declared.
interface WorkerClient { readonly url: string; readonly focused: boolean; readonly visibilityState: DocumentVisibilityState; focus(): Promise<WorkerClient>; postMessage(message: unknown): void }
interface ExtendableEvent extends Event { waitUntil(promise: Promise<unknown>): void }
interface PushEvent extends ExtendableEvent { readonly data: { json(): unknown } | null }
interface NotificationClickEvent extends ExtendableEvent { readonly notification: Notification }
interface WorkerScope {
  readonly registration: ServiceWorkerRegistration;
  readonly location: Location;
  readonly clients: {
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly WorkerClient[]>;
    openWindow(url: string): Promise<WorkerClient | null>;
    claim(): Promise<void>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'push', listener: (event: PushEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: NotificationClickEvent) => void): void;
}

const worker = self as unknown as WorkerScope;

interface PushMessage { kind: string; title: string; body: string; tag: string; hostId: string; sessionId: string | null; vaultRequestId: string | null }

function decode(value: unknown): PushMessage | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.title !== 'string' || typeof data.body !== 'string' || typeof data.tag !== 'string' || typeof data.hostId !== 'string') return null;
  return {
    kind: typeof data.kind === 'string' ? data.kind : '', title: data.title, body: data.body, tag: data.tag, hostId: data.hostId,
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : null,
    vaultRequestId: typeof data.vaultRequestId === 'string' ? data.vaultRequestId : null,
  };
}

worker.addEventListener('install', event => event.waitUntil(worker.skipWaiting()));
worker.addEventListener('activate', event => event.waitUntil(worker.clients.claim()));

worker.addEventListener('push', event => {
  let message: PushMessage | null = null;
  try { message = decode(event.data?.json()); } catch {}
  if (!message) return;
  const shown = message;
  event.waitUntil((async () => {
    // Someone is looking at pi-dish right now; its own UI already shows activity.
    // A test is explicitly requested from that UI, so it always shows.
    const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (shown.kind !== 'test' && windows.some(client => client.focused && client.visibilityState === 'visible')) return;
    await worker.registration.showNotification(shown.title, {
      body: shown.body, tag: shown.tag, icon: 'icon-192.png', badge: 'badge-96.png',
      data: { hostId: shown.hostId, sessionId: shown.sessionId, vaultRequestId: shown.vaultRequestId },
    });
  })());
});

worker.addEventListener('notificationclick', event => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const target = data && typeof data === 'object' ? data as { hostId?: unknown; sessionId?: unknown; vaultRequestId?: unknown } : {};
  // A vault request opens its requesting session (or the vault panel); a session notification opens its session.
  type OpenMessage = { type: 'pi-dish-open-vault'; requestId: string } | { type: 'pi-dish-open-session'; hostId: string; sessionId: string };
  const open: OpenMessage | null = typeof target.vaultRequestId === 'string' ? { type: 'pi-dish-open-vault', requestId: target.vaultRequestId }
    : typeof target.hostId === 'string' && typeof target.sessionId === 'string'
      ? { type: 'pi-dish-open-session', hostId: target.hostId, sessionId: target.sessionId } : null;
  event.waitUntil((async () => {
    const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === worker.location.origin);
    if (existing) {
      // A frozen or discarded client can refuse focus; open a fresh window instead.
      const focused = await existing.focus().catch(() => null);
      if (focused) {
        if (open) focused.postMessage(open);
        return;
      }
    }
    const url = new URL('./', worker.location.href);
    if (open?.type === 'pi-dish-open-vault') url.searchParams.set('openVault', open.requestId);
    else if (open?.type === 'pi-dish-open-session') { url.searchParams.set('openHost', open.hostId); url.searchParams.set('openSession', open.sessionId); }
    await worker.clients.openWindow(url.href);
  })());
});
