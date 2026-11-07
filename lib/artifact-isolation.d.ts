// Generated from src/core/artifact-isolation.ts; edit that source and run npm run build:core.
/**
 * Published pages and share exports are untrusted documents on the app's
 * origin. A CSP sandbox without `allow-same-origin` gives each an opaque
 * origin, so it cannot read app storage, call the API, register a service
 * worker, or script an app window. Hubs re-apply it to relayed peer artifacts.
 * CSP headers accumulate, so a stricter policy (file renderer) stays intact.
 */
import type { ServerResponse } from 'http';
export declare const ARTIFACT_SANDBOX_POLICY: string;
export declare function isolateArtifact(res: ServerResponse, kind: 'page' | 'share'): void;
