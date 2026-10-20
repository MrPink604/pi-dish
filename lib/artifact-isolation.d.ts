// Generated from src/core/artifact-isolation.ts; edit that source and run npm run build:core.
/**
 * Published pages and share exports are untrusted documents served from the
 * app's own origin. A CSP sandbox without `allow-same-origin` gives each
 * document an opaque origin: its scripts, forms and popups work, but it cannot
 * read the app's storage, call the API as a same-origin client, register a
 * service worker, or script an app window. Both the owning host and a hub
 * relaying a peer's artifact apply it, so an older peer's response is isolated
 * too. Policies only accumulate (every CSP header is enforced), which keeps a
 * stricter policy such as the file renderer's intact.
 */
import type { ServerResponse } from 'http';
export declare const ARTIFACT_SANDBOX_POLICY: string;
export declare function isolateArtifact(res: ServerResponse, kind: 'page' | 'share'): void;
