// Generated from src/core/artifact-isolation.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARTIFACT_SANDBOX_POLICY = void 0;
exports.isolateArtifact = isolateArtifact;
exports.ARTIFACT_SANDBOX_POLICY = 'sandbox allow-scripts allow-forms allow-popups '
    + 'allow-popups-to-escape-sandbox allow-modals allow-downloads';
function isolateArtifact(res, kind) {
    const existing = res.getHeader('Content-Security-Policy');
    const policies = existing === undefined ? [] : (Array.isArray(existing) ? existing : [String(existing)]);
    // A relayed peer header arrives comma-joined, which CSP reads as a list.
    const enforced = policies.flatMap((policy) => policy.split(',').map((part) => part.trim()));
    if (!enforced.includes(exports.ARTIFACT_SANDBOX_POLICY)) {
        res.setHeader('Content-Security-Policy', [...policies, exports.ARTIFACT_SANDBOX_POLICY]);
    }
    // The opaque origin makes a page's own module scripts, fonts and fetches of
    // relative assets cross-origin; a token-addressed page reads them back.
    if (kind === 'page')
        res.setHeader('Access-Control-Allow-Origin', '*');
}
