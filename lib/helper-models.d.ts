// Generated from src/core/helper-models.ts; edit that source and run npm run build:core.
import type { ModelRef } from './helper-types';
/** "provider/id" → { provider, id } (provider '' when the ref is bare). */
export declare function parseModelId(fullModelId: string): {
    provider: string;
    id: string;
};
/** Model object (or string ref) → "provider/id" string, null when unknown. */
export declare function formatModelRef(model?: ModelRef | string | null): string | null;
/**
 * pi "scoped models": settings.enabledModels holds patterns picking which
 * models are enabled for cycling (the TUI's /scoped-models selector persists
 * exact "provider/id" strings; hand-edited settings may use minimatch-style
 * globs and an optional ":level" thinking suffix). Mirror pi's
 * resolveModelScope matching: try the full "provider/id", then the bare id.
 */
export declare const THINKING_LEVEL_NAMES: string[];
export declare function stripThinkingSuffix(pattern: string): string;
export declare const OMP_THINKING_LEVEL_NAMES: string[];
export declare const PRIME_THINKING_LEVEL_NAMES: string[];
export declare const ALL_THINKING_LEVEL_NAMES: string[];
/** The fixed thinking vocabulary a harness accepts (OMP's model-specific trimming lives in thinkingLevelsFor). */
export declare function thinkingLevelNamesFor(harnessId?: string): string[];
/**
 * The levels a session's thinking dropdown should offer. Pi and Prime expose
 * one fixed vocabulary each (Prime's adds 'max'). OMP sessions get off/auto
 * plus the current model's supported subset when the catalog says what it
 * is; the full OMP vocabulary when it doesn't (an unsupported pick then
 * clamps, which the status line reports).
 */
export declare function thinkingLevelsFor(harnessId?: string, model?: ModelRef | null): string[];
export declare const OMP_ROLE_THINKING_LEVELS: string[];
/**
 * Split a stored model-role value into its model ref and pinned thinking
 * level ('' = inherit). Mirrors OMP's resolution order: an exact catalog
 * match wins over suffix parsing, so a model id that itself ends in ":max"
 * is not mistaken for a level pin. An unrecognized suffix stays part of the
 * model — the harness resolves refs this catalog can't (aliases, providers
 * added out of band).
 */
export declare function parseModelRoleRef(value: unknown, knownSelectors?: readonly string[]): {
    model: string;
    level: string;
};
/** Inverse of parseModelRoleRef: inherit stores as the bare model ref. */
export declare function composeModelRoleRef(model: unknown, level?: string | null): string;
/**
 * The levels a role row may pin, in the order OMP's /models roles editor
 * offers them: off, auto, then the model's supported ladder (the full OMP
 * vocabulary when the catalog doesn't say). Inherit is the empty option the
 * select renders separately.
 */
export declare function modelRoleLevels(model?: ModelRef | null): string[];
export declare function globToRegExp(glob: string): RegExp | null;
export declare function modelMatchesPattern(pattern: unknown, model?: ModelRef | null): boolean;
/** No/empty patterns = no filter, everything enabled (pi's semantics). */
export declare function isModelEnabled(patterns: unknown, model?: ModelRef | null): boolean;
/**
 * OMP's canonical model roles in the harness's own order, with the names its
 * TUI uses. The stored record may also carry arbitrary custom role keys, so
 * consumers must treat this as the labelled subset, not the whole vocabulary.
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
 * Editor row model: canonical roles first (always shown, assigned or not),
 * then custom keys present in the global record. `value` is the *global*
 * assignment — the only one the editor may write — while `override` carries a
 * differing effective value, which a project `.omp/config.yml` wins with in
 * that cwd.
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
