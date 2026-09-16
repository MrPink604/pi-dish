// Generated from src/core/feature-handlers.ts; edit that source and run npm run build:core.
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
exports.createFeatureHandlers = createFeatureHandlers;
const harnessSettings = __importStar(require("./harness-feature-settings"));
const stt = __importStar(require("./stt"));
const recovery_runner_1 = require("./recovery-runner");
const harnesses_1 = require("./harnesses");
const harness_feature_commands_1 = require("./harness-feature-commands");
function sanitizeSavedFilters(value) {
    if (!Array.isArray(value) || value.length > 50)
        return null;
    const out = [];
    const seen = new Set();
    for (const item of value) {
        const f = item && typeof item === 'object' ? item : {};
        const name = typeof f.name === 'string' ? f.name.trim() : '';
        const query = typeof f.query === 'string' ? f.query.trim() : '';
        if (!name || !query || name.length > 60 || query.length > 500 || seen.has(name))
            return null;
        seen.add(name);
        out.push({ name, query });
    }
    return out;
}
// Allowlist, never redaction: secrets cannot enter the client projection.
function settingsForClient(settings) {
    return {
        monthlyBudgetUsd: settings.monthlyBudgetUsd ?? null,
        savedFilters: sanitizeSavedFilters(settings.savedFilters) || [],
        recoveryMode: (0, recovery_runner_1.recoveryMode)(settings.recoveryMode),
    };
}
function optionalRecord(value) {
    return value && typeof value === 'object' ? value : {};
}
function normalizeUsageLimit(value) {
    if (!value || typeof value !== 'object')
        return null;
    const limit = optionalRecord(value);
    const amount = optionalRecord(limit.amount);
    const window = optionalRecord(limit.window);
    const usedFraction = Number(amount.usedFraction);
    if (typeof limit.label !== 'string' || !Number.isFinite(usedFraction))
        return null;
    const resetsAt = Number(window.resetsAt);
    return {
        id: typeof limit.id === 'string' ? limit.id : null,
        label: limit.label.slice(0, 120),
        windowLabel: typeof window.label === 'string' ? window.label.slice(0, 60) : null,
        resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
        usedFraction,
        unit: typeof amount.unit === 'string' ? amount.unit.slice(0, 30) : null,
        status: typeof limit.status === 'string' ? limit.status.slice(0, 30) : null,
    };
}
function createFeatureHandlers(ports) {
    const usageLimits = async (_req, res) => {
        const harnesses = (0, harnesses_1.listHarnesses)().filter(d => d.argv.usage && (0, harness_feature_commands_1.harnessCommandAvailable)(d));
        const results = await Promise.all(harnesses.map(async (d) => {
            try {
                const parsed = await (0, harness_feature_commands_1.runHarnessJsonCommand)(d, d.argv.usage);
                if (parsed === null || parsed === undefined)
                    throw new TypeError(`Cannot read properties of ${parsed} (reading 'reports')`);
                const rawReports = optionalRecord(parsed).reports;
                // Even redacted upstream reports can contain account IDs/emails.
                const reports = (Array.isArray(rawReports) ? rawReports : []).map(value => {
                    const report = optionalRecord(value);
                    const metadata = optionalRecord(report.metadata);
                    return {
                        provider: String(report.provider || 'unknown').slice(0, 60),
                        fetchedAt: Number.isFinite(Number(report.fetchedAt)) ? Number(report.fetchedAt) : null,
                        planType: typeof metadata.planType === 'string' ? metadata.planType.slice(0, 40) : null,
                        limits: (Array.isArray(report.limits) ? report.limits : []).map(normalizeUsageLimit).filter(limit => limit !== null),
                    };
                }).filter(report => report.limits.length);
                return { harness: d.id, label: d.label, reports };
            }
            catch (e) {
                return { harness: d.id, label: d.label, error: optionalRecord(e).message };
            }
        }));
        res.json({ generatedAt: Date.now(), harnesses: results });
    };
    const settings = (_req, res) => res.json(settingsForClient(ports.readDishSettings()));
    const updateSettings = (req, res) => {
        // The JSON parser rejects primitives. Preserve the former `in` failure
        // rather than silently treating a truthy malformed body as an empty patch.
        const body = req.body || {};
        if (typeof body !== 'object')
            throw new TypeError(`Cannot use 'in' operator to search for 'monthlyBudgetUsd' in ${body}`);
        const settings = ports.readDishSettings();
        if ('monthlyBudgetUsd' in body) {
            const value = body.monthlyBudgetUsd;
            if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1_000_000))
                return res.status(400).json({ error: 'monthlyBudgetUsd must be null or a positive number at most 1000000' });
            if (value === null)
                delete settings.monthlyBudgetUsd;
            else
                settings.monthlyBudgetUsd = value;
        }
        if ('savedFilters' in body) {
            const filters = sanitizeSavedFilters(body.savedFilters);
            if (!filters)
                return res.status(400).json({ error: 'savedFilters must be up to 50 { name, query } entries with unique non-empty names (≤60 chars) and queries (≤500 chars)' });
            if (filters.length === 0)
                delete settings.savedFilters;
            else
                settings.savedFilters = filters;
        }
        if ('recoveryMode' in body) {
            if (body.recoveryMode !== 'off' && body.recoveryMode !== 'restore' && body.recoveryMode !== 'continue') {
                return res.status(400).json({ error: 'recoveryMode must be off, restore, or continue' });
            }
            settings.recoveryMode = body.recoveryMode;
        }
        try {
            ports.writeDishSettings(settings);
            res.json(settingsForClient(settings));
        }
        catch (e) {
            res.status(500).json({ error: e && typeof e === 'object' && 'message' in e ? e.message : undefined });
        }
    };
    const transcribe = async (req, res) => {
        const config = stt.resolveSttConfig(ports.readDishSettings());
        if (!config)
            return res.status(503).json({ error: 'Speech-to-text is not configured on this host' });
        // Type before body: the local raw parser claims audio/* and video/webm only.
        const contentType = req.headers['content-type'] || '';
        if (!stt.sttFilename(contentType)) {
            return res.status(415).json({ error: `unsupported audio type ${stt.baseMimeType(contentType) || 'unknown'}` });
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0)
            return res.status(400).json({ error: 'audio body required' });
        try {
            const { text } = await stt.transcribe(config, { bytes: req.body, contentType });
            res.json({ text });
        }
        catch (e) {
            const error = e && typeof e === 'object' ? e : {};
            res.status(typeof error.status === 'number' && error.status ? error.status : 502).json({ error: error.message });
        }
    };
    return {
        usageLimits,
        settings,
        updateSettings,
        harnesses: harnessSettings.harnesses,
        harnessConfig: harnessSettings.harnessConfig,
        updateModelRoles: harnessSettings.updateModelRoles,
        harnessAgents: harnessSettings.harnessAgents,
        updateHarnessAgents: harnessSettings.updateHarnessAgents,
        transcribe,
    };
}
