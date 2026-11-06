import fs = require('fs');
import path = require('path');
import { getHarness, listHarnesses } from './harnesses';
import { canonicalSessionId, encodeSessionKey, resolveSessionRoute, VERSION } from './session-key';
import { clearSessionHeaders, findSessionCandidate, invalidateSessionHeader } from './session-discovery';
import { sessionRootsFor } from './private-sessions';
import type { HarnessDescriptor, HarnessId, NativeSessionId, SessionId } from './contracts';

/** Read identity only. Neither discovery nor a live observation proves process ownership. */
export interface SessionSource {
  readonly file: string;
  readonly harnessId: HarnessId;
  readonly nativeSessionId: NativeSessionId;
  readonly sessionKey: SessionId;
  readonly routeId: SessionId;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly parentSession: string | null;
}
export interface DiscoveryCandidate extends SessionSource {
  readonly dirName: string;
  readonly depth: number;
  readonly identitySource: 'basename' | 'header';
  /** Present and true only for a transcript inside the harness's private root. */
  readonly private?: boolean;
}
export interface DiscoveryResult {
  readonly candidates: readonly DiscoveryCandidate[];
  readonly truncated: boolean;
  readonly skipped: number;
}
export interface DiscoveryOptions {
  readonly descriptor?: HarnessDescriptor;
  readonly harnessId?: HarnessId;
  readonly profileId?: string;
  readonly profileVersion?: number;
  readonly maxDepth?: number;
  readonly maxFiles?: number;
  readonly maxEntries?: number;
  readonly excludeIds?: ReadonlySet<NativeSessionId> | readonly NativeSessionId[];
  /**
   * Walk `root` itself as one workspace instead of treating its children as
   * workspace directories. Private roots hold flat `<ts>_<id>.jsonl` files
   * even for nested-layout harnesses.
   */
  readonly singleWorkspace?: boolean;
  /** The walked root is a private root: every candidate from it is private. */
  readonly private?: boolean;
}
export interface LiveSourceObservation {
  /** `prime-daemon`: a root agent read from Prime's resident daemon roster. */
  readonly kind: 'registered' | 'rpc' | 'prime-daemon';
  readonly harnessId: HarnessId;
  readonly nativeSessionId: NativeSessionId;
  readonly file: string | null;
}
export interface SourceLookup {
  /** Keep raw route bytes: encoded Pi aliases must not enable partial matching. */
  readonly route: unknown;
  readonly exact?: boolean;
  readonly discover?: boolean;
  readonly live: readonly LiveSourceObservation[];
}
export interface SessionSourceResolver {
  resolve(input: SourceLookup): SessionSource | null;
  /** Replace discovered route entries, including on a truncated enumeration. */
  refresh(discovery: DiscoveryResult): void;
  /** Retire every route/profile alias for a vanished or replaced file. */
  invalidate(file: string): void;
  /** Retire lookup aliases for one canonical session without discarding file/header observations. */
  invalidateRoute(route: string): void;
  clear(): void;
}

interface ResolverOptions {
  readonly descriptors?: readonly HarnessDescriptor[];
  readonly roots?: Partial<Record<HarnessId, string>>;
  readonly privateRoots?: Partial<Record<HarnessId, string>>;
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

/** A read descriptor for an explicit observed identity, including a claimed
 * file that does not exist yet. This grants no lifecycle rights. */
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
  const rootsFor = (descriptor: HarnessDescriptor) => sessionRootsFor(descriptor, options);
  const findInRoots = (descriptor: HarnessDescriptor, sessionId: NativeSessionId,
    find: { allowPartial?: boolean; profileId?: string; profileVersion?: number } = {}) => {
    for (const sessionRoot of rootsFor(descriptor)) {
      const found = findSessionCandidate(sessionRoot.root, sessionId, {
        descriptor, ...find, singleWorkspace: sessionRoot.singleWorkspace, private: sessionRoot.private,
      }).candidate;
      if (found) return found;
    }
    return null;
  };
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
      for (const kind of ['prime-daemon', 'registered', 'rpc'] as const) {
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
      const exact = input.exact === true || (typeof input.route === 'string' && input.route.startsWith(VERSION));
      const key = `${exact ? 'exact' : 'partial'}:${input.route}`;
      const cached = routes.get(key);
      if (cached && fs.existsSync(cached.file)) {
        if (cached.identitySource === 'basename') return cached;
        // Every header-derived candidate needs corpus collision revalidation,
        // including OMP's named nested files, not just generic session.jsonl.
        const current = findInRoots(descriptor, cached.nativeSessionId, {
          allowPartial: false,
          profileId: cached.profileId, profileVersion: cached.profileVersion,
        });
        for (const [alias, candidate] of routes) if (candidate.file === cached.file) routes.delete(alias);
        if (!current) return null;
        routes.set(key, current);
        return current;
      }
      if (cached) invalidate(cached.file);
      const candidate = findInRoots(descriptor, identity.nativeSessionId, {
        allowPartial: !exact,
      });
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
    invalidateRoute(route) {
      let canonical;
      try { canonical = canonicalSessionId(route); } catch { return; }
      // A bridge identity switch changes route observations, not file contents:
      // drop aliases by resolved identity, keeping headers and unrelated routes.
      for (const [key, candidate] of routes) if (candidate.routeId === canonical) routes.delete(key);
    },
    clear() { routes.clear(); clearSessionHeaders(); },
  };
}

export = { createSessionSourceResolver, sourceForIdentity };
