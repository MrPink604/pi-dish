// Generated from src/core/session-index.ts; edit that source and run npm run build:core.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSkillRoots = setSkillRoots;
exports.scanSessions = scanSessions;
exports.getSearchText = getSearchText;
exports.getSessionInfo = getSessionInfo;
exports.getSkillActivations = getSkillActivations;
exports.resetForTests = resetForTests;
/**
 * Persistent index of derived session data (list metadata, search text,
 * skill activations), validated by `(mtimeMs, size)` under
 * ~/.pi/dish/session-index/ so only changed files are re-parsed. Stale files
 * beyond `PI_DISH_INDEX_SYNC_BUDGET` are queued for a background build; a file
 * that only grew is extended from the appended byte range.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const dish_store_1 = require("./dish-store");
const cache_retention_1 = require("./cache-retention");
const session_metadata_1 = require("./session-metadata");
const helper_values_1 = require("./helper-values");
const session_index_data_1 = require("./session-index-data");
const session_key_1 = require("./session-key");
const session_files_js_1 = require("./session-files.js");
const skill_mining_js_1 = require("./skill-mining.js");
const harness_pricing_js_1 = require("./harness-pricing.js");
const cache_lifetime_js_1 = require("./cache-lifetime.js");
const http_boundary_1 = require("./http-boundary");
function scanContext() {
    const revisions = new Map();
    const estimators = new Map();
    return {
        cacheConfig: (0, cache_retention_1.loadCacheRetentionConfig)(),
        estimateCost(harnessId) {
            let estimate = estimators.get(harnessId);
            if (!estimate) {
                estimate = (0, harness_pricing_js_1.createUsageCostEstimator)(harnessId);
                estimators.set(harnessId, estimate);
            }
            return estimate;
        },
        harnessRevision(harnessId) {
            let revision = revisions.get(harnessId);
            if (revision === undefined) {
                revision = (0, harness_pricing_js_1.pricingRevision)(harnessId);
                revisions.set(harnessId, revision);
            }
            return revision;
        },
    };
}
function persistedFlag(value) {
    return value === undefined || value === 0 || value === 1 || value === false || value === true;
}
const SYNC_BUDGET_DEFAULT = 20;
const FLUSH_MS = 500;
const COMPACT_MIN_DEAD_BYTES = 1_000_000;
// Bumping a schema version re-indexes stale entries through the bounded backlog.
const META_SCHEMA_VERSION = 13;
const TEXT_SCHEMA_VERSION = 3;
const SKILLS_SCHEMA_VERSION = 1;
// Skill dir -> SKILL.md path, to attribute reads of `references/foo.md`. A roots
// change does not re-mine indexed files; attribution catches up on next change.
let skillCtx = { roots: new Map() };
function setSkillRoots(skillFilePaths) {
    const roots = new Map();
    for (const p of skillFilePaths || []) {
        if (typeof p === 'string' && p)
            roots.set(node_path_1.default.dirname(p), p);
    }
    skillCtx = { roots };
}
/** One append-only NDJSON file: load-latest-wins, buffered appends, compaction. */
class NdjsonLog {
    filePath;
    buffer;
    flushTimer;
    liveBytes;
    deadBytes;
    constructor(filePath) {
        this.filePath = filePath;
        this.buffer = [];
        this.flushTimer = null;
        this.liveBytes = 0;
        this.deadBytes = 0;
    }
    /** Latest line per file wins; an unparseable (torn) line is counted dead and re-indexed by the scan. */
    load() {
        const entries = new Map();
        let raw;
        try {
            raw = node_fs_1.default.readFileSync(this.filePath, 'utf-8');
        }
        catch {
            return entries;
        }
        this.liveBytes = 0;
        this.deadBytes = 0;
        for (const line of raw.split('\n')) {
            if (!line)
                continue;
            let obj;
            try {
                obj = JSON.parse(line);
            }
            catch {
                this.deadBytes += line.length;
                continue;
            }
            if (!(0, helper_values_1.record)(obj) || typeof obj.f !== 'string') {
                this.deadBytes += line.length;
                continue;
            }
            const prev = entries.get(obj.f);
            if (prev)
                this.deadBytes += prev._bytes;
            if (obj.del) {
                entries.delete(obj.f);
                this.deadBytes += line.length;
            }
            else {
                entries.set(obj.f, { ...obj, f: obj.f, _bytes: line.length });
            }
        }
        for (const e of entries.values())
            this.liveBytes += e._bytes;
        return entries;
    }
    append(obj) {
        const line = JSON.stringify(obj);
        this.buffer.push(line);
        this.liveBytes += line.length;
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
            this.flushTimer.unref?.();
        }
        return line.length;
    }
    flush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (!this.buffer.length)
            return;
        const chunk = this.buffer.join('\n') + '\n';
        this.buffer = [];
        try {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(this.filePath), { recursive: true });
            node_fs_1.default.appendFileSync(this.filePath, chunk);
        }
        catch (e) {
            console.error(`session-index: append to ${this.filePath} failed:`, (0, http_boundary_1.errorMessage)(e));
        }
    }
    /** Rewrite the log to only the given entries (temp-file + rename). */
    compact(entries, encode) {
        this.flush();
        const lines = [];
        let bytes = 0;
        for (const [file, entry] of entries) {
            const line = JSON.stringify(encode(file, entry));
            bytes += line.length;
            lines.push(line);
        }
        try {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(this.filePath), { recursive: true });
            const tmp = this.filePath + '.tmp';
            node_fs_1.default.writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '');
            node_fs_1.default.renameSync(tmp, this.filePath);
            this.liveBytes = bytes;
            this.deadBytes = 0;
        }
        catch (e) {
            console.error(`session-index: compact of ${this.filePath} failed:`, (0, http_boundary_1.errorMessage)(e));
        }
    }
    markDead(bytes) {
        this.deadBytes += bytes;
        this.liveBytes = Math.max(0, this.liveBytes - bytes);
    }
    needsCompaction() {
        return this.deadBytes > COMPACT_MIN_DEAD_BYTES && this.deadBytes > this.liveBytes;
    }
}
// dir -> state; dishDir() re-reads HOME per call (tests swap it).
const states = new Map();
function getState() {
    const dir = node_path_1.default.join((0, dish_store_1.dishDir)(), 'session-index');
    let st = states.get(dir);
    if (!st) {
        st = {
            metaLog: new NdjsonLog(node_path_1.default.join(dir, 'meta.ndjson')),
            textLog: new NdjsonLog(node_path_1.default.join(dir, 'text.ndjson')),
            skillsLog: new NdjsonLog(node_path_1.default.join(dir, 'skills.ndjson')),
            meta: new Map(),
            text: new Map(),
            skills: new Map(),
            backlog: new Map(), // file -> candidate pending background indexing
            building: false,
        };
        for (const [f, e] of st.metaLog.load()) {
            const info = decodeIndexedInfo(e.v);
            if (!info || !(0, helper_values_1.finite)(e.m) || !(0, helper_values_1.finite)(e.s) ||
                !(e.p === undefined || typeof e.p === 'string') ||
                !(e.pv === undefined || (0, helper_values_1.finite)(e.pv)) ||
                !(e.pr === undefined || typeof e.pr === 'string') ||
                !(e.cr === undefined || typeof e.cr === 'string')) {
                st.metaLog.markDead(e._bytes);
                continue;
            }
            st.meta.set(f, {
                mtimeMs: e.m, size: e.s, info,
                ctimeMs: (0, helper_values_1.finite)(e.c) ? e.c : undefined, dev: (0, helper_values_1.finite)(e.d) ? e.d : undefined, ino: (0, helper_values_1.finite)(e.i) ? e.i : undefined,
                version: (0, helper_values_1.finite)(e.ver) ? e.ver : 0,
                profileId: typeof e.p === 'string' ? e.p : 'pi-v3', profileVersion: (0, helper_values_1.finite)(e.pv) ? e.pv : 1,
                pricingRevision: typeof e.pr === 'string' ? e.pr : 'native',
                cacheRetentionRevision: typeof e.cr === 'string' ? e.cr : '', _bytes: e._bytes,
            });
        }
        for (const [f, e] of st.textLog.load()) {
            if (!(0, helper_values_1.finite)(e.m) || !(0, helper_values_1.finite)(e.s) || typeof e.t !== 'string' ||
                !persistedFlag(e.nl) ||
                !persistedFlag(e.tr) ||
                !(e.l === undefined || e.l === null || typeof e.l === 'string')) {
                st.textLog.markDead(e._bytes);
                continue;
            }
            st.text.set(f, {
                mtimeMs: e.m, size: e.s, text: e.t, endsNl: !!e.nl,
                version: (0, helper_values_1.finite)(e.ver) ? e.ver : 0, tree: !!e.tr,
                leafId: typeof e.l === 'string' ? e.l : null, _bytes: e._bytes,
            });
        }
        for (const [f, e] of st.skillsLog.load()) {
            const records = (0, session_index_data_1.decodeSkillRecords)(e.r);
            const state = e.st == null ? null : (0, session_index_data_1.decodeSkillState)(e.st);
            if (!(0, helper_values_1.finite)(e.m) || !(0, helper_values_1.finite)(e.s) || !records || (e.st != null && !state)) {
                st.skillsLog.markDead(e._bytes);
                continue;
            }
            st.skills.set(f, {
                mtimeMs: e.m, size: e.s, records, state,
                version: (0, helper_values_1.finite)(e.ver) ? e.ver : 0, _bytes: e._bytes,
            });
        }
        if (st.metaLog.needsCompaction())
            compactMeta(st);
        if (st.textLog.needsCompaction())
            compactText(st);
        if (st.skillsLog.needsCompaction())
            compactSkills(st);
        states.set(dir, st);
    }
    return st;
}
const encodeMeta = (f, e) => ({ f, m: e.mtimeMs, s: e.size, c: e.ctimeMs, d: e.dev, i: e.ino, ver: META_SCHEMA_VERSION, p: e.profileId, pv: e.profileVersion, pr: e.pricingRevision, cr: e.cacheRetentionRevision, v: e.info });
const encodeText = (f, e) => ({
    f, m: e.mtimeMs, s: e.size, ver: TEXT_SCHEMA_VERSION,
    nl: e.endsNl ? 1 : 0, tr: e.tree ? 1 : 0, l: e.leafId || undefined, t: e.text,
});
const encodeSkills = (f, e) => ({ f, m: e.mtimeMs, s: e.size, ver: SKILLS_SCHEMA_VERSION, st: e.state || undefined, r: e.records });
function compactMeta(st) { st.metaLog.compact(st.meta, encodeMeta); }
function compactText(st) { st.textLog.compact(st.text, encodeText); }
function compactSkills(st) { st.skillsLog.compact(st.skills, encodeSkills); }
const routeIdentities = new Map();
const ROUTE_IDENTITY_CACHE_MAX = 4096;
function routeIdentity(routeId) {
    let entry = routeIdentities.get(routeId);
    if (!entry) {
        const identity = (0, session_key_1.resolveSessionRoute)(routeId);
        entry = {
            harnessId: identity.harnessId, nativeSessionId: identity.nativeSessionId,
            sessionKey: (0, session_key_1.encodeSessionKey)(identity.harnessId, identity.nativeSessionId),
            canonical: (0, session_key_1.canonicalSessionId)(routeId) === routeId,
        };
        if (routeIdentities.size >= ROUTE_IDENTITY_CACHE_MAX)
            routeIdentities.clear();
        routeIdentities.set(routeId, entry);
    }
    return entry;
}
/** Validate explicit source identity; a path alone cannot establish a profile. */
function normalize(input) {
    if (!(0, helper_values_1.record)(input) || typeof input.file !== 'string' || !input.file ||
        typeof input.profileId !== 'string' || !(0, helper_values_1.finite)(input.profileVersion) ||
        !(input.parentSession === null || typeof input.parentSession === 'string'))
        throw new TypeError('Expected explicit SessionSource');
    const identity = routeIdentity(input.routeId);
    if (identity.harnessId !== input.harnessId || identity.nativeSessionId !== input.nativeSessionId ||
        identity.sessionKey !== input.sessionKey || !identity.canonical)
        throw new TypeError('Invalid SessionSource identity');
    return input;
}
function decodeIndexedInfo(value) {
    const info = (0, session_metadata_1.decodeSessionInfo)(value);
    if (!info || !(0, helper_values_1.record)(value) || typeof value.profileId !== 'string' || !(0, helper_values_1.finite)(value.profileVersion))
        return null;
    const usage = (0, session_index_data_1.decodeUsage)(value.usage);
    if (!usage)
        return null;
    try {
        const identity = (0, session_key_1.resolveSessionRoute)(value.sessionKey);
        if (identity.harnessId !== value.harnessId || identity.nativeSessionId !== value.nativeSessionId)
            return null;
        return { ...info, ...identity, sessionKey: (0, session_key_1.encodeSessionKey)(identity.harnessId, identity.nativeSessionId),
            profileId: value.profileId, profileVersion: value.profileVersion, usage };
    }
    catch {
        return null;
    }
}
/** Parse one file once and update all index tables + their logs. */
function indexFile(st, candidate, stats, ctx) {
    const file = candidate.file;
    // Reuse the last raw parse if another reader just opened this file.
    const { entries, endsNl } = (0, session_files_js_1.readSessionFileEntries)(file, stats);
    (0, cache_lifetime_js_1.observeCacheLifetimeFromEntries)(entries, file, candidate.profileId);
    const { nativeSessionId, sessionKey } = candidate;
    const info = {
        ...(0, session_metadata_1.sessionInfoFromEntries)(entries, stats.mtime, candidate, ctx.cacheConfig),
        sessionKey, harnessId: candidate.harnessId, nativeSessionId,
        profileId: candidate.profileId, profileVersion: candidate.profileVersion,
        usage: (0, session_files_js_1.buildIndexedUsageFromEntries)(entries, candidate, ctx.estimateCost(candidate.harnessId)),
    };
    const search = (0, session_files_js_1.buildSearchIndexFromEntries)(entries);
    (0, session_index_data_1.checkSearchLeaf)(search);
    setEntry(st.meta, st.metaLog, file, { mtimeMs: stats.mtimeMs, size: stats.size, ctimeMs: stats.ctimeMs, dev: stats.dev, ino: stats.ino, version: META_SCHEMA_VERSION, profileId: candidate.profileId, profileVersion: candidate.profileVersion, pricingRevision: ctx.harnessRevision(candidate.harnessId), cacheRetentionRevision: ctx.cacheConfig.revision, info }, encodeMeta);
    setEntry(st.text, st.textLog, file, {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        version: TEXT_SCHEMA_VERSION,
        text: search.text,
        tree: search.tree,
        leafId: search.leafId,
        endsNl,
    }, encodeText);
    const mined = (0, skill_mining_js_1.mineSkillsFromEntries)(entries, {
        // Public Pi routes stay raw ids; alternate harnesses need the encoded tuple to avoid cross-corpus clashes.
        sessionId: candidate.harnessId === 'pi' ? nativeSessionId : sessionKey,
        skillCtx,
    });
    setEntry(st.skills, st.skillsLog, file, { mtimeMs: stats.mtimeMs, size: stats.size, version: SKILLS_SCHEMA_VERSION, records: mined.records, state: mined.state }, encodeSkills);
    return info;
}
function isEntryFresh(st, file, candidate, stats, ctx) {
    const cached = st.meta.get(file);
    const cachedText = st.text.get(file);
    const cachedSkills = st.skills.get(file);
    // The skills table participates in staleness; without it a pre-skills index
    // would report zero skill usage for the whole historical corpus.
    return !!(cached && cached.version === META_SCHEMA_VERSION &&
        cached.info.sessionKey === candidate.sessionKey && cached.info.nativeSessionId === candidate.nativeSessionId &&
        cached.profileId === candidate.profileId && cached.profileVersion === candidate.profileVersion &&
        cached.pricingRevision === ctx.harnessRevision(candidate.harnessId) &&
        cached.cacheRetentionRevision === ctx.cacheConfig.revision &&
        cachedText && cachedText.version === TEXT_SCHEMA_VERSION &&
        cachedSkills && cachedSkills.version === SKILLS_SCHEMA_VERSION &&
        cached.mtimeMs === stats.mtimeMs && cached.size === stats.size &&
        cached.ctimeMs === stats.ctimeMs && cached.dev === stats.dev && cached.ino === stats.ino &&
        cachedText.mtimeMs === stats.mtimeMs && cachedText.size === stats.size &&
        cachedSkills.mtimeMs === stats.mtimeMs && cachedSkills.size === stats.size);
}
/**
 * O(delta) refresh for a file that only grew along a plain chain from the
 * indexed leaf; anything else returns null so the caller re-indexes fully.
 * Extensions are not logged: hot files churn too fast to persist per delta.
 */
