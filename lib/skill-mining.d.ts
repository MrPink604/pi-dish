// Generated from src/core/skill-mining.ts; edit that source and run npm run build:core.
import type { SessionEntries } from './session-metadata-contracts';
import type { SkillActivation, SkillState, SkillProjection } from './session-index-data';
export interface SkillContext {
    roots?: ReadonlyMap<string, string>;
}
export interface SkillMiningOptions {
    sessionId?: string | null;
    skillCtx?: SkillContext | null;
    home?: string;
    initialState?: SkillState | null;
}
export interface SkillBlock {
    name: string;
    location: string;
}
export interface SkillPath {
    skill: string;
    file: string;
}
/**
 * Match pi's own skill-block format (AgentSession.parseSkillBlock). Kept in
 * sync with that regex deliberately — explicit invocations must be detected
 * via pi's format, not a heuristic. Returns { name, location } or null.
 */
export declare function parseSkillBlockText(text: unknown): SkillBlock | null;
/**
 * Last line a truncated `read` result actually returned, parsed from the
 * tool's text notice rather than guessed from the requested range.
 */
export declare function parseTruncationNotice(text: unknown): number | null;
/**
 * Trivially-parseable line ranges for a targeted (bash) access to `token`.
 * `sed -n '10,50p' file` → [[10,50]]; a grep-style access → null (a touch,
 * never fabricated line data).
 */
export declare function parseTargetedRanges(command: unknown, token: string): SkillActivation['ranges'];
/** Classify SKILL.md itself, or a file beneath an inventory skill directory. */
export declare function classifySkillPath(absPath: string | null | undefined, ctx?: SkillContext | null): SkillPath | null;
/**
 * Mine every skill-activation record from one session's JSONL content.
 * `opts.skillCtx.roots` is a Map(skillDir → SKILL.md path) from the inventory;
 * when empty, SKILL.md reads and explicit blocks are still detected.
 */
export declare function mineSkillsFromContent(content: unknown, opts?: SkillMiningOptions): SkillActivation[];
/**
 * Entry-based form so the session-index parse pass can feed one parsed-entry
 * array to every derivation, and so an appended byte range can be mined
 * incrementally: `initialState` is the `{ cwd, provider, model }` continuity
 * returned by the previous call over the earlier part of the same file.
 * Returns `{ records, state }`. Known incremental-fidelity limit: a read
 * toolCall and its toolResult can straddle two appended batches, in which
 * case the un-ranged-read truncation recovery (pass 1) misses — the record
 * still lands, minus its recovered end line, until the next full re-index.
 */
export declare function mineSkillsFromEntries(entries: SessionEntries, opts?: SkillMiningOptions): SkillProjection;
