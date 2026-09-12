// Generated from src/core/session-source.ts; edit that source and run npm run build:core.
"use strict";
const fs = require("fs");
const path = require("path");
const harnesses_1 = require("./harnesses");
const session_key_1 = require("./session-key");
const session_discovery_1 = require("./session-discovery");
function sourceWithDescriptor(descriptor, nativeSessionId, file) {
    const sessionKey = (0, session_key_1.encodeSessionKey)(descriptor.id, nativeSessionId);
    const parent = descriptor.nestedSubsessions ? `${path.dirname(file)}.jsonl` : null;
    return {
        file, harnessId: descriptor.id, nativeSessionId, sessionKey,
        routeId: (0, session_key_1.canonicalSessionId)(sessionKey),
        profileId: descriptor.profileId, profileVersion: descriptor.profileVersion,
        parentSession: parent && fs.existsSync(parent) ? parent : null,
    };
}
/** Construct a read descriptor from an explicit observed identity, including a
 * claimed file which has not been created yet. This grants no lifecycle rights. */
function sourceForIdentity(harnessId, nativeSessionId, file) {
    const descriptor = (0, harnesses_1.getHarness)(harnessId);
    if (!descriptor)
        throw new TypeError('Unknown harness descriptor');
    return sourceWithDescriptor(descriptor, nativeSessionId, file);
}
/** Own historical route aliases and header-cache invalidation. Live inputs are
 * captured by the caller on each read; neither files nor sources prove ownership. */
function createSessionSourceResolver(options = {}) {
    const descriptors = new Map((options.descriptors ?? (0, harnesses_1.listHarnesses)()).map(descriptor => [descriptor.id, descriptor]));
    const routes = new Map();
    const rootFor = (descriptor) => options.roots?.[descriptor.id] || descriptor.rootPath();
    const invalidate = (file) => {
        for (const [key, candidate] of routes)
            if (candidate.file === file)
                routes.delete(key);
        (0, session_discovery_1.invalidateSessionHeader)(file);
    };
    return {
        resolve(input) {
            let identity;
            try {
                identity = (0, session_key_1.resolveSessionRoute)(input.route);
            }
            catch {
                return null;
            }
            const descriptor = descriptors.get(identity.harnessId);
            if (!descriptor)
                return null;
            // The adapter supplies only an unambiguous registered claim. Order the
            // observations here, independent of their order in the caller's snapshot.
            for (const kind of ['registered', 'rpc']) {
                if (kind === 'rpc' && identity.harnessId !== 'pi')
                    continue;
                const live = input.live.find(observation => observation.kind === kind
                    && observation.harnessId === identity.harnessId
                    && observation.nativeSessionId === identity.nativeSessionId);
                if (!live?.file || !fs.existsSync(live.file))
                    continue;
                for (const candidate of routes.values()) {
                    if (candidate.harnessId === identity.harnessId
                        && candidate.nativeSessionId === identity.nativeSessionId
                        && candidate.file !== live.file)
                        invalidate(candidate.file);
                }
                return sourceWithDescriptor(descriptor, identity.nativeSessionId, live.file);
            }
            if (input.discover === false)
                return null;
            // Keep the original bytes: an encoded Pi alias is exact even though its
            // canonical route is raw, and must not borrow a cached partial result.
            const exact = input.exact === true || input.route.startsWith(session_key_1.VERSION);
            const key = `${exact ? 'exact' : 'partial'}:${input.route}`;
            const cached = routes.get(key);
            if (cached && fs.existsSync(cached.file)) {
                if (cached.identitySource === 'basename')
                    return cached;
                // Every header-derived candidate needs corpus collision revalidation,
                // including OMP's named nested files, not just generic session.jsonl.
                const current = (0, session_discovery_1.findSessionCandidate)(rootFor(descriptor), cached.nativeSessionId, {
                    descriptor, allowPartial: false,
                    profileId: cached.profileId, profileVersion: cached.profileVersion,
                }).candidate;
                for (const [alias, candidate] of routes)
                    if (candidate.file === cached.file)
                        routes.delete(alias);
                if (!current)
                    return null;
                routes.set(key, current);
                return current;
            }
            if (cached)
                invalidate(cached.file);
            const candidate = (0, session_discovery_1.findSessionCandidate)(rootFor(descriptor), identity.nativeSessionId, {
                descriptor, allowPartial: !exact,
            }).candidate;
            if (!candidate)
                return null; // Never cache misses: a file may appear later.
            if (routes.size >= 500)
                routes.clear();
            routes.set(key, candidate);
            return candidate;
        },
        refresh(discovery) {
            // A bounded/truncated enumeration still replaces the route snapshot.
            routes.clear();
            for (const candidate of discovery.candidates) {
                for (const route of [candidate.routeId, candidate.sessionKey]) {
                    routes.set(`exact:${route}`, candidate);
                    routes.set(`partial:${route}`, candidate);
                }
            }
        },
        invalidate,
        invalidateRoute(route) {
            let canonical;
            try {
                canonical = (0, session_key_1.canonicalSessionId)(route);
            }
            catch {
                return;
            }
            // A bridge identity switch changes route observations, not file contents.
            // Remove substring and encoded aliases by their resolved identity while
            // leaving unrelated routes and stat-validated header observations warm.
            for (const [key, candidate] of routes)
                if (candidate.routeId === canonical)
                    routes.delete(key);
        },
        clear() { routes.clear(); (0, session_discovery_1.clearSessionHeaders)(); },
    };
}
module.exports = { createSessionSourceResolver, sourceForIdentity };
