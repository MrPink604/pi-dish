// Generated from src/core/skill-mining.ts; edit that source and run npm run build:core.
import type { SessionEntries } from './session-metadata';
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
/** Deliberately mirrors pi's AgentSession.parseSkillBlock regex, not a heuristic. */
export declare function parseSkillBlockText(text: unknown): SkillBlock | null;
/** Last line a truncated `read` actually returned, parsed from the tool's notice. */
export declare function parseTruncationNotice(text: unknown): number | null;
export declare function parseTargetedRanges(command: unknown, token: string): SkillActivation['ranges'];
export declare function classifySkillPath(absPath: string | null | undefined, ctx?: SkillContext | null): SkillPath | null;
/** With empty `opts.skillCtx.roots`, SKILL.md reads and explicit blocks are still detected. */
export declare function mineSkillsFromContent(content: unknown, opts?: SkillMiningOptions): SkillActivation[];
/**
 * `initialState` carries `{ cwd, provider, model }` from the previous call so
 * appended byte ranges mine incrementally. Limit: a read toolCall/toolResult
 * pair straddling two batches loses its truncation end line until re-index.
 */
export declare function mineSkillsFromEntries(entries: SessionEntries, opts?: SkillMiningOptions): SkillProjection;
