#!/usr/bin/env node
// Generated edge from skills/pi-dish-vault/scripts/cu-fill-seal.ts; edit that source and run npm run build:edges.
/**
 * One-shot sealer for cu-broker vault-fill envelope v1.
 *
 * Uses `node:crypto` only: reads a JSON header `{requestId, nonce, publicKey,
 * origin, label?}` from stdin, reads the approved credential fields injected by
 * `aac` from `CU_FILL_USERNAME`, `CU_FILL_PASSWORD`, and `CU_FILL_TOTP`, clears
 * those env vars immediately, and writes ONLY the sealed base64url envelope to
 * stdout. Never logs or echoes credential values.
 */
import crypto = require('node:crypto');
export declare const ENVELOPE_VERSION = 1;
export declare const ENVELOPE_ALG = "X25519-HKDF-SHA256-ChaCha20Poly1305";
export declare const ENVELOPE_LABEL = "cu-broker vault-fill v1";
export declare const FILL_ENV_VARS: {
    readonly username: 'CU_FILL_USERNAME';
    readonly password: 'CU_FILL_PASSWORD';
    readonly totp: 'CU_FILL_TOTP';
};
export type FillFieldName = keyof typeof FILL_ENV_VARS;
export type FillSealFields = Partial<Record<FillFieldName, string>>;
export interface FillSealHeader {
    readonly requestId: string;
    readonly nonce: string;
    readonly publicKey: string;
    readonly origin: string;
    readonly label?: string;
}
export interface SealEnvelopeOptions {
    /** Deterministic ephemeral X25519 private key for test vectors only. */
    readonly ephemeralPrivateKey?: crypto.KeyObject;
}
export declare function clearFillEnv(env?: NodeJS.ProcessEnv): void;
export declare function readFieldsFromEnv(env?: NodeJS.ProcessEnv): FillSealFields;
export declare function sealEnvelope(headerInput: FillSealHeader, fieldsInput: FillSealFields, options?: SealEnvelopeOptions): string;