function tryExtendIndexEntry(st, candidate, stats, ctx) {
    const file = candidate.file;
    const meta = st.meta.get(file), text = st.text.get(file), skills = st.skills.get(file);
    if (!meta || !text || !skills)
        return null;
    if (meta.version !== META_SCHEMA_VERSION || text.version !== TEXT_SCHEMA_VERSION ||
        skills.version !== SKILLS_SCHEMA_VERSION)
        return null;
    if (meta.info.sessionKey !== candidate.sessionKey || meta.info.nativeSessionId !== candidate.nativeSessionId)
        return null;
    if (meta.profileId !== candidate.profileId || meta.profileVersion !== candidate.profileVersion)
        return null;
    if (meta.pricingRevision !== ctx.harnessRevision(candidate.harnessId))
        return null;
    if (meta.cacheRetentionRevision !== ctx.cacheConfig.revision)
        return null;
    // The three tables are written together; extend only from a coherent base.
    if (meta.mtimeMs !== text.mtimeMs || meta.size !== text.size ||
        meta.mtimeMs !== skills.mtimeMs || meta.size !== skills.size)
        return null;
    if (!(stats.size > meta.size) || !text.endsNl)
        return null;
    if (meta.dev !== stats.dev || meta.ino !== stats.ino)
        return null; // replaced, not appended
    // Continuity state (running provider/model/cwd) is required to accumulate a delta.
    if (!meta.info?.usage?.state || !skills.state)
        return null;
    let delta, entries, extension;
    try {
        delta = readByteRange(file, meta.size, stats.size);
        entries = (0, session_files_js_1.parseSessionEntries)(delta);
        extension = (0, session_files_js_1.extendSearchIndexFromEntries)(entries, text.tree, text.leafId);
        if (extension)
            (0, session_index_data_1.checkSearchLeaf)(extension);
    }
    catch {
        return null;
    }
    if (!extension)
        return null;
    try {
        (0, session_metadata_1.extendSessionInfoFromEntries)(meta.info, entries, stats.mtime, candidate, ctx.cacheConfig);
        (0, cache_lifetime_js_1.extendCacheLifetimeFromEntries)(entries, file, candidate.profileId);
        (0, session_files_js_1.extendIndexedUsageFromEntries)(meta.info.usage, entries, candidate, ctx.estimateCost(candidate.harnessId));
        const mined = (0, skill_mining_js_1.mineSkillsFromEntries)(entries, {
            sessionId: candidate.harnessId === 'pi' ? meta.info.nativeSessionId : meta.info.sessionKey,
            skillCtx,
            initialState: skills.state,
        });
        if (mined.records.length)
            skills.records = skills.records.concat(mined.records);
        skills.state = mined.state;
    }
    catch {
        // A half-applied extension must not survive; the next scan rebuilds it.
        dropEntry(st, file);
        return null;
    }
    // Honor the same total-text bound as a full build, evicting oldest text first.
    if (extension.text) {
        const next = text.text ? text.text + ' ' + extension.text : extension.text;
        text.text = next.length > session_files_js_1.SEARCH_TEXT_SESSION_CAP
            ? next.slice(next.length - session_files_js_1.SEARCH_TEXT_SESSION_CAP) : next;
    }
    text.endsNl = delta.endsWith('\n');
    text.tree = extension.tree;
    text.leafId = extension.leafId;
    meta.ctimeMs = stats.ctimeMs;
    for (const entry of [meta, text, skills]) {
        entry.mtimeMs = stats.mtimeMs;
        entry.size = stats.size;
    }
    return meta.info;
}
function setEntry(map, log, file, entry, encode) {
    const prev = map.get(file);
    if (prev)
        log.markDead(prev._bytes || 0);
    entry._bytes = log.append(encode(file, entry));
    map.set(file, entry);
    if (log.needsCompaction())
        log.compact(map, encode);
}
function dropEntry(st, file) {
    for (const [map, log] of [[st.meta, st.metaLog], [st.text, st.textLog], [st.skills, st.skillsLog]]) {
        const prev = map.get(file);
        if (!prev)
            continue;
        map.delete(file);
        log.markDead(prev._bytes || 0);
        log.append({ f: file, del: 1 });
    }
    st.backlog.delete(file);
    (0, cache_lifetime_js_1.forgetCacheLifetimeFile)(file);
}
function syncBudget() {
    const n = parseInt(process.env.PI_DISH_INDEX_SYNC_BUDGET || '', 10);
    return Number.isFinite(n) ? n : SYNC_BUDGET_DEFAULT;
}
/** Drain the backlog one file per tick so requests interleave freely. */
function kickBuilder(st) {
    if (st.building || !st.backlog.size)
        return;
    st.building = true;
    const step = () => {
        const next = st.backlog.entries().next();
        if (next.done) {
            st.building = false;
            (0, cache_lifetime_js_1.flushCacheLifetime)();
            return;
        }
        const [file, candidate] = next.value;
        st.backlog.delete(file);
        try {
            const stats = node_fs_1.default.statSync(file);
            const ctx = scanContext();
            if (!isEntryFresh(st, file, candidate, stats, ctx) &&
                !tryExtendIndexEntry(st, candidate, stats, ctx))
                indexFile(st, candidate, stats, ctx);
        }
        catch { } // vanished/unreadable: skip
        setImmediate(step);
    };
    setImmediate(step);
}
/**
 * Files missing from `infos` are queued for background indexing, so `indexing`
 * means "a backlog remains". Entries for files gone from disk are tombstoned.
 */
