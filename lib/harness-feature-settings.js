// Generated from src/core/harness-feature-settings.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateHarnessAgents = exports.harnessAgents = exports.updateModelRoles = exports.harnessConfig = exports.harnesses = void 0;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const harnesses_1 = require("./harnesses");
const harness_agents_1 = require("./harness-agents");
const harness_feature_commands_1 = require("./harness-feature-commands");
function valueOf(result) {
    return result && typeof result === 'object' && 'value' in result ? result.value : undefined;
}
function errorMessage(error) {
    return error && typeof error === 'object' && 'message' in error ? error.message : undefined;
}
function requestBody(body) {
    return body && typeof body === 'object' ? body : {};
}
const MODEL_ROLE_KEY = /^[a-zA-Z][\w.-]{0,63}$/;
const MODEL_ROLE_VALUE_MAX = 200;
const AGENT_NAME_KEY = /^[A-Za-z0-9][\w.-]{0,63}$/;
function sanitizeModelRoles(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    return Object.fromEntries(Object.entries(value)
        .filter((entry) => typeof entry[1] === 'string' && !!entry[1].trim()));
}
// `config get <key>` returns the merged project-over-global view for the cwd,
// while `config set <key>` rewrites the whole value in the *global* config —
// so a read(merged) → edit → set() round trip would silently copy a project's
// `.omp/config.yml` overrides into the global config. An empty temp dir has no
// project config to overlay, so reading there yields global alone.
async function readGlobalConfigValues(descriptor, keys) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-global-'));
    try {
        const values = await Promise.all(keys.map(key => (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configGet(key), { cwd: dir })));
        return values.map(valueOf);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
async function readGlobalModelRoles(descriptor) {
    const [value] = await readGlobalConfigValues(descriptor, [descriptor.pilotConfig.modelRoles]);
    return sanitizeModelRoles(value);
}
async function readHarnessPilotConfig(descriptor, cwd) {
    const keys = descriptor.pilotConfig;
    if (!keys || typeof descriptor.argv.configGet !== 'function')
        return null;
    const [rolesResult, thinkingResult, globalModelRoles] = await Promise.all([
        (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configGet(keys.modelRoles), { cwd }),
        (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configGet(keys.defaultThinkingLevel), { cwd }),
        readGlobalModelRoles(descriptor),
    ]);
    const modelRoles = sanitizeModelRoles(valueOf(rolesResult));
    const defaultModel = typeof modelRoles.default === 'string' ? modelRoles.default : null;
    const thinking = valueOf(thinkingResult);
    const defaultThinkingLevel = typeof thinking === 'string' ? thinking : null;
    return { defaultModel, defaultThinkingLevel, modelRoles, globalModelRoles };
}
// --- Task-agent settings (OMP's /agents hub: one array + three records) ---
const AGENT_SETTING_KEYS = ['disabledAgents', 'agentModelOverrides', 'agentPrewalk', 'agentAdvisor'];
function agentSettingsSupported(descriptor) {
    const keys = descriptor.pilotConfig;
    return !!(keys && descriptor.taskAgents && AGENT_SETTING_KEYS.every(key => keys[key]));
}
function sanitizeNameList(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.filter(name => typeof name === 'string' && AGENT_NAME_KEY.test(name)))];
}
// OMP stores these per-agent toggles as `record`s and stringifies booleans it
// has normalized once ("on"/"off"), so a read sees either form; both collapse
// to a boolean for the wire, and writes go back out as booleans (which the
// harness accepts and normalizes itself).
function sanitizeFlagRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const flags = {};
    for (const [name, flag] of Object.entries(value)) {
        if (!AGENT_NAME_KEY.test(name))
            continue;
        if (typeof flag === 'boolean')
            flags[name] = flag;
        else if (flag === 'on' || flag === 'true')
            flags[name] = true;
        else if (flag === 'off' || flag === 'false')
            flags[name] = false;
    }
    return flags;
}
function shapeAgentSettings([disabled, modelOverrides, prewalk, advisor]) {
    return {
        disabled: sanitizeNameList(disabled),
        modelOverrides: sanitizeModelRoles(modelOverrides),
        prewalk: sanitizeFlagRecord(prewalk),
        advisor: sanitizeFlagRecord(advisor),
    };
}
function agentSettingKeyList(descriptor) {
    return AGENT_SETTING_KEYS.map(key => descriptor.pilotConfig[key]);
}
// Effective (project-over-global, for `cwd`) and global-only settings, the
// same split the model-role editor uses: rows edit global, and a differing
// effective value is a project override the harness wins with in that cwd.
async function readAgentSettings(descriptor, cwd) {
    const keys = agentSettingKeyList(descriptor);
    const [effective, global] = await Promise.all([
        Promise.all(keys.map(key => (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configGet(key), { cwd }).then(valueOf))),
        readGlobalConfigValues(descriptor, keys),
    ]);
    return { settings: shapeAgentSettings(effective), globalSettings: shapeAgentSettings(global) };
}
// Every config write here is a read-modify-write of one whole value, so two
// concurrent PUTs would drop one another's patch. One chain per harness.
const harnessConfigWrites = new Map();
function queueHarnessConfigWrite(harnessId, task) {
    // The stored link is always failure-swallowed, so one failed write can't
    // reject every queued one behind it.
    const chained = (harnessConfigWrites.get(harnessId) || Promise.resolve()).then(() => task());
    harnessConfigWrites.set(harnessId, chained.catch(() => { }));
    return chained;
}
const harnesses = (_req, res) => {
    res.json({
        harnesses: (0, harnesses_1.listHarnesses)().map(descriptor => ({
            id: descriptor.id,
            label: descriptor.label,
            available: (0, harness_feature_commands_1.harnessCommandAvailable)(descriptor),
            rpcFallback: descriptor.rpcFallback,
            closeMode: descriptor.closeMode,
            // Does this harness have a settings view at all: pilot defaults plus
            // model roles, and (OMP only so far) the task-agent hub.
            pilotConfig: !!descriptor.pilotConfig,
            taskAgents: agentSettingsSupported(descriptor),
        })),
    });
};
exports.harnesses = harnesses;
const harnessConfig = async (req, res) => {
    const descriptor = (0, harnesses_1.getHarness)(req.params.id);
    if (!descriptor)
        return res.status(404).json({ error: 'Unknown harness' });
    if (!descriptor.pilotConfig) {
        return res.status(501).json({ error: `Pilot config is not supported for ${descriptor.label}.` });
    }
    if (req.query.cwd !== undefined && typeof req.query.cwd !== 'string') {
        return res.status(400).json({ error: 'cwd must be a string' });
    }
    try {
        res.json(await readHarnessPilotConfig(descriptor, req.query.cwd));
    }
    catch (e) {
        res.status(500).json({ error: errorMessage(e) });
    }
};
exports.harnessConfig = harnessConfig;
// Patch role → model assignments in the harness's *global* config. Values are
// stored verbatim: the harness resolves model refs itself, and a rewrite here
// would only invent a second dialect.
const updateModelRoles = async (req, res) => {
    const descriptor = (0, harnesses_1.getHarness)(req.params.id);
    if (!descriptor)
        return res.status(404).json({ error: 'Unknown harness' });
    if (!descriptor.pilotConfig || typeof descriptor.argv.configSet !== 'function') {
        return res.status(501).json({ error: `Model roles are not editable for ${descriptor.label}.` });
    }
    const { roles, cwd } = requestBody(req.body);
    if (cwd !== undefined && typeof cwd !== 'string') {
        return res.status(400).json({ error: 'cwd must be a string' });
    }
    if (!roles || typeof roles !== 'object' || Array.isArray(roles)) {
        return res.status(400).json({ error: 'roles must be an object mapping role names to model refs' });
    }
    const patch = Object.entries(roles);
    if (!patch.length)
        return res.status(400).json({ error: 'roles must name at least one role' });
    for (const [role, model] of patch) {
        if (!MODEL_ROLE_KEY.test(role)) {
            return res.status(400).json({ error: `Invalid role name: ${role}` });
        }
        if (model === null)
            continue;
        if (typeof model !== 'string' || !model.trim() || model.length > MODEL_ROLE_VALUE_MAX) {
            return res.status(400).json({ error: `Invalid model for role ${role}: expected null or a non-empty model ref of at most ${MODEL_ROLE_VALUE_MAX} characters` });
        }
    }
    try {
        res.json(await queueHarnessConfigWrite(descriptor.id, async () => {
            const record = await readGlobalModelRoles(descriptor);
            for (const [role, model] of patch) {
                // Every non-null value was validated above; the captured patch is local.
                if (model === null)
                    delete record[role];
                else
                    record[role] = model;
            }
            await (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configSet(descriptor.pilotConfig.modelRoles, JSON.stringify(record)));
            const [globalModelRoles, effective] = await Promise.all([
                readGlobalModelRoles(descriptor),
                (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configGet(descriptor.pilotConfig.modelRoles), { cwd }),
            ]);
            return { globalModelRoles, modelRoles: sanitizeModelRoles(valueOf(effective)) };
        }));
    }
    catch (e) {
        res.status(500).json({ error: errorMessage(e) });
    }
};
exports.updateModelRoles = updateModelRoles;
// Task-agent inventory (bundled + user + project definitions) with the
// per-agent settings the harness's own agents hub edits.
const harnessAgents = async (req, res) => {
    const descriptor = (0, harnesses_1.getHarness)(req.params.id);
    if (!descriptor)
        return res.status(404).json({ error: 'Unknown harness' });
    if (!agentSettingsSupported(descriptor)) {
        return res.status(501).json({ error: `Task agents are not configurable for ${descriptor.label}.` });
    }
    const cwd = req.query.cwd;
    if (cwd !== undefined && typeof cwd !== 'string') {
        return res.status(400).json({ error: 'cwd must be a string' });
    }
    try {
        const [agents, settings] = await Promise.all([
            (0, harness_agents_1.listTaskAgents)(descriptor, harness_feature_commands_1.runHarnessJsonCommand, { cwd }),
            readAgentSettings(descriptor, cwd),
        ]);
        res.json({ agents, ...settings, cwd: cwd || '' });
    }
    catch (e) {
        res.status(500).json({ error: errorMessage(e) });
    }
};
exports.harnessAgents = harnessAgents;
// Patch per-agent settings in the harness's *global* config. Each field is
// tri-state: `disabled` toggles array membership, and `model`/`prewalk`/
// `advisor` take a value or null to drop the override and inherit again.
const updateHarnessAgents = async (req, res) => {
    const descriptor = (0, harnesses_1.getHarness)(req.params.id);
    if (!descriptor)
        return res.status(404).json({ error: 'Unknown harness' });
    if (!agentSettingsSupported(descriptor) || typeof descriptor.argv.configSet !== 'function') {
        return res.status(501).json({ error: `Task agents are not configurable for ${descriptor.label}.` });
    }
    const { agents, cwd } = requestBody(req.body);
    if (cwd !== undefined && typeof cwd !== 'string') {
        return res.status(400).json({ error: 'cwd must be a string' });
    }
    if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
        return res.status(400).json({ error: 'agents must be an object mapping agent names to settings' });
    }
    const patch = Object.entries(agents);
    if (!patch.length)
        return res.status(400).json({ error: 'agents must name at least one agent' });
    for (const [name, settings] of patch) {
        if (!AGENT_NAME_KEY.test(name))
            return res.status(400).json({ error: `Invalid agent name: ${name}` });
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            return res.status(400).json({ error: `Invalid settings for agent ${name}` });
        }
        const fields = settings;
        for (const field of ['disabled', 'prewalk', 'advisor']) {
            const value = fields[field];
            if (value !== undefined && value !== null && typeof value !== 'boolean') {
                return res.status(400).json({ error: `Invalid ${field} for agent ${name}: expected a boolean or null` });
            }
        }
        const model = fields.model;
        if (model !== undefined && model !== null
            && (typeof model !== 'string' || !model.trim() || model.length > MODEL_ROLE_VALUE_MAX)) {
            return res.status(400).json({ error: `Invalid model for agent ${name}: expected null or a non-empty model ref of at most ${MODEL_ROLE_VALUE_MAX} characters` });
        }
    }
    try {
        res.json(await queueHarnessConfigWrite(descriptor.id, async () => {
            const keys = agentSettingKeyList(descriptor);
            const record = shapeAgentSettings(await readGlobalConfigValues(descriptor, keys));
            const disabled = new Set(record.disabled);
            const dirty = new Set();
            const setOverride = (bucket, key, name, value) => {
                if (value === undefined)
                    return;
                if (value === null) {
                    if (!Object.hasOwn(bucket, name))
                        return;
                    delete bucket[name];
                }
                else {
                    if (bucket[name] === value)
                        return;
                    bucket[name] = value;
                }
                dirty.add(key);
            };
            // The captured entries retain the values validated before the write queue.
            for (const [name, settings] of patch) {
                if (settings.disabled !== undefined && settings.disabled !== null
                    && settings.disabled !== disabled.has(name)) {
                    if (settings.disabled)
                        disabled.add(name);
                    else
                        disabled.delete(name);
                    dirty.add(descriptor.pilotConfig.disabledAgents);
                }
                setOverride(record.modelOverrides, descriptor.pilotConfig.agentModelOverrides, name, settings.model);
                setOverride(record.prewalk, descriptor.pilotConfig.agentPrewalk, name, settings.prewalk);
                setOverride(record.advisor, descriptor.pilotConfig.agentAdvisor, name, settings.advisor);
            }
            const values = {
                [descriptor.pilotConfig.disabledAgents]: [...disabled],
                [descriptor.pilotConfig.agentModelOverrides]: record.modelOverrides,
                [descriptor.pilotConfig.agentPrewalk]: record.prewalk,
                [descriptor.pilotConfig.agentAdvisor]: record.advisor,
            };
            // Only the records a patch actually moved are rewritten: every `config
            // set` is a whole-value write, so touching an untouched key would
            // materialize a global copy of whatever the read returned.
            for (const key of keys) {
                if (dirty.has(key)) {
                    await (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configSet(key, JSON.stringify(values[key])));
                }
            }
            return readAgentSettings(descriptor, cwd);
        }));
    }
    catch (e) {
        res.status(500).json({ error: errorMessage(e) });
    }
};
exports.updateHarnessAgents = updateHarnessAgents;
