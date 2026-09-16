import type { SessionFields } from './session-api';
/** Structural inputs for pure helpers. Feature controllers decode wire data before use. */
export type Timestamp = string | number | Date;
/** Lightweight helper input, shared with server projections that still carry Dates. */
export interface HelperSession extends Readonly<Pick<SessionFields<Timestamp>,
  'name' | 'cwd' | 'model' | 'lastActivity' | 'isActive' | 'turnInProgress' |
  'parentId' | 'familyParentId' | 'routine' | 'routineId'>> {
  readonly id: string;
  readonly host?: string | null;
  readonly hostLabel?: string | null;
  readonly activity?: number;
  readonly capabilities?: Readonly<NonNullable<SessionFields['capabilities']>>;
}
export interface HelperHost {
  hostId?: string | null;
  name?: string | null;
  label?: string | null;
  base?: string;
  self?: boolean;
  capabilities?: Readonly<Record<string, boolean | undefined>>;
}
export interface ModelRef { readonly id?: string; readonly modelId?: string; readonly provider?: string; readonly thinking?: readonly string[] | null }
export interface SessionQueryTerm { readonly neg: boolean; readonly field: string | null; readonly value: string }
export interface SessionQuery { terms: SessionQueryTerm[]; since: number | null; before: number | null }
export interface RefContextEntry { readonly ref: string; readonly name?: string; readonly host?: string; readonly cwd?: string; readonly isActive?: boolean | null }
export interface ImageBlock { readonly url?: string; readonly data?: string; readonly mimeType: string }
export interface KatexRenderer { renderToString(source: string, options: { displayMode: boolean; throwOnError: false }): string }
export interface MathToken { type: string; raw: string; text: string; display?: boolean }
export interface MathExtension { name: string; level: 'block' | 'inline'; start(source: string): number | undefined; tokenizer(source: string): MathToken | undefined; renderer(token: MathToken): string }
