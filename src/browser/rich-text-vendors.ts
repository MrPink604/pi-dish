import type { MathExtension } from '../core/helper-types';
export interface MarkedOptions {
  breaks: boolean; gfm: boolean;
  tokenizer: { del(this: { lexer: { inlineTokens(source: string): unknown[] } }, source: string): { type: string; raw: string; text: string; tokens: unknown[] } | undefined };
  renderer: { html(value: unknown): string };
  walkTokens(token: { type: string; href?: string }): void;
  extensions: MathExtension[];
}
/** One top-level block token; only the boundary fields the streamer reasons about. */
export interface MarkdownToken { type: string; raw: string }
export interface MarkedRuntime { use(options: MarkedOptions): void; parse(source: string): string; lexer(source: string): readonly MarkdownToken[] }
export interface HighlightRuntime { highlightElement(element: HTMLElement): void }
export interface MermaidConfig {
  startOnLoad: false; securityLevel: 'strict'; suppressErrorRendering: true; theme: 'base'; fontFamily: string;
  flowchart: { htmlLabels: true; useMaxWidth: true }; themeVariables: Readonly<Record<string, string | boolean>>;
}
export interface MermaidRuntime { initialize(config: MermaidConfig): void; render(id: string, source: string): Promise<{ svg: string }> }
