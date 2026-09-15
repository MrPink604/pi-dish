// Generated from src/core/helper-models.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OMP_MODEL_ROLES = exports.OMP_ROLE_THINKING_LEVELS = exports.ALL_THINKING_LEVEL_NAMES = exports.PRIME_THINKING_LEVEL_NAMES = exports.OMP_THINKING_LEVEL_NAMES = exports.THINKING_LEVEL_NAMES = void 0;
exports.parseModelId = parseModelId;
exports.formatModelRef = formatModelRef;
exports.stripThinkingSuffix = stripThinkingSuffix;
exports.thinkingLevelNamesFor = thinkingLevelNamesFor;
exports.thinkingLevelsFor = thinkingLevelsFor;
exports.parseModelRoleRef = parseModelRoleRef;
exports.composeModelRoleRef = composeModelRoleRef;
exports.modelRoleLevels = modelRoleLevels;
exports.globToRegExp = globToRegExp;
exports.modelMatchesPattern = modelMatchesPattern;
exports.isModelEnabled = isModelEnabled;
exports.modelRoleRecord = modelRoleRecord;
exports.buildModelRoleRows = buildModelRoleRows;
exports.formatModelRoleSummary = formatModelRoleSummary;
/** "provider/id" → { provider, id } (provider '' when the ref is bare). */
function parseModelId(fullModelId) {
    const slashIdx = fullModelId.indexOf('/');
    if (slashIdx > 0) {
        return { provider: fullModelId.slice(0, slashIdx), id: fullModelId.slice(slashIdx + 1) };
    }
    return { provider: '', id: fullModelId };
}
/** Model object (or string ref) → "provider/id" string, null when unknown. */
function formatModelRef(model) {
    if (!model)
        return null;
    if (typeof model === 'string')
        return model;
    const provider = model.provider;
    const id = model.id || model.modelId;
    return provider && id ? `${provider}/${id}` : null;
}
/**
 * pi "scoped models": settings.enabledModels holds patterns picking which
 * models are enabled for cycling (the TUI's /scoped-models selector persists
 * exact "provider/id" strings; hand-edited settings may use minimatch-style
 * globs and an optional ":level" thinking suffix). Mirror pi's
 * resolveModelScope matching: try the full "provider/id", then the bare id.
 */
exports.THINKING_LEVEL_NAMES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
function stripThinkingSuffix(pattern) {
    const idx = pattern.lastIndexOf(':');
    if (idx === -1)
        return pattern;
    const suffix = pattern.slice(idx + 1).toLowerCase();
    return exports.THINKING_LEVEL_NAMES.includes(suffix) ? pattern.slice(0, idx) : pattern;
}
// OMP's harness-wide thinking vocabulary (omp --thinking): every model
// supports a subset (the catalog's `thinking` array), plus off/auto which
// are always accepted.
exports.OMP_THINKING_LEVEL_NAMES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'];
// Prime's harness-wide thinking vocabulary: pi's ladder plus a top 'max'
// rung (and no 'auto').
exports.PRIME_THINKING_LEVEL_NAMES = [...exports.THINKING_LEVEL_NAMES, 'max'];
// Union of every harness's vocabulary. Only useful as a cheap gate before a
// session's harness is known; thinkingLevelNamesFor decides.
exports.ALL_THINKING_LEVEL_NAMES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'];
/** The fixed thinking vocabulary a harness accepts (OMP's model-specific trimming lives in thinkingLevelsFor). */
function thinkingLevelNamesFor(harnessId) {
    if (harnessId === 'omp')
        return exports.OMP_THINKING_LEVEL_NAMES;
    if (harnessId === 'prime')
        return exports.PRIME_THINKING_LEVEL_NAMES;
    return exports.THINKING_LEVEL_NAMES;
}
/**
 * The levels a session's thinking dropdown should offer. Pi and Prime expose
 * one fixed vocabulary each (Prime's adds 'max'). OMP sessions get off/auto
 * plus the current model's supported subset when the catalog says what it
 * is; the full OMP vocabulary when it doesn't (an unsupported pick then
 * clamps, which the status line reports).
 */
function thinkingLevelsFor(harnessId, model) {
    if (harnessId !== 'omp')
        return thinkingLevelNamesFor(harnessId);
    const supported = Array.isArray(model?.thinking) && model.thinking.length
        ? model.thinking : exports.OMP_THINKING_LEVEL_NAMES.slice(0, -1);
    return [...new Set(['off', ...supported, 'auto'])];
}
// The levels a model-role value may pin as its ":level" suffix (OMP's
// /models roles editor). A bare ref means the role inherits the default
// thinking level; OMP also accepts an explicit ":inherit" spelling.
exports.OMP_ROLE_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'];
/**
 * Split a stored model-role value into its model ref and pinned thinking
 * level ('' = inherit). Mirrors OMP's resolution order: an exact catalog
 * match wins over suffix parsing, so a model id that itself ends in ":max"
 * is not mistaken for a level pin. An unrecognized suffix stays part of the
 * model — the harness resolves refs this catalog can't (aliases, providers
 * added out of band).
 */
