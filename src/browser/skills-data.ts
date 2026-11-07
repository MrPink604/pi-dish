import { record, finite, text, count } from '../core/helper-values';
export interface SkillUsage {
  readonly lastUsedTs: number | null; readonly count30d: number; readonly total: number;
  readonly sessionCount: number; readonly cwdCount: number; readonly topCwd: string; readonly weeks12: readonly number[];
}
export interface SkillEntry {
  readonly skill: string; readonly filePath: string; readonly baseDir: string; readonly name: string;
  readonly description: string; readonly source: string; readonly advertised: boolean;
  readonly bodyTokensEst: number; readonly bodyBytes: number; readonly catalogTokensEst: number; readonly usage: SkillUsage;
}
export interface SkillRefine {
  readonly mode: 'default' | 'skill' | 'path'; readonly discovered: boolean; readonly skillName: string; readonly mdPath: string;
}
export interface SkillDirectory {
  readonly skills: readonly SkillEntry[]; readonly scope: string; readonly indexing: boolean; readonly refine: SkillRefine;
  readonly summary: { readonly discovered: number; readonly advertised: number; readonly catalogTokensEst: number; readonly activations30d: number; readonly quiet60d: number };
}
export interface SkillSection {
  readonly heading: string; readonly startLine: number; readonly endLine: number; readonly reads: number;
  readonly fraction: number; readonly neverRead: boolean; readonly lines: readonly { readonly text: string; readonly hits: number }[];
}
export interface SkillCoverage {
  readonly skill: string; readonly numMapped: number; readonly excludedBeforeMtime: number; readonly flatFullRead: boolean;
  readonly sections: readonly SkillSection[]; readonly unreadTokensEst: number; readonly targetedTouches: number;
  readonly cwdCount: number; readonly topCwd: string; readonly mtimeMs: number; readonly weeks26: readonly number[];
  readonly kindSplit: { readonly read: number; readonly explicit: number }; readonly sessionCount: number;
  readonly latest: { readonly sessionId: string; readonly entryId: string; readonly name: string; readonly ts: number; readonly model: string } | null;
}
const object = (value: unknown): Record<string, unknown> => record(value) ? value : {};
const numbers = (value: unknown): readonly number[] => Array.isArray(value) ? value.map(count) : [];
export function decodeSkillDirectory(value: unknown): SkillDirectory {
  if (!record(value) || !Array.isArray(value.skills)) throw new Error('Invalid skills directory');
  const summary = object(value.summary), refine = object(value.refine);
  return { scope: text(value.scope), indexing: value.indexing === true,
    refine: { mode: refine.mode === 'skill' || refine.mode === 'path' ? refine.mode : 'default', discovered: refine.discovered === true, skillName: text(refine.skillName), mdPath: text(refine.mdPath) },
    summary: { discovered: count(summary.discovered), advertised: count(summary.advertised), catalogTokensEst: count(summary.catalogTokensEst), activations30d: count(summary.activations30d), quiet60d: count(summary.quiet60d) },
    skills: value.skills.flatMap((row: unknown) => {
      if (!record(row) || typeof row.skill !== 'string' || !row.skill) return [];
      const usage = object(row.usage);
      return [{ skill: row.skill, filePath: text(row.filePath) || row.skill, baseDir: text(row.baseDir), name: text(row.name), description: text(row.description),
        source: text(row.source), advertised: row.advertised === true, bodyTokensEst: count(row.bodyTokensEst), bodyBytes: count(row.bodyBytes), catalogTokensEst: count(row.catalogTokensEst),
        usage: { lastUsedTs: finite(usage.lastUsedTs) ? usage.lastUsedTs : null, count30d: count(usage.count30d), total: count(usage.total), sessionCount: count(usage.sessionCount),
          cwdCount: count(usage.cwdCount), topCwd: text(usage.topCwd), weeks12: numbers(usage.weeks12) } }];
    }),
  };
}
export function decodeSkillCoverage(value: unknown): SkillCoverage {
  if (!record(value) || typeof value.skill !== 'string' || !value.skill) throw new Error('Invalid skill coverage');
  const kinds = object(value.kindSplit), latest = object(value.latest);
  const sections: unknown[] = Array.isArray(value.sections) ? value.sections : [];
  return { skill: value.skill, numMapped: count(value.numMapped), excludedBeforeMtime: count(value.excludedBeforeMtime), flatFullRead: value.flatFullRead === true,
    unreadTokensEst: count(value.unreadTokensEst), targetedTouches: count(value.targetedTouches), cwdCount: count(value.cwdCount), topCwd: text(value.topCwd),
    mtimeMs: count(value.mtimeMs), weeks26: numbers(value.weeks26), kindSplit: { read: count(kinds.read), explicit: count(kinds.explicit) }, sessionCount: count(value.sessionCount),
    latest: typeof latest.sessionId === 'string' && latest.sessionId ? { sessionId: latest.sessionId, entryId: text(latest.entryId), name: text(latest.name), ts: count(latest.ts), model: text(latest.model) } : null,
    sections: sections.flatMap(section => {
      if (!record(section)) return [];
      const lines: unknown[] = Array.isArray(section.lines) ? section.lines : [];
      return [{ heading: text(section.heading), startLine: count(section.startLine), endLine: count(section.endLine), reads: count(section.reads),
        fraction: Math.max(0, Math.min(1, count(section.fraction))), neverRead: section.neverRead === true,
        lines: lines.flatMap(line => record(line) ? [{ text: text(line.text), hits: count(line.hits) }] : []) }];
    }),
  };
}
