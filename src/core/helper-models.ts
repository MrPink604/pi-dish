import type { ModelRef } from './helper-types';

/** "provider/id" → { provider, id } (provider '' when the ref is bare). */
export function parseModelId(fullModelId: string) {
  const slashIdx = fullModelId.indexOf('/');
  if (slashIdx > 0) {
    return { provider: fullModelId.slice(0, slashIdx), id: fullModelId.slice(slashIdx + 1) };
  }
  return { provider: '', id: fullModelId };
}

/** Model object (or string ref) → "provider/id" string, null when unknown. */
export function formatModelRef(model?: ModelRef | string | null) {
  if (!model) return null;
  if (typeof model === 'string') return model;
  const provider = model.provider;
  const id = model.id || model.modelId;
  return provider && id ? `${provider}/${id}` : null;
}

export const THINKING_LEVEL_NAMES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export function stripThinkingSuffix(pattern: string) {
  const idx = pattern.lastIndexOf(':');
  if (idx === -1) return pattern;
  const suffix = pattern.slice(idx + 1).toLowerCase();
  return THINKING_LEVEL_NAMES.includes(suffix) ? pattern.slice(0, idx) : pattern;
}

// OMP's harness-wide vocabulary; each model supports a subset (catalog
// `thinking`), plus off/auto which are always accepted.
export const OMP_THINKING_LEVEL_NAMES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'];

// Pi's ladder plus a top 'max' rung (no 'auto').
export const PRIME_THINKING_LEVEL_NAMES = [...THINKING_LEVEL_NAMES, 'max'];

// Cheap gate before a session's harness is known; thinkingLevelNamesFor decides.
export const ALL_THINKING_LEVEL_NAMES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'];

/** Fixed per-harness vocabulary; OMP's per-model trimming lives in thinkingLevelsFor. */
export function thinkingLevelNamesFor(harnessId?: string) {
  if (harnessId === 'omp') return OMP_THINKING_LEVEL_NAMES;
  if (harnessId === 'prime') return PRIME_THINKING_LEVEL_NAMES;
  return THINKING_LEVEL_NAMES;
}

/**
 * OMP sessions get off/auto plus the model's supported subset, or the full OMP
 * vocabulary when the catalog doesn't say (an unsupported pick then clamps).
 */
export function thinkingLevelsFor(harnessId?: string, model?: ModelRef | null) {
  if (harnessId !== 'omp') return thinkingLevelNamesFor(harnessId);
  const supported: readonly string[] = Array.isArray(model?.thinking) && model.thinking.length
    ? model.thinking : OMP_THINKING_LEVEL_NAMES.slice(0, -1);
  return [...new Set(['off', ...supported, 'auto'])];
}

// Levels a model-role value may pin as its ":level" suffix. A bare ref (or
// OMP's explicit ":inherit") inherits the default thinking level.
export const OMP_ROLE_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'];

/**
 * Split a model-role value into model ref and pinned level ('' = inherit). Like
 * OMP, an exact catalog match wins over suffix parsing; an unrecognized suffix
 * stays part of the model, since the harness resolves refs this catalog can't.
 */
export function parseModelRoleRef(value: unknown, knownSelectors?: readonly string[]) {
  const ref = typeof value === 'string' ? value.trim() : '';
  if (!ref) return { model: '', level: '' };
  if (Array.isArray(knownSelectors) && knownSelectors.includes(ref)) return { model: ref, level: '' };
  const idx = ref.lastIndexOf(':');
  if (idx > 0) {
    const suffix = ref.slice(idx + 1).toLowerCase();
    if (suffix === 'inherit') return { model: ref.slice(0, idx), level: '' };
    if (OMP_ROLE_THINKING_LEVELS.includes(suffix)) return { model: ref.slice(0, idx), level: suffix };
  }
  return { model: ref, level: '' };
}

/** Inverse of parseModelRoleRef: inherit stores as the bare model ref. */
export function composeModelRoleRef(model: unknown, level?: string | null) {
  const ref = typeof model === 'string' ? model.trim() : '';
  if (!ref) return '';
  return level && level !== 'inherit' ? `${ref}:${level}` : ref;
}

/**
 * OMP's /models roles editor order: off, auto, then the model's supported
 * ladder. Inherit is the empty option the select renders separately.
 */
export function modelRoleLevels(model?: ModelRef | null) {
  const supported: readonly string[] = Array.isArray(model?.thinking) && model.thinking.length
    ? model.thinking : OMP_THINKING_LEVEL_NAMES.slice(0, -1);
  return [...new Set(['off', 'auto', ...supported])];
}

// * and ? don't cross "/" (minimatch semantics). Null for a malformed glob: a
// hand-edited settings pattern must not take down /api/models.
export function globToRegExp(glob: string) {
  const source = glob.replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  try {
    return new RegExp('^' + source + '$', 'i');
  } catch {
    return null;
  }
}

export function modelMatchesPattern(pattern: unknown, model?: ModelRef | null) {
  const patternText = stripThinkingSuffix(String(pattern || ''));
  if (!patternText || !model || !model.id) return false;
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

/**
 * pi scoped models (settings.enabledModels): exact "provider/id", minimatch
 * globs, optional ":level" suffix; matched like pi's resolveModelScope. No or
 * empty patterns enable everything.
 */
export function isModelEnabled(patterns: unknown, model?: ModelRef | null) {
  if (!Array.isArray(patterns) || patterns.length === 0) return true;
  const values: unknown[] = patterns;
  return values.some(p => modelMatchesPattern(p, model));
}

/**
 * OMP's canonical roles in its own order and TUI names. Stored records may add
 * custom role keys, so this is the labelled subset, not the whole vocabulary.
 */
export const OMP_MODEL_ROLES = [
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

export function modelRoleRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1]));
}

/**
 * Canonical roles first, then custom keys from the global record. `value` is
 * the *global* assignment (the only one the editor writes); `override` is a
 * differing effective value from a project `.omp/config.yml`.
 */
export function buildModelRoleRows(globalRoles: unknown, effectiveRoles: unknown) {
  const global = modelRoleRecord(globalRoles);
  const effective = modelRoleRecord(effectiveRoles);
  const row = (key: string, name: string, description: string, custom: boolean) => {
    const value = Object.hasOwn(global, key) ? global[key] : '';
    const effectiveValue = Object.hasOwn(effective, key) ? effective[key] : '';
    return {
      key, name, description, custom, value, effectiveValue,
      override: effectiveValue && effectiveValue !== value ? effectiveValue : null,
    };
  };
  const canonical = new Set(OMP_MODEL_ROLES.map(role => role.key));
  return [
    ...OMP_MODEL_ROLES.map(role => row(role.key, role.name, role.description, false)),
    ...Object.keys(global).filter(key => !canonical.has(key)).sort()
      .map(key => row(key, key, 'Custom role', true)),
  ];
}

/** One quiet line of role assignments for the new-session readout. */
export function formatModelRoleSummary(roles: unknown, limit = 4) {
  const record = modelRoleRecord(roles);
  const order = OMP_MODEL_ROLES.map(role => role.key);
  const rank = (key: string) => (order.indexOf(key) < 0 ? order.length : order.indexOf(key));
  const entries = Object.keys(record)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(key => `${key} ${record[key]}`);
  if (!entries.length) return 'No roles assigned';
  const shown = entries.slice(0, limit);
  const rest = entries.length - shown.length;
  return shown.join(' · ') + (rest > 0 ? ` · +${rest} more` : '');
}
