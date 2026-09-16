// Generated from src/core/skill-feature-handlers.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.knownWorkspaceCwds = knownWorkspaceCwds;
exports.createSkillFeatureHandlers = createSkillFeatureHandlers;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const skillsLib = __importStar(require("./skills"));
const sessionIndex = __importStar(require("./session-index"));
const session_index_data_1 = require("./session-index-data");
const runtime_resources_1 = require("./runtime-resources");
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
// Distinct project cwds pi-dish knows about — the scope over which skills are
// discovered (global user skills plus every project root).
function knownWorkspaceCwds(buildSessionCatalog) {
    const cwds = new Set();
    try {
        for (const session of buildSessionCatalog().list)
            if (session.cwd)
                cwds.add(session.cwd);
    }
    catch { }
    return [...cwds];
}
// Which refinement methodology the button drafts. Env wins over the dish
// setting; a value with a path separator is a markdown file to read, a bare
// token is a pi skill name; unset is the vended default skill.
function resolveRefineConfig(inventory, ports) {
    const envVal = process.env.PI_DISH_REFINE;
    const settingVal = ports.readDishSettings().refine;
    const raw = (envVal != null && envVal !== '') ? envVal
        : (typeof settingVal === 'string' ? settingVal : '');
    const names = new Set((inventory?.skills || []).map(s => s.name));
    if (raw) {
        if (raw.includes('/') || raw.includes(path.sep)) {
            const abs = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw);
            return { mode: 'path', mdPath: abs };
        }
        return { mode: 'skill', skillName: raw, discovered: names.has(raw) };
    }
    return {
        mode: 'default',
        skillName: 'pi-dish-skill-refine',
        discovered: names.has('pi-dish-skill-refine'),
        mdPath: (0, runtime_resources_1.runtimeResourcePath)(ports.applicationRoot, 'skills/pi-dish-skill-refine/SKILL.md'),
    };
}
// Weekly activation buckets, most-recent-last, `weeks` long. Zero weeks stay
// as zeros (rendered as --chart-other stubs by the client — never omitted).
function weeklyBuckets(records, weeks, now = Date.now()) {
    const out = new Array(weeks).fill(0);
    for (const r of records) {
        if (!(0, session_index_data_1.finite)(r.ts))
            continue;
        const age = Math.floor((now - r.ts) / WEEK_MS);
        if (age < 0 || age >= weeks)
            continue;
        out[weeks - 1 - age]++;
    }
    return out;
}
function usageRollup(records, now = Date.now()) {
    const cutoff30 = now - 30 * DAY_MS;
    let count30 = 0, lastUsedTs = null;
    const kindSplit = { read: 0, targeted: 0, explicit: 0 };
    const sessions = new Set(), cwds = new Map();
    let latest = null;
    for (const r of records) {
        kindSplit[r.kind] = (kindSplit[r.kind] || 0) + 1;
        if ((0, session_index_data_1.finite)(r.ts)) {
            if (r.ts >= cutoff30)
                count30++;
            if (lastUsedTs == null || r.ts > lastUsedTs)
                lastUsedTs = r.ts;
            // Only finite-timestamp records can become latest.
            if (!latest || r.ts > latest.ts)
                latest = r;
        }
        if (r.sessionId)
            sessions.add(r.sessionId);
        if (r.cwd)
            cwds.set(r.cwd, (cwds.get(r.cwd) || 0) + 1);
    }
    const topCwd = [...cwds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return {
        count30d: count30,
        lastUsedTs,
        kindSplit,
        sessionCount: sessions.size,
        cwdCount: cwds.size,
        topCwd,
        total: records.length,
        latest: latest ? { sessionId: latest.sessionId, entryId: latest.entryId, ts: latest.ts, model: latest.model, cwd: latest.cwd } : null,
    };
}
function createSkillFeatureHandlers(ports) {
    const skills = async (_req, res) => {
        try {
            const cwds = knownWorkspaceCwds(ports.buildSessionCatalog);
            const inventory = await skillsLib.getSkillsInventory({ cwds });
            sessionIndex.setSkillRoots(inventory.skills.map(s => s.filePath));
            const candidates = ports.enumerateSessionCandidates();
            const scan = sessionIndex.scanSessions(candidates);
            const now = Date.now();
            const skills = inventory.skills.map(s => {
                const records = sessionIndex.getSkillActivations({ skill: s.filePath });
                const roll = usageRollup(records, now);
                return { ...s, usage: { ...roll, weeks12: weeklyBuckets(records, 12, now) } };
            });
            const quietCutoff = now - 60 * DAY_MS;
            const summary = {
                discovered: inventory.discovered,
                advertised: inventory.advertised,
                catalogTokensEst: inventory.catalogTokensEst,
                preambleTokensEst: inventory.preambleTokensEst,
                activations30d: skills.reduce((a, s) => a + s.usage.count30d, 0),
                quiet60d: skills.filter(s => s.usage.lastUsedTs == null || s.usage.lastUsedTs < quietCutoff).length,
                diagnostics: inventory.diagnostics.length,
            };
            res.json({
                scope: inventory.scope,
                summary,
                skills,
                diagnostics: inventory.diagnostics,
                refine: resolveRefineConfig(inventory, ports),
                indexing: scan.indexing,
                precision: 'estimate',
            });
        }
        catch (e) {
            console.error('GET /api/skills failed:', e);
            res.status(500).json({ error: e && typeof e === 'object' && 'message' in e ? e.message : undefined });
        }
    };
    // The primitive: raw activation records as an NDJSON stream. No pagination —
    // a pipe for user scripts. Filters: skill, since (ms epoch or 7d/12h/2w),
    // cwd, kind.
    const skillActivations = (req, res) => {
        // Ensure the corpus is indexed (mines skills as a side effect).
        sessionIndex.scanSessions(ports.enumerateSessionCandidates());
        const filter = {};
        if (req.query.skill)
            filter.skill = String(req.query.skill);
        if (req.query.cwd)
            filter.cwd = String(req.query.cwd);
        if (req.query.kind)
            filter.kind = String(req.query.kind);
        const since = req.query.since != null ? String(req.query.since) : '';
        if (since) {
            const rel = since.match(/^(\d+)(h|d|w)$/);
            if (rel) {
                const n = Number(rel[1]);
                const mult = rel[2] === 'h' ? 3600000 : rel[2] === 'd' ? DAY_MS : WEEK_MS;
                filter.sinceMs = Date.now() - n * mult;
            }
            else {
                const t = /^\d+$/.test(since) ? Number(since) : Date.parse(since);
                if (Number.isFinite(t))
                    filter.sinceMs = t;
            }
        }
        const records = sessionIndex.getSkillActivations(filter)
            .sort((a, b) => (a.ts || 0) - (b.ts || 0));
        res.type('application/x-ndjson');
        res.send(records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
    };
    // Current-version coverage rollup for one skill: sections of SKILL.md with a
    // read fraction over the ranged reads since the file's mtime, plus targeted
    // touch counts and a headline unread-tokens estimate.
    const skillCoverage = (req, res) => {
        const skill = String(req.query.skill || '');
        if (!skill || path.basename(skill) !== 'SKILL.md') {
            return res.status(400).json({ error: 'skill must be an absolute SKILL.md path' });
        }
        let content, stat;
        try {
            stat = fs.statSync(skill);
            content = fs.readFileSync(skill, 'utf-8');
        }
        catch {
            return res.status(404).json({ error: 'skill file not found' });
        }
        sessionIndex.scanSessions(ports.enumerateSessionCandidates());
        const now = Date.now();
        const all = sessionIndex.getSkillActivations({ skill });
        const coverage = skillsLib.projectSkillCoverage(content, stat.mtimeMs, all);
        const roll = usageRollup(all, now);
        // Resolve latest activation's session name for the deep-link label.
        let latest = roll.latest;
        if (latest && latest.sessionId) {
            try {
                const source = ports.findSessionSource(latest.sessionId);
                if (source)
                    latest = { ...latest, name: sessionIndex.getSessionInfo(source).name || null };
            }
            catch { }
        }
        res.json({
            skill,
            mtimeMs: stat.mtimeMs,
            ...coverage,
            weeks26: weeklyBuckets(all, 26, now),
            kindSplit: roll.kindSplit,
            sessionCount: roll.sessionCount,
            cwdCount: roll.cwdCount,
            topCwd: roll.topCwd,
            latest,
            precision: 'estimate',
        });
    };
    return { skills, skillActivations, skillCoverage };
}
