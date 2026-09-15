// Generated from src/core/helper-markdown.ts; edit that source and run npm run build:core.
import type { KatexRenderer, MathExtension } from './helper-types';
/**
 * Marked extensions for LaTeX math rendering via KaTeX.
 * Supports:
 * - Block math: $$...$$ and \[...\] (multiline or single-line)
 * - Inline math: $...$, \(...\), and $$...$$ (within paragraphs)
 *
 * Avoids false positives on currency ($10 to $20) and escaped dollars (\$100).
 */
export declare function createMathExtensions(getKatex: () => KatexRenderer | null | undefined): MathExtension[];
