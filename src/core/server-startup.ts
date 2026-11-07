import { createServer, type Server, type IncomingMessage } from 'node:http';
import { errorMonitor, type EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { AddressInfo } from 'node:net';
import express = require('express');
import remoteHosts = require('./remote-hosts');

export interface ServerStartupObserver {
  /** The first bound full-app listener, not the advertised agent or share URL. */
  ready(url: string): void;
  /** Errors observed after subscription, before the native host failure policy. */
  failed(error: Error): void;
}

interface ServerStartupState {
  readyUrl: string | null;
  observers: ServerStartupObserver[];
}

// Key the lifecycle by its exported initial native server, not by whichever
// retry candidate happens to own the successful bind.
const serverStartups = new WeakMap<Server, ServerStartupState>();

export function observeServerStartup(initialServer: Server, observer: ServerStartupObserver): void {
  const startup = serverStartups.get(initialServer);
  if (!startup) throw new Error('Server does not belong to a pi-dish startup');
  startup.observers.push(observer);
  if (startup.readyUrl !== null) observer.ready(startup.readyUrl);
}

export interface ListenerOptions {
  app: express.Express;
  host: string;
  port: number;
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Start server-owned services once the main listener binds. */
  onListening(): void;
  /** Stop server-owned services; `shareServer` is the optional restricted listener. */
  closeResources(shareServer: Server | null): void;
  /** Restrictive public listener routes; mounted only when PI_DISH_SHARE_PORT is set. */
  mountShareApp?(app: express.Express): void;
  terminalShutdown?(): void;
  /** Warm caches without delaying listener readiness. */
  warm?(): void;
}

const LOOPBACK = '127.0.0.1';

export function startListeners(options: ListenerOptions): Server {
  const { app, host, port } = options;

  // The restricted listener is not a full-app listener: no API or WS dispatch,
  // and never a source of application readiness.
  let shareServer: Server | null = null;
  if (process.env.PI_DISH_SHARE_PORT && options.mountShareApp) {
    const shareApp = express();
    options.mountShareApp(shareApp);
    shareServer = createServer(shareApp);
    // Observe without consuming the error: native Node ownership stays.
    const shareEvents: EventEmitter = shareServer;
    shareEvents.on(errorMonitor, reportFailure);
  }

  function createOwnedServer(): Server {
    const listener = createServer(app);
    listener.on('close', () => options.closeResources(shareServer));
    // Keep the terminal shutdown callback's native EventEmitter receiver.
    if (options.terminalShutdown) listener.on('close', options.terminalShutdown);
    listener.on('upgrade', options.upgrade);
    return listener;
  }

  const startup: ServerStartupState = { readyUrl: null, observers: [] };
  const initialServer = createOwnedServer();
  serverStartups.set(initialServer, startup);

  function reportReady(listener: Server): void {
    if (startup.readyUrl !== null) return;
    const bound = listener.address() as AddressInfo;
    const address = bound.address === '0.0.0.0' ? '127.0.0.1' : bound.address === '::' ? '::1' : bound.address;
    const authority = address.includes(':') ? `[${address}]` : address;
    const url = startup.readyUrl = `http://${authority}:${bound.port}`;
    // An observer added during delivery gets the retained result on registration.
    const count = startup.observers.length;
    for (let i = 0; i < count; i++) startup.observers[i].ready(url);
  }

  function reportFailure(error: Error): void {
    // A share error can leave the process alive; it must not suppress a later bind.
    const count = startup.observers.length;
    for (let i = 0; i < count; i++) startup.observers[i].failed(error);
  }

  const hostIsLoopback = host === LOOPBACK || host === 'localhost';
  const hostIsWildcard = host === '0.0.0.0' || host === '::';
  let aliasServer: Server | null = null;
  let server: Server | null = null;
  const explicitAgentUrl = !!process.env.PI_DISH_URL;

  function ensureLoopbackAlias(aliasPort: number): void {
    if (hostIsLoopback || hostIsWildcard || aliasServer) return;
    const alias = aliasServer = createOwnedServer();
    alias.once('listening', () => {
      updateAgentUrl(server);
      console.log(`pi-dish loopback alias at http://${LOOPBACK}:${(alias.address() as AddressInfo).port}`);
      reportReady(alias);
    });
    alias.on('error', (err) => {
      console.error(`pi-dish: loopback alias not listening: ${err.message}`);
      aliasServer = null;
      updateAgentUrl(server);
    });
    alias.listen(aliasPort, LOOPBACK);
  }

  function updateAgentUrl(main: Server | null): void {
    // Agent advertisement is separate from local readiness. Preserve explicit
    // operator URLs and prefer the alias only after its actual bind succeeds.
    if (!explicitAgentUrl && main?.listening) {
      const bound = main.address() as AddressInfo;
      const wildcard = !bound.address || bound.address === '0.0.0.0' || bound.address === '::';
      const reachable = wildcard || aliasServer?.listening ? LOOPBACK : bound.address;
      const authority = reachable.includes(':') ? `[${reachable}]` : reachable;
      process.env.PI_DISH_URL = `http://${authority}:${bound.port}`;
    }
  }

  function onMainListening(main: Server): void {
    updateAgentUrl(main);
    console.log(`pi-dish running at http://${host}:${port}`);
    if (host === '127.0.0.1') {
      console.log('Bound to localhost only. To reach it from other devices, set HOST (e.g. HOST=0.0.0.0 or your Tailscale IP) or front it with a reverse proxy.');
    }
    options.onListening();
    reportReady(main);
  }

  function startMainListener(main: Server, retrySeconds = 15): void {
    main.once('listening', () => {
      if (port === 0) ensureLoopbackAlias((main.address() as AddressInfo).port);
      onMainListening(main);
    });
    main.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRNOTAVAIL') {
        // Keep loopback alive while the configured interface is unavailable.
        console.error(`pi-dish: ${host} is not assigned yet; retrying in ${retrySeconds}s`);
        setTimeout(() => startMainListener(createOwnedServer(), retrySeconds), retrySeconds * 1000);
        return;
      }
      console.error(`pi-dish: cannot listen on ${host}:${port}: ${err.message}`);
      try { reportFailure(err); } finally { process.exit(1); }
    });
    server = main;
    main.listen(port, host);
  }

  options.warm?.();
  // Concrete ports bind loopback first, independently of main-listener retries.
  // PORT=0 must wait for the main listener to mint their shared ephemeral port.
  if (port > 0) ensureLoopbackAlias(port);
  startMainListener(initialServer);
  if (shareServer) {
    const share = shareServer;
    const shareHost = process.env.PI_DISH_SHARE_HOST || host;
    // Node coerces a numeric string; pass the env value through unchanged.
    share.listen(process.env.PI_DISH_SHARE_PORT as unknown as number, shareHost, () => {
      console.log(`pi-dish share listener at http://${shareHost}:${(share.address() as AddressInfo).port}`);
    });
  }

  // Signals only run forward cleanup and exit; they do not close servers,
  // sibling listeners or retry timers.
  const exitSignals: [NodeJS.Signals, number][] = [['SIGINT', 130], ['SIGTERM', 143]];
  for (const [signal, code] of exitSignals) {
    process.once(signal, () => { remoteHosts.shutdown(); process.exit(code); });
  }

  return initialServer;
}
