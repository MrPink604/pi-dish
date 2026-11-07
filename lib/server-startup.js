// Generated from src/core/server-startup.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.observeServerStartup = observeServerStartup;
exports.startListeners = startListeners;
const node_http_1 = require("node:http");
const node_events_1 = require("node:events");
const express = require("express");
const remoteHosts = require("./remote-hosts");
// Key the lifecycle by its exported initial native server, not by whichever
// retry candidate happens to own the successful bind.
const serverStartups = new WeakMap();
function observeServerStartup(initialServer, observer) {
    const startup = serverStartups.get(initialServer);
    if (!startup)
        throw new Error('Server does not belong to a pi-dish startup');
    startup.observers.push(observer);
    if (startup.readyUrl !== null)
        observer.ready(startup.readyUrl);
}
const LOOPBACK = '127.0.0.1';
function startListeners(options) {
    const { app, host, port } = options;
    // The restricted listener is not a full-app listener: no API or WS dispatch,
    // and never a source of application readiness.
    let shareServer = null;
    if (process.env.PI_DISH_SHARE_PORT && options.mountShareApp) {
        const shareApp = express();
        options.mountShareApp(shareApp);
        shareServer = (0, node_http_1.createServer)(shareApp);
        // Observe without consuming the error: native Node ownership stays.
        const shareEvents = shareServer;
        shareEvents.on(node_events_1.errorMonitor, reportFailure);
    }
    function createOwnedServer() {
        const listener = (0, node_http_1.createServer)(app);
        listener.on('close', () => options.closeResources(shareServer));
        // Keep the terminal shutdown callback's native EventEmitter receiver.
        if (options.terminalShutdown)
            listener.on('close', options.terminalShutdown);
        listener.on('upgrade', options.upgrade);
        return listener;
    }
    const startup = { readyUrl: null, observers: [] };
    const initialServer = createOwnedServer();
    serverStartups.set(initialServer, startup);
    function reportReady(listener) {
        if (startup.readyUrl !== null)
            return;
        const bound = listener.address();
        const address = bound.address === '0.0.0.0' ? '127.0.0.1' : bound.address === '::' ? '::1' : bound.address;
        const authority = address.includes(':') ? `[${address}]` : address;
        const url = startup.readyUrl = `http://${authority}:${bound.port}`;
        // An observer added during delivery gets the retained result on registration.
        const count = startup.observers.length;
        for (let i = 0; i < count; i++)
            startup.observers[i].ready(url);
    }
    function reportFailure(error) {
        // A share error can leave the process alive; it must not suppress a later bind.
        const count = startup.observers.length;
        for (let i = 0; i < count; i++)
            startup.observers[i].failed(error);
    }
    const hostIsLoopback = host === LOOPBACK || host === 'localhost';
    const hostIsWildcard = host === '0.0.0.0' || host === '::';
    let aliasServer = null;
    let server = null;
    const explicitAgentUrl = !!process.env.PI_DISH_URL;
    function ensureLoopbackAlias(aliasPort) {
        if (hostIsLoopback || hostIsWildcard || aliasServer)
            return;
        const alias = aliasServer = createOwnedServer();
        alias.once('listening', () => {
            updateAgentUrl(server);
            console.log(`pi-dish loopback alias at http://${LOOPBACK}:${alias.address().port}`);
            reportReady(alias);
        });
        alias.on('error', (err) => {
            console.error(`pi-dish: loopback alias not listening: ${err.message}`);
            aliasServer = null;
            updateAgentUrl(server);
        });
        alias.listen(aliasPort, LOOPBACK);
    }
    function updateAgentUrl(main) {
        // Agent advertisement is separate from local readiness. Preserve explicit
        // operator URLs and prefer the alias only after its actual bind succeeds.
        if (!explicitAgentUrl && main?.listening) {
            const bound = main.address();
            const wildcard = !bound.address || bound.address === '0.0.0.0' || bound.address === '::';
            const reachable = wildcard || aliasServer?.listening ? LOOPBACK : bound.address;
            const authority = reachable.includes(':') ? `[${reachable}]` : reachable;
            process.env.PI_DISH_URL = `http://${authority}:${bound.port}`;
        }
    }
    function onMainListening(main) {
        updateAgentUrl(main);
        console.log(`pi-dish running at http://${host}:${port}`);
        if (host === '127.0.0.1') {
            console.log('Bound to localhost only. To reach it from other devices, set HOST (e.g. HOST=0.0.0.0 or your Tailscale IP) or front it with a reverse proxy.');
        }
        options.onListening();
        reportReady(main);
    }
    function startMainListener(main, retrySeconds = 15) {
        main.once('listening', () => {
            if (port === 0)
                ensureLoopbackAlias(main.address().port);
            onMainListening(main);
        });
        main.on('error', (err) => {
            if (err.code === 'EADDRNOTAVAIL') {
                // Keep loopback alive while the configured interface is unavailable.
                console.error(`pi-dish: ${host} is not assigned yet; retrying in ${retrySeconds}s`);
                setTimeout(() => startMainListener(createOwnedServer(), retrySeconds), retrySeconds * 1000);
                return;
            }
            console.error(`pi-dish: cannot listen on ${host}:${port}: ${err.message}`);
            try {
                reportFailure(err);
            }
            finally {
                process.exit(1);
            }
        });
        server = main;
        main.listen(port, host);
    }
    options.warm?.();
    // Concrete ports bind loopback first, independently of main-listener retries.
    // PORT=0 must wait for the main listener to mint their shared ephemeral port.
    if (port > 0)
        ensureLoopbackAlias(port);
    startMainListener(initialServer);
    if (shareServer) {
        const share = shareServer;
        const shareHost = process.env.PI_DISH_SHARE_HOST || host;
        // Node coerces a numeric string; pass the env value through unchanged.
        share.listen(process.env.PI_DISH_SHARE_PORT, shareHost, () => {
            console.log(`pi-dish share listener at http://${shareHost}:${share.address().port}`);
        });
    }
    // Signals only run forward cleanup and exit; they do not close servers,
    // sibling listeners or retry timers.
    const exitSignals = [['SIGINT', 130], ['SIGTERM', 143]];
    for (const [signal, code] of exitSignals) {
        process.once(signal, () => { remoteHosts.shutdown(); process.exit(code); });
    }
    return initialServer;
}
