import type { MathExtension } from './shared-helper-types';
export interface MarkedOptions {
  breaks: boolean; gfm: boolean;
  tokenizer: { del(this: { lexer: { inlineTokens(source: string): unknown[] } }, source: string): { type: string; raw: string; text: string; tokens: unknown[] } | undefined };
  renderer: { html(value: unknown): string };
  walkTokens(token: { type: string; href?: string }): void;
  extensions: MathExtension[];
}
export interface MarkedRuntime { use(options: MarkedOptions): void; parse(source: string): string }
export interface HighlightRuntime { highlightElement(element: HTMLElement): void }
export interface MermaidConfig {
  startOnLoad: false; securityLevel: 'strict'; suppressErrorRendering: true; theme: 'base'; fontFamily: string;
  flowchart: { htmlLabels: true; useMaxWidth: true }; themeVariables: Readonly<Record<string, string | boolean>>;
}
export interface MermaidRuntime { initialize(config: MermaidConfig): void; render(id: string, source: string): Promise<{ svg: string }> }
