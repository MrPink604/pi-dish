// Generated from src/core/skills.ts; edit that source and run npm run build:core.
import type { ResourceDiagnostic, Skill } from '@earendil-works/pi-coding-agent' with { 'resolution-mode': 'import' };
type SkillDiagnostic = Pick<ResourceDiagnostic, 'type' | 'message' | 'path'>;
interface BundleFile {
    file: string;
    bytes: number;
}
export interface SkillsInventoryOptions {
    cwds?: readonly string[];
    scope?: string;
}
export interface InventorySkill {
    skill: string;
    name: string;
    description: string;
    source: string;
    advertised: boolean;
    filePath: string;
    baseDir: string;
    bodyBytes: number;
    bodyTokensEst: number;
    catalogFragment: string | null;
    catalogTokensEst: number;
    mtimeMs: number;
    files: BundleFile[];
    diagnostics: SkillDiagnostic[];
    precision: 'estimate';
}
export interface SkillsInventory {
    scope: string;
    discovered: number;
    advertised: number;
    catalogTokensEst: number;
    preambleTokensEst: number;
    diagnostics: SkillDiagnostic[];
    skills: InventorySkill[];
    precision: 'estimate';
}
export declare function catalogFragment(skill: Pick<Skill, 'name' | 'description' | 'filePath'>): string;
/** Scan project roots plus global user skills, optionally restricted to one cwd. */
export declare function getSkillsInventory(opts?: SkillsInventoryOptions): Promise<SkillsInventory>;
/** Absolute SKILL.md paths for the mining context (session-index.setSkillRoots). */
export declare function getSkillFilePaths(opts?: SkillsInventoryOptions): Promise<string[]>;
export declare function _resetCacheForTests(): void;
export {};
