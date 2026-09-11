import { record } from './helper-values';
export interface SlashCommand { readonly name: string; readonly description: string; readonly source: string; readonly args: string }
export interface FileCompletion { readonly path: string; readonly isDir: boolean; readonly gitStatus: string }
const text = (v: unknown) => typeof v === 'string' ? v : '';
export function decodeSlashCommands(value: unknown): readonly SlashCommand[] {
  return Array.isArray(value) ? value.flatMap((v: unknown) => record(v) && typeof v.name === 'string' && v.name ? [{ name: v.name, description: text(v.description), source: text(v.source), args: text(v.args) }] : []) : [];
}
export function decodeFileCompletions(value: unknown): readonly FileCompletion[] {
  return Array.isArray(value) ? value.flatMap((v: unknown) => record(v) && typeof v.path === 'string' ? [{ path: v.path, isDir: v.isDir === true, gitStatus: text(v.gitStatus) }] : []) : [];
}
