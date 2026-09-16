// Generated from src/core/fleet-artifacts.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidToken = isValidToken;
exports.isValidKind = isValidKind;
exports.get = get;
exports.record = record;
exports.remove = remove;
exports.listByHost = listByHost;
/**
 * Hub-side public artifact reachability, not ownership or authorization.
 * Stores are re-read through dish-store for each operation and written atomically.
 */
const dish_store_1 = require("./dish-store");
const remote_hosts_1 = require("./remote-hosts");
const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/;
function readArtifacts() {
    return (0, dish_store_1.readStore)('fleet-artifacts.json');
}
function writeArtifacts(artifacts) {
    (0, dish_store_1.writeStore)('fleet-artifacts.json', artifacts);
}
function isValidToken(token) {
    return typeof token === 'string' && TOKEN_RE.test(token);
}
function isValidKind(kind) {
    return kind === 'share' || kind === 'page';
}
function normalize(entry) {
    if (!entry || typeof entry !== 'object')
        return null;
    const raw = entry;
    if (!(0, remote_hosts_1.isValidRemoteName)(raw.host) || !isValidKind(raw.kind))
        return null;
    return {
        host: raw.host,
        kind: raw.kind,
        createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : null,
    };
}
function get(token) {
    if (!isValidToken(token))
        return null;
    return normalize(readArtifacts()[token]);
}
function record(token, host, kind) {
    if (!isValidToken(token) || !(0, remote_hosts_1.isValidRemoteName)(host) || !isValidKind(kind))
        return null;
    const artifacts = readArtifacts();
    const existing = normalize(artifacts[token]);
    const entry = { host, kind, createdAt: existing?.createdAt ?? Date.now() };
    artifacts[token] = entry;
    writeArtifacts(artifacts);
    return entry;
}
/** A host-scoped revoke cannot remove another valid host's mapping. */
function remove(token, host = null) {
    if (!isValidToken(token))
        return false;
    const artifacts = readArtifacts();
    if (artifacts[token] === undefined)
        return false;
    const existing = normalize(artifacts[token]);
    if (host && existing && existing.host !== host)
        return false;
    delete artifacts[token];
    writeArtifacts(artifacts);
    return true;
}
function listByHost() {
    const out = {};
    for (const [token, raw] of Object.entries(readArtifacts())) {
        const entry = normalize(raw);
        if (!entry || !isValidToken(token))
            continue;
        (out[entry.host] ||= []).push({ token, kind: entry.kind, createdAt: entry.createdAt });
    }
    for (const list of Object.values(out))
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return out;
}
