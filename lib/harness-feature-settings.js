// Generated from src/core/harness-feature-settings.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateHarnessSettings = exports.listHarnessSettings = exports.updateHarnessAgents = exports.harnessAgents = exports.updateModelRoles = exports.harnessConfig = exports.harnesses = void 0;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const harnesses_1 = require("./harnesses");
const harness_agents_1 = require("./harness-agents");
const harness_feature_commands_1 = require("./harness-feature-commands");
const http_boundary_1 = require("./http-boundary");
function valueOf(result) {
    return result && typeof result === 'object' && 'value' in result ? result.value : undefined;
}
function harnessRoute({ supported, unsupported, run, errorStatus = () => 500 }) {
    return async (req, res) => {
        const descriptor = (0, harnesses_1.getHarness)(req.params.id);
        if (!descriptor)
            return res.status(404).json({ error: 'Unknown harness' });
        if (!supported(descriptor))
            return res.status(501).json({ error: unsupported(descriptor) });
        try {
            await run(descriptor, req, res);
        }
        catch (e) {
            res.status(errorStatus(e)).json({ error: (0, http_boundary_1.errorMessage)(e) });
        }
    };
}
/** Undefined when absent; null after answering 400 when it is not a string. */
function optionalCwd(res, value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string') {
        res.status(400).json({ error: 'cwd must be a string' });
        return null;
    }
    return value;
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
// `config get` merges project-over-global but `config set` writes global, so a
// round trip would leak project overrides into global; an empty dir reads global alone.
async function inEmptyDir(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-global-'));
    try {
        return await run(dir);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
async function readGlobalConfigValues(descriptor, keys) {
    return inEmptyDir(async (dir) => (await Promise.all(keys.map(key => (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configGet(key), { cwd: dir })))).map(valueOf));
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
// OMP may store these toggles as booleans or "on"/"off"; both collapse to a boolean.
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
// Rows edit global; a differing effective value is the project's override in that cwd.
async function readAgentSettings(descriptor, cwd) {
    const keys = agentSettingKeyList(descriptor);
    const [effective, global] = await Promise.all([
        Promise.all(keys.map(key => (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configGet(key), { cwd }).then(valueOf))),
        readGlobalConfigValues(descriptor, keys),
    ]);
    return { settings: shapeAgentSettings(effective), globalSettings: shapeAgentSettings(global) };
}
// Writes are whole-value read-modify-writes; serialize per harness so concurrent PUTs don't drop patches.
const harnessConfigWrites = new Map();
function queueHarnessConfigWrite(harnessId, task) {
    // The stored link swallows failures so one failed write can't reject the queue behind it.
    const chained = (harnessConfigWrites.get(harnessId) || Promise.resolve()).then(() => task());
    harnessConfigWrites.set(harnessId, chained.catch(() => { }));
    return chained;
}
class SettingInputError extends Error {
}
const SETTING_KEY = /^[A-Za-z][\w.-]{0,127}$/;
const SETTING_VALUE_MAX = 64 * 1024;
const ANSI_SGR = /\u001b\[[0-9;]*m/g;
function settingsSupported(descriptor) {
    const argv = descriptor.argv;
    return !!(descriptor.settingsTabs && argv.configList && argv.configSchema
        && typeof argv.configSet === 'function' && typeof argv.configReset === 'function');
}
// The human `config list` alone carries `[tab]` headings and enum `a|b|c` types;
// join to the JSON listing by key. First row wins so multi-line values can't shadow it.
function parseSettingsSchema(text) {
    const rows = new Map();
    let tab = '';
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(ANSI_SGR, '');
        const heading = /^\[([\w-]+)\]$/.exec(line);
        if (heading) {
            tab = heading[1];
            continue;
        }
        const row = /^ {2}(\S+) = .*\(([^()]*)\)$/.exec(line);
        if (row && tab && !rows.has(row[1]))
            rows.set(row[1], { tab, typeDisplay: row[2] });
    }
    return rows;
}
function listedSettings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Unexpected settings listing');
    const result = Object.create(null);
    for (const [key, entry] of Object.entries(value)) {
        if (SETTING_KEY.test(key) && entry && typeof entry === 'object' && !Array.isArray(entry))
            result[key] = entry;
    }
    return result;
}
// Settings with no TUI tab ("internal") are not offered.
async function readSettings(descriptor, cwd) {
    const [schemaText, globalList, effectiveList] = await inEmptyDir(dir => Promise.all([
        (0, harness_feature_commands_1.runHarnessTextCommand)(descriptor, descriptor.argv.configSchema, { cwd: dir }),
        (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configList, { cwd: dir }),
        cwd ? (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configList, { cwd }) : null,
    ]));
    const schema = parseSettingsSchema(schemaText);
    const global = listedSettings(globalList);
    const effective = effectiveList === null ? null : listedSettings(effectiveList);
    const settings = [];
    for (const [key, entry] of Object.entries(global)) {
        const meta = schema.get(key);
        if (!meta || meta.tab === 'internal' || typeof entry.type !== 'string')
            continue;
        const row = { key, tab: meta.tab, type: entry.type, description: typeof entry.description === 'string' ? entry.description : '' };
        if (entry.type === 'enum' && meta.typeDisplay.includes('|'))
            row.values = meta.typeDisplay.split('|');
        if (entry.redacted === true)
            row.redacted = true;
        else if (entry.value !== undefined)
            row.value = entry.value;
        const local = effective?.[key];
        if (local && !row.redacted && local.redacted !== true
            && JSON.stringify(local.value) !== JSON.stringify(row.value))
            row.override = { value: local.value ?? null };
        settings.push(row);
    }
    const order = descriptor.settingsTabs || [];
    const tabIds = [...new Set(settings.map(row => row.tab))].sort((a, b) => {
        const ai = order.indexOf(a), bi = order.indexOf(b);
        return ai >= 0 && bi >= 0 ? ai - bi : ai >= 0 ? -1 : bi >= 0 ? 1 : a.localeCompare(b);
    });
    return { tabs: tabIds.map(id => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) })), settings, cwd: cwd || '' };
}
// The CLI parses one argv entry (JSON for arrays/records, else trimmed text). A
// leading `-` would read as a flag, so such text gets a leading space the CLI trims.
function settingArgument(row, value) {
    const fail = (expected) => { throw new SettingInputError(`Invalid value for ${row.key}: expected ${expected}`); };
    let text;
    switch (row.type) {
        case 'boolean':
            if (typeof value !== 'boolean')
                fail('a boolean');
            text = String(value);
            break;
        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value))
                fail('a finite number');
            text = String(value);
            break;
        case 'enum':
            if (typeof value !== 'string' || (row.values && !row.values.includes(value)))
                fail(row.values ? row.values.join(', ') : 'a string');
            text = value;
            break;
        case 'string':
            if (typeof value !== 'string')
                fail('a string');
            text = value;
            break;
        case 'array':
            if (!Array.isArray(value))
                fail('an array');
            text = JSON.stringify(value);
            break;
        case 'record':
            if (!value || typeof value !== 'object' || Array.isArray(value))
                fail('an object');
            text = JSON.stringify(value);
            break;
        default:
            throw new SettingInputError(`${row.key} has an unsupported setting type: ${row.type}`);
    }
    if (text.length > SETTING_VALUE_MAX)
        fail(`at most ${SETTING_VALUE_MAX} characters`);
    return text.startsWith('-') ? ` ${text}` : text;
}
const harnesses = (_req, res) => {
    res.json({
        harnesses: (0, harnesses_1.listHarnesses)().map(descriptor => ({
            id: descriptor.id,
            label: descriptor.label,
            available: (0, harness_feature_commands_1.harnessCommandAvailable)(descriptor),
            rpcFallback: descriptor.rpcFallback,
            closeMode: descriptor.closeMode,
            privateSessions: typeof descriptor.privateRootPath === 'function',
            // Settings view: pilot defaults plus model roles, and the task-agent hub where supported.
            pilotConfig: !!descriptor.pilotConfig,
            taskAgents: agentSettingsSupported(descriptor),
        })),
    });
};
exports.harnesses = harnesses;
exports.harnessConfig = harnessRoute({
    supported: descriptor => !!descriptor.pilotConfig,
    unsupported: descriptor => `Pilot config is not supported for ${descriptor.label}.`,
    async run(descriptor, req, res) {
        const cwd = optionalCwd(res, req.query.cwd);
        if (cwd === null)
            return;
        res.json(await readHarnessPilotConfig(descriptor, cwd));
    },
});
// Values are stored verbatim: the harness resolves model refs itself.
exports.updateModelRoles = harnessRoute({
    supported: descriptor => !!descriptor.pilotConfig && typeof descriptor.argv.configSet === 'function',
    unsupported: descriptor => `Model roles are not editable for ${descriptor.label}.`,
    async run(descriptor, req, res) {
        const { roles, cwd } = (0, http_boundary_1.requestBody)(req);
        const cwdValue = optionalCwd(res, cwd);
        if (cwdValue === null)
            return;
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
        res.json(await queueHarnessConfigWrite(descriptor.id, async () => {
            const record = await readGlobalModelRoles(descriptor);
            for (const [role, model] of patch) {
                if (model === null)
                    delete record[role];
                else
                    record[role] = model;
            }
            await (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configSet(descriptor.pilotConfig.modelRoles, JSON.stringify(record)));
            const [globalModelRoles, effective] = await Promise.all([
                readGlobalModelRoles(descriptor),
                (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configGet(descriptor.pilotConfig.modelRoles), { cwd: cwdValue }),
            ]);
            return { globalModelRoles, modelRoles: sanitizeModelRoles(valueOf(effective)) };
        }));
    },
});
// Task-agent inventory with the per-agent settings the harness's own hub edits.
exports.harnessAgents = harnessRoute({
    supported: agentSettingsSupported,
    unsupported: descriptor => `Task agents are not configurable for ${descriptor.label}.`,
    async run(descriptor, req, res) {
        const cwd = optionalCwd(res, req.query.cwd);
        if (cwd === null)
            return;
        const [agents, settings] = await Promise.all([
            (0, harness_agents_1.listTaskAgents)(descriptor, harness_feature_commands_1.runHarnessJsonCommand, { cwd }),
            readAgentSettings(descriptor, cwd),
        ]);
        res.json({ agents, ...settings, cwd: cwd || '' });
    },
});
// Fields are tri-state: a value sets it; null drops the override and inherits again.
exports.updateHarnessAgents = harnessRoute({
    supported: descriptor => agentSettingsSupported(descriptor) && typeof descriptor.argv.configSet === 'function',
    unsupported: descriptor => `Task agents are not configurable for ${descriptor.label}.`,
    async run(descriptor, req, res) {
        const { agents, cwd } = (0, http_boundary_1.requestBody)(req);
        const cwdValue = optionalCwd(res, cwd);
        if (cwdValue === null)
            return;
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
            // Rewrite only dirty keys: a whole-value set on an untouched key would materialize a global copy.
            for (const key of keys) {
                if (dirty.has(key)) {
                    await (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, descriptor.argv.configSet(key, JSON.stringify(values[key])));
                }
            }
            return readAgentSettings(descriptor, cwdValue);
        }));
    },
});
exports.listHarnessSettings = harnessRoute({
    supported: settingsSupported,
    unsupported: descriptor => `Settings are not editable for ${descriptor.label}.`,
    async run(descriptor, req, res) {
        const cwd = optionalCwd(res, req.query.cwd);
        if (cwd === null)
            return;
        res.json(await readSettings(descriptor, cwd));
    },
});
// null resets to the harness default; all keys/values are validated before the first write.
exports.updateHarnessSettings = harnessRoute({
    supported: settingsSupported,
    unsupported: descriptor => `Settings are not editable for ${descriptor.label}.`,
    errorStatus: error => (error instanceof SettingInputError ? 400 : 500),
    async run(descriptor, req, res) {
        const { settings, cwd } = (0, http_boundary_1.requestBody)(req);
        const cwdValue = optionalCwd(res, cwd);
        if (cwdValue === null)
            return;
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            return res.status(400).json({ error: 'settings must be an object mapping setting keys to values' });
        }
        const patch = Object.entries(settings);
        if (!patch.length)
            return res.status(400).json({ error: 'settings must name at least one setting' });
        for (const [key] of patch) {
            if (!SETTING_KEY.test(key))
                return res.status(400).json({ error: `Invalid setting key: ${key}` });
        }
        res.json(await queueHarnessConfigWrite(descriptor.id, async () => {
            const rows = new Map((await readSettings(descriptor)).settings.map(row => [row.key, row]));
            const commands = patch.map(([key, value]) => {
                const row = rows.get(key);
                if (!row)
                    throw new SettingInputError(`Not an editable ${descriptor.label} setting: ${key}`);
                return value === null ? descriptor.argv.configReset(key) : descriptor.argv.configSet(key, settingArgument(row, value));
            });
            // One CLI process per key, in order; a failure leaves earlier writes committed.
            for (const command of commands)
                await (0, harness_feature_commands_1.runHarnessJsonCommand)(descriptor, command);
            return readSettings(descriptor, cwdValue);
        }));
    },
});