function parseModelRoleRef(value, knownSelectors) {
    const ref = typeof value === 'string' ? value.trim() : '';
    if (!ref)
        return { model: '', level: '' };
    if (Array.isArray(knownSelectors) && knownSelectors.includes(ref))
        return { model: ref, level: '' };
    const idx = ref.lastIndexOf(':');
    if (idx > 0) {
        const suffix = ref.slice(idx + 1).toLowerCase();
        if (suffix === 'inherit')
            return { model: ref.slice(0, idx), level: '' };
        if (exports.OMP_ROLE_THINKING_LEVELS.includes(suffix))
            return { model: ref.slice(0, idx), level: suffix };
    }
    return { model: ref, level: '' };
}
/** Inverse of parseModelRoleRef: inherit stores as the bare model ref. */
function composeModelRoleRef(model, level) {
    const ref = typeof model === 'string' ? model.trim() : '';
    if (!ref)
        return '';
    return level && level !== 'inherit' ? `${ref}:${level}` : ref;
}
/**
 * The levels a role row may pin, in the order OMP's /models roles editor
 * offers them: off, auto, then the model's supported ladder (the full OMP
 * vocabulary when the catalog doesn't say). Inherit is the empty option the
 * select renders separately.
 */
function modelRoleLevels(model) {
    const supported = Array.isArray(model?.thinking) && model.thinking.length
        ? model.thinking : exports.OMP_THINKING_LEVEL_NAMES.slice(0, -1);
    return [...new Set(['off', 'auto', ...supported])];
}
// Glob → RegExp: * and ? don't cross "/" (minimatch semantics), [...] passes through.
// Returns null for a malformed glob (e.g. an unbalanced '[') rather than
// throwing — a hand-edited settings pattern must not take down /api/models.
function globToRegExp(glob) {
    const source = glob.replace(/[.+^${}()|\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
    try {
        return new RegExp('^' + source + '$', 'i');
    }
    catch {
        return null;
    }
}
function modelMatchesPattern(pattern, model) {
    const patternText = stripThinkingSuffix(String(pattern || ''));
    if (!patternText || !model || !model.id)
        return false;
    const fullId = (model.provider ? model.provider + '/' : '') + model.id;
    if (/[*?[]/.test(patternText)) {
        const re = globToRegExp(patternText);
        return !!re && (re.test(fullId) || re.test(model.id));
    }
    const p = patternText.toLowerCase();
    const id = model.id.toLowerCase();
    // Exact match, or the pattern is an alias for dated versions (claude-sonnet-4-5 → -20250929).
    return p === fullId.toLowerCase() || p === id || id.startsWith(p + '-');
}
/** No/empty patterns = no filter, everything enabled (pi's semantics). */
function isModelEnabled(patterns, model) {
    if (!Array.isArray(patterns) || patterns.length === 0)
        return true;
    const values = patterns;
    return values.some(p => modelMatchesPattern(p, model));
}
/**
 * OMP's canonical model roles in the harness's own order, with the names its
 * TUI uses. The stored record may also carry arbitrary custom role keys, so
 * consumers must treat this as the labelled subset, not the whole vocabulary.
 */
exports.OMP_MODEL_ROLES = [
    { key: 'default', name: 'Default', description: 'Main agent model' },
    { key: 'smol', name: 'Fast', description: 'Fast/cheap model for lightweight tasks, summaries, and fallbacks' },
    { key: 'slow', name: 'Thinking', description: 'Deep-reasoning model for thorough analysis' },
    { key: 'vision', name: 'Vision', description: 'Vision-capable model for image inspection and descriptions' },
    { key: 'plan', name: 'Architect', description: 'Planning/architecture mode' },
    { key: 'designer', name: 'Designer', description: 'UI and design tasks' },
    { key: 'commit', name: 'Commit', description: 'Commit message generation' },
    { key: 'tiny', name: 'Tiny', description: 'Session titles and micro-classifiers (falls back to smol)' },
    { key: 'task', name: 'Subtask', description: 'Default model for subagent tasks' },
    { key: 'advisor', name: 'Advisor', description: 'Paired reviewer model that watches each turn' },
];
function modelRoleRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === 'string' && !!entry[1]));
}
/**
 * Editor row model: canonical roles first (always shown, assigned or not),
 * then custom keys present in the global record. `value` is the *global*
 * assignment — the only one the editor may write — while `override` carries a
 * differing effective value, which a project `.omp/config.yml` wins with in
 * that cwd.
 */
function buildModelRoleRows(globalRoles, effectiveRoles) {
    const global = modelRoleRecord(globalRoles);
    const effective = modelRoleRecord(effectiveRoles);
    const row = (key, name, description, custom) => {
        const value = Object.hasOwn(global, key) ? global[key] : '';
        const effectiveValue = Object.hasOwn(effective, key) ? effective[key] : '';
        return {
            key, name, description, custom, value, effectiveValue,
            override: effectiveValue && effectiveValue !== value ? effectiveValue : null,
        };
    };
    const canonical = new Set(exports.OMP_MODEL_ROLES.map(role => role.key));
    return [
        ...exports.OMP_MODEL_ROLES.map(role => row(role.key, role.name, role.description, false)),
        ...Object.keys(global).filter(key => !canonical.has(key)).sort()
            .map(key => row(key, key, 'Custom role', true)),
    ];
}
/** One quiet line of role assignments for the new-session readout. */
function formatModelRoleSummary(roles, limit = 4) {
    const record = modelRoleRecord(roles);
    const order = exports.OMP_MODEL_ROLES.map(role => role.key);
    const rank = (key) => (order.indexOf(key) < 0 ? order.length : order.indexOf(key));
    const entries = Object.keys(record)
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
        .map(key => `${key} ${record[key]}`);
    if (!entries.length)
        return 'No roles assigned';
    const shown = entries.slice(0, limit);
    const rest = entries.length - shown.length;
    return shown.join(' · ') + (rest > 0 ? ` · +${rest} more` : '');
}
