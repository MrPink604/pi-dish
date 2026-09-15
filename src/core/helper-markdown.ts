import type { KatexRenderer, MathExtension } from './helper-types';
import { escapeHtml } from './helper-format';
/**
 * Marked extensions for LaTeX math rendering via KaTeX.
 * Supports:
 * - Block math: $$...$$ and \[...\] (multiline or single-line)
 * - Inline math: $...$, \(...\), and $$...$$ (within paragraphs)
 *
 * Avoids false positives on currency ($10 to $20) and escaped dollars (\$100).
 */
export function createMathExtensions(getKatex: () => KatexRenderer | null | undefined) {

  const blockMath: MathExtension = {
    name: 'blockMath',
    level: 'block',
    start(src) {
      const match = src.match(/\$\$|\\\[/);
      return match ? match.index : -1;
    },
    tokenizer(src) {
      const match = /^(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])/.exec(src);
      if (match) {
        const text = match[1] !== undefined ? match[1] : match[2];
        return {
          type: 'blockMath',
          raw: match[0],
          text: text.trim(),
        };
      }
    },
    renderer(token) {
      const k = getKatex();
      if (!k) return `<pre class="math-block"><code>${escapeHtml(token.raw)}</code></pre>\n`;
      try {
        return `<div class="math-block">${k.renderToString(token.text, { displayMode: true, throwOnError: false })}</div>\n`;
      } catch (e) {
        return `<pre class="math-error"><code>${escapeHtml(token.raw)}</code></pre>\n`;
      }
    },
  };

  const inlineMath: MathExtension = {
    name: 'inlineMath',
    level: 'inline',
    start(src) {
      const match = src.match(/\$|\\\(|\\\[/);
      return match ? match.index : -1;
    },
    tokenizer(src) {
      const bracketMatch = /^\\\[([\s\S]*?)\\\]/.exec(src);
      if (bracketMatch) {
        return {
          type: 'inlineMath',
          raw: bracketMatch[0],
          text: bracketMatch[1].trim(),
          display: true,
        };
      }
      const parenMatch = /^\\\(([\s\S]*?)\\\)/.exec(src);
      if (parenMatch) {
        return {
          type: 'inlineMath',
          raw: parenMatch[0],
          text: parenMatch[1].trim(),
          display: false,
        };
      }
      const doubleDollarMatch = /^\$\$([\s\S]*?)\$\$/.exec(src);
      if (doubleDollarMatch) {
        return {
          type: 'inlineMath',
          raw: doubleDollarMatch[0],
          text: doubleDollarMatch[1].trim(),
          display: true,
        };
      }
      const dollarMatch = /^\$((?:\\\$|[^\$\s\n])(?:(?:\\\$|[^\$\n])*?(?:\\\$|[^\$\s\n]))?)\$/.exec(src);
      if (dollarMatch) {
        return {
          type: 'inlineMath',
          raw: dollarMatch[0],
          text: dollarMatch[1],
          display: false,
        };
      }
    },
    renderer(token) {
      const k = getKatex();
      if (!k) return escapeHtml(token.raw);
      try {
        return k.renderToString(token.text, { displayMode: Boolean(token.display), throwOnError: false });
      } catch (e) {
        return escapeHtml(token.raw);
      }
    },
  };

  return [blockMath, inlineMath];
}
