/**
 * Published pages and share exports are untrusted documents on the app's
 * origin. A CSP sandbox without `allow-same-origin` gives each an opaque
 * origin, so it cannot read app storage, call the API, register a service
 * worker, or script an app window. Hubs re-apply it to relayed peer artifacts.
 * CSP headers accumulate, so a stricter policy (file renderer) stays intact.
 */
import type { ServerResponse } from 'http';

export const ARTIFACT_SANDBOX_POLICY = 'sandbox allow-scripts allow-forms allow-popups '
  + 'allow-popups-to-escape-sandbox allow-modals allow-downloads';

export function isolateArtifact(res: ServerResponse, kind: 'page' | 'share'): void {
  const existing = res.getHeader('Content-Security-Policy');
  const policies = existing === undefined ? [] : (Array.isArray(existing) ? existing : [String(existing)]);
  // A relayed peer header arrives comma-joined, which CSP reads as a list.
  const enforced = policies.flatMap((policy) => policy.split(',').map((part) => part.trim()));
  if (!enforced.includes(ARTIFACT_SANDBOX_POLICY)) {
    res.setHeader('Content-Security-Policy', [...policies, ARTIFACT_SANDBOX_POLICY]);
  }
  // The opaque origin makes a page's own module scripts, fonts and fetches of
  // relative assets cross-origin; a token-addressed page reads them back.
  if (kind === 'page') res.setHeader('Access-Control-Allow-Origin', '*');
}
