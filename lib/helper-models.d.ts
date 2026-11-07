// Generated from src/core/helper-models.ts; edit that source and run npm run build:core.
import type { ModelRef } from './helper-types';
/** "provider/id" → { provider, id } (provider '' when the ref is bare). */
export declare function parseModelId(fullModelId: string): {
    provider: string;
    id: string;
};
/** Model object (or string ref) → "provider/id" string, null when unknown. */
export declare function formatModelRef(model?: ModelRef | string | null): string | null;
export declare const THINKING_LEVEL_NAMES: string[];
export declare function stripThinkingSuffix(pattern: string): string;
export declare const OMP_THINKING_LEVEL_NAMES: string[];
export declare const PRIME_THINKING_LEVEL_NAMES: string[];
export declare const ALL_THINKING_LEVEL_NAMES: string[];
/** Fixed per-harness vocabulary; OMP's per-model trimming lives in thinkingLevelsFor. */
export declare function thinkingLevelNamesFor(harnessId?: string): string[];
/**
 * OMP sessions get off/auto plus the model's supported subset, or the full OMP
 * vocabulary when the catalog doesn't say (an unsupported pick then clamps).
 */
export declare function thinkingLevelsFor(harnessId?: string, model?: ModelRef | null): string[];
export declare const OMP_ROLE_THINKING_LEVELS: string[];
/**
 * Split a model-role value into model ref and pinned level ('' = inherit). Like
 * OMP, an exact catalog match wins over suffix parsing; an unrecognized suffix
 * stays part of the model, since the harness resolves refs this catalog can't.
 */
export declare function parseModelRoleRef(value: unknown, knownSelectors?: readonly string[]): {
    model: string;
    level: string;
};
/** Inverse of parseModelRoleRef: inherit stores as the bare model ref. */
export declare function composeModelRoleRef(model: unknown, level?: string | null): string;
/**
 * OMP's /models roles editor order: off, auto, then the model's supported
 * ladder. Inherit is the empty option the select renders separately.
 */
export declare function modelRoleLevels(model?: ModelRef | null): string[];
export declare function globToRegExp(glob: string): RegExp | null;
export declare function modelMatchesPattern(pattern: unknown, model?: ModelRef | null): boolean;
/**
 * pi scoped models (settings.enabledModels): exact "provider/id", minimatch
 * globs, optional ":level" suffix; matched like pi's resolveModelScope. No or
 * empty patterns enable everything.
 */
export declare function isModelEnabled(patterns: unknown, model?: ModelRef | null): boolean;
/**
 * OMP's canonical roles in its own order and TUI names. Stored records may add
 * custom role keys, so this is the labelled subset, not the whole vocabulary.
 */
export declare const OMP_MODEL_ROLES: {
    key: string;
    name: string;
    description: string;
}[];
export declare function modelRoleRecord(value: unknown): {
    [k: string]: string;
};
/**
 * Canonical roles first, then custom keys from the global record. `value` is
 * the *global* assignment (the only one the editor writes); `override` is a
 * differing effective value from a project `.omp/config.yml`.
 */
export declare function buildModelRoleRows(globalRoles: unknown, effectiveRoles: unknown): {
    key: string;
    name: string;
    description: string;
    custom: boolean;
    value: string;
    effectiveValue: string;
    override: string | null;
}[];
/** One quiet line of role assignments for the new-session readout. */
export declare function formatModelRoleSummary(roles: unknown, limit?: number): string;