function scanSessions(files) {
    const st = getState();
    const infos = new Map();
    const seen = new Set();
    let budget = syncBudget();
    const ctx = scanContext();
    for (const input of files) {
        const candidate = normalize(input);
        const file = candidate.file;
        seen.add(file);
        let stats;
        try {
            stats = node_fs_1.default.statSync(file);
        }
        catch {
            dropEntry(st, file);
            continue;
        }
        if (isEntryFresh(st, file, candidate, stats, ctx)) {
            st.backlog.delete(file); // a stale queue entry for a file we just served
            infos.set(file, st.meta.get(file).info);
            continue;
        }
        // An append-only growth extends in O(delta) instead of consuming sync budget.
        const extended = tryExtendIndexEntry(st, candidate, stats, ctx);
        if (extended) {
            st.backlog.delete(file);
            infos.set(file, extended);
            continue;
        }
        if (budget > 0) {
            budget--;
            st.backlog.delete(file);
            try {
                infos.set(file, indexFile(st, candidate, stats, ctx));
            }
            catch { }
        }
        else {
            st.backlog.set(file, candidate);
        }
    }
    // Drop entries for files deleted on disk; absent-from-`files` but existing is fine.
    for (const file of [...st.meta.keys()]) {
        if (!seen.has(file) && !node_fs_1.default.existsSync(file))
            dropEntry(st, file);
    }
    kickBuilder(st);
    (0, cache_lifetime_js_1.flushCacheLifetime)();
    return { infos, indexing: st.backlog.size > 0 };
}
/** '' when the file is unreadable. */
function getSearchText(input) {
    const candidate = normalize(input);
    const file = candidate.file;
    const st = getState();
    const cached = st.text.get(file);
    const meta = st.meta.get(file);
    let stats;
    st.backlog.delete(file); // this demand read owns the refresh
    try {
        stats = node_fs_1.default.statSync(file);
    }
    catch {
        return '';
    }
    if (cached && cached.version === TEXT_SCHEMA_VERSION && meta &&
        meta.info.sessionKey === candidate.sessionKey && meta.info.nativeSessionId === candidate.nativeSessionId &&
        meta.profileId === candidate.profileId && meta.profileVersion === candidate.profileVersion &&
        meta.ctimeMs === stats.ctimeMs && meta.dev === stats.dev && meta.ino === stats.ino &&
        cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        return cached.text;
    }
    // Freshness inputs are loaded only by the rebuild paths below: a fresh entry
    // would otherwise stat settings.json and re-hash the pricing catalog.
    const ctx = scanContext();
    if (tryExtendIndexEntry(st, candidate, stats, ctx))
        return st.text.get(file).text;
    try {
        indexFile(st, candidate, stats, ctx);
    }
    catch {
        return '';
    }
    return st.text.get(file).text;
}
/** Throws when the file is unreadable. */
function getSessionInfo(input) {
    const candidate = normalize(input);
    const st = getState();
    const ctx = scanContext();
    const stats = node_fs_1.default.statSync(candidate.file);
    let info;
    if (isEntryFresh(st, candidate.file, candidate, stats, ctx)) {
        info = st.meta.get(candidate.file).info;
    }
    else {
        info = tryExtendIndexEntry(st, candidate, stats, ctx) || indexFile(st, candidate, stats, ctx);
    }
    st.backlog.delete(candidate.file); // just indexed/served; a queued rebuild is stale
    // Strip index-internal fields so callers see the plain session-files shape.
    const { usage, sessionKey, harnessId, nativeSessionId, profileId, profileVersion, ...pub } = info;
    return pub;
}
function readByteRange(file, start, end) {
    const fd = node_fs_1.default.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(end - start);
        const n = node_fs_1.default.readSync(fd, buf, 0, buf.length, start);
        return buf.toString('utf-8', 0, n);
    }
    finally {
        node_fs_1.default.closeSync(fd);
    }
}
/**
 * Filtered skill-activation records from the in-memory index only; files
 * still in the backlog are absent.
 */
function getSkillActivations(filter = {}) {
    const st = getState();
    const { skill, sinceMs, cwd, kind } = filter;
    const out = [];
    for (const entry of st.skills.values()) {
        for (const r of entry.records) {
            if (skill && r.skill !== skill)
                continue;
            if (kind && r.kind !== kind)
                continue;
            if (cwd && r.cwd !== cwd)
                continue;
            if (sinceMs != null && !((0, helper_values_1.finite)(r.ts) && r.ts >= sinceMs))
                continue;
            out.push(r);
        }
    }
    return out;
}
/** Test hook: flush pending appends and forget in-memory state. */
function resetForTests() {
    for (const st of states.values()) {
        st.backlog.clear();
        st.metaLog.flush();
        st.textLog.flush();
        st.skillsLog.flush();
    }
    states.clear();
}
