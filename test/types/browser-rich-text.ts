import type { MermaidRuntime, MarkedRuntime } from '../../src/browser/rich-text-vendors';
import type { createBrowserAssets } from '../../src/browser/browser-assets';
declare const mermaid: MermaidRuntime;
declare const marked: MarkedRuntime;
declare const assets: ReturnType<typeof createBrowserAssets>;
// @ts-expect-error only script and stylesheet loaders are supported
assets.load('iframe', { src: 'vendor/frame' });
// @ts-expect-error diagram source is explicit text
mermaid.render('diagram', { text: 'flowchart LR' });
// @ts-expect-error markdown input is explicit text
marked.parse({ content: 'text' });
