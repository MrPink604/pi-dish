import fs = require('fs');
import path = require('path');
import { getHarness, listHarnesses } from './harnesses';
import { canonicalSessionId, encodeSessionKey, resolveSessionRoute, VERSION } from './session-key';
import { clearSessionHeaders, findSessionCandidate, invalidateSessionHeader } from './session-discovery';
import type { HarnessDescriptor, HarnessId, NativeSessionId } from './contracts';
import type { DiscoveryCandidate, SessionSource, SessionSourceResolver } from './session-source-contracts';

interface ResolverOptions {
  readonly descriptors?: readonly HarnessDescriptor[];
  readonly roots?: Partial<Record<HarnessId, string>>;
}

function sourceWithDescriptor(descriptor: HarnessDescriptor, nativeSessionId: NativeSessionId, file: string): SessionSource {
  const sessionKey = encodeSessionKey(descriptor.id, nativeSessionId);
  const parent = descriptor.nestedSubsessions ? `${path.dirname(file)}.jsonl` : null;
  return {
    file, harnessId: descriptor.id, nativeSessionId, sessionKey,
    routeId: canonicalSessionId(sessionKey),
    profileId: descriptor.profileId, profileVersion: descriptor.profileVersion,
    parentSession: parent && fs.existsSync(parent) ? parent : null,
  };
}

/** Construct a read descriptor from an explicit observed identity, including a
 * claimed file which has not been created yet. This grants no lifecycle rights. */
function sourceForIdentity(harnessId: HarnessId, nativeSessionId: NativeSessionId, file: string): SessionSource {
  const descriptor = getHarness(harnessId);
  if (!descriptor) throw new TypeError('Unknown harness descriptor');
  return sourceWithDescriptor(descriptor, nativeSessionId, file);
}

/** Own historical route aliases and header-cache invalidation. Live inputs are
 * captured by the caller on each read; neither files nor sources prove ownership. */
function createSessionSourceResolver(options: ResolverOptions = {}): SessionSourceResolver {
  const descriptors = new Map((options.descriptors ?? listHarnesses()).map(descriptor => [descriptor.id, descriptor]));
  const routes = new Map<string, DiscoveryCandidate>();
  const rootFor = (descriptor: HarnessDescriptor) => options.roots?.[descriptor.id] || descriptor.rootPath();
  const invalidate = (file: string): void => {
    for (const [key, candidate] of routes) if (candidate.file === file) routes.delete(key);
    invalidateSessionHeader(file);
  };
  return {
    resolve(input) {
      let identity;
      try { identity = resolveSessionRoute(input.route); } catch { return null; }
      const descriptor = descriptors.get(identity.harnessId);
      if (!descriptor) return null;
      // The adapter supplies only an unambiguous registered claim. Order the
      // observations here, independent of their order in the caller's snapshot.
      for (const kind of ['registered', 'rpc'] as const) {
        if (kind === 'rpc' && identity.harnessId !== 'pi') continue;
        const live = input.live.find(observation => observation.kind === kind
          && observation.harnessId === identity.harnessId
          && observation.nativeSessionId === identity.nativeSessionId);
        if (!live?.file || !fs.existsSync(live.file)) continue;
        for (const candidate of routes.values()) {
          if (candidate.harnessId === identity.harnessId
              && candidate.nativeSessionId === identity.nativeSessionId
              && candidate.file !== live.file) invalidate(candidate.file);
        }
        return sourceWithDescriptor(descriptor, identity.nativeSessionId, live.file);
      }
      if (input.discover === false) return null;

      // Keep the original bytes: an encoded Pi alias is exact even though its
      // canonical route is raw, and must not borrow a cached partial result.
      const exact = input.exact === true || input.route.startsWith(VERSION);
      const key = `${exact ? 'exact' : 'partial'}:${input.route}`;
      const cached = routes.get(key);
      if (cached && fs.existsSync(cached.file)) {
        if (cached.identitySource === 'basename') return cached;
        // Every header-derived candidate needs corpus collision revalidation,
        // including OMP's named nested files, not just generic session.jsonl.
        const current = findSessionCandidate(rootFor(descriptor), cached.nativeSessionId, {
          descriptor, allowPartial: false,
          profileId: cached.profileId, profileVersion: cached.profileVersion,
        }).candidate;
        for (const [alias, candidate] of routes) if (candidate.file === cached.file) routes.delete(alias);
        if (!current) return null;
        routes.set(key, current);
        return current;
      }
      if (cached) invalidate(cached.file);
      const candidate = findSessionCandidate(rootFor(descriptor), identity.nativeSessionId, {
        descriptor, allowPartial: !exact,
      }).candidate;
      if (!candidate) return null; // Never cache misses: a file may appear later.
      if (routes.size >= 500) routes.clear();
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
    clear() { routes.clear(); clearSessionHeaders(); },
  };
}

export = { createSessionSourceResolver, sourceForIdentity };
