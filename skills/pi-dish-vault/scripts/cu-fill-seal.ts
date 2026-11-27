#!/usr/bin/env node
'use strict';
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

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_ALG = 'X25519-HKDF-SHA256-ChaCha20Poly1305';
export const ENVELOPE_LABEL = 'cu-broker vault-fill v1';

export const FILL_ENV_VARS = {
  username: 'CU_FILL_USERNAME',
  password: 'CU_FILL_PASSWORD',
  totp: 'CU_FILL_TOTP',
} as const;

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

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const ZERO_BYTE = Buffer.from([0]);
const VERSION_BYTE = Buffer.from([ENVELOPE_VERSION]);
const ALLOWED_FIELDS: readonly FillFieldName[] = ['username', 'password', 'totp'];
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const PRINTABLE_ASCII_RE = /^[\x21-\x7e]+$/;
const PUBLIC_KEY_B64U_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_STDIN_BYTES = 16 * 1024;
const MAX_SEALED_CHARS = 21_846;
const MAX_FIELD_VALUE_CHARS = 1024;
const MAX_ORIGIN_CHARS = 256;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllZero(buf: Buffer): boolean {
  let acc = 0;
  for (let i = 0; i < buf.length; i++) acc |= buf[i];
  return acc === 0;
}

function validateHeader(raw: unknown): Required<FillSealHeader> {
  if (!isPlainObject(raw)) throw new Error('stdin header must be a JSON object');
  const requestId = typeof raw.requestId === 'string' ? raw.requestId : '';
  if (!requestId || requestId.length > 128 || !PRINTABLE_ASCII_RE.test(requestId)) {
    throw new Error('invalid requestId');
  }
  const nonce = typeof raw.nonce === 'string' ? raw.nonce : '';
  if (!nonce || nonce.length > 128 || !PRINTABLE_ASCII_RE.test(nonce)) {
    throw new Error('invalid nonce');
  }
  const publicKey = typeof raw.publicKey === 'string' ? raw.publicKey : '';
  if (!PUBLIC_KEY_B64U_RE.test(publicKey)) {
    throw new Error('publicKey must be a 43-char base64url X25519 key');
  }
  const origin = typeof raw.origin === 'string' ? raw.origin : '';
  if (!origin || origin.length > MAX_ORIGIN_CHARS || !PRINTABLE_ASCII_RE.test(origin) || !origin.startsWith('https://')) {
    throw new Error('origin must be a bare https origin');
  }
  const label = raw.label === undefined ? ENVELOPE_LABEL : raw.label;
  if (typeof label !== 'string' || label !== ENVELOPE_LABEL) {
    throw new Error('unsupported envelope label');
  }
  return { requestId, nonce, publicKey, origin, label };
}

function validateFields(raw: FillSealFields): Record<string, string> {
  if (!isPlainObject(raw)) throw new Error('fields must be an object');
  const out: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (!(ALLOWED_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`unsupported field: ${key}`);
    }
    const value = raw[key as FillFieldName];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length < 1 || value.length > MAX_FIELD_VALUE_CHARS || CONTROL_CHAR_RE.test(value)) {
      throw new Error(`invalid value for field ${key}`);
    }
    out[key] = value;
  }
  if (Object.keys(out).length === 0) {
    throw new Error('at least one credential field is required');
  }
  return out;
}

export function clearFillEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const envName of Object.values(FILL_ENV_VARS)) {
    delete env[envName];
  }
}

export function readFieldsFromEnv(env: NodeJS.ProcessEnv = process.env): FillSealFields {
  const fields: FillSealFields = {};
  try {
    for (const field of ALLOWED_FIELDS) {
      const envName = FILL_ENV_VARS[field];
      const value = env[envName];
      if (value !== undefined && value !== '') {
        fields[field] = value;
      }
    }
  } finally {
    clearFillEnv(env);
  }
  return fields;
}

export function sealEnvelope(
  headerInput: FillSealHeader,
  fieldsInput: FillSealFields,
  options: SealEnvelopeOptions = {},
): string {
  const header = validateHeader(headerInput);
  const fields = validateFields(fieldsInput);

  const recipientRaw = Buffer.from(header.publicKey, 'base64url');
  if (recipientRaw.length !== 32 || isAllZero(recipientRaw)) {
    throw new Error('publicKey must decode to a valid 32-byte X25519 key');
  }
  const recipient = crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, recipientRaw]),
    format: 'der',
    type: 'spki',
  });

  const ephPrivate = options.ephemeralPrivateKey ?? crypto.generateKeyPairSync('x25519').privateKey;
  const ephPublic = crypto.createPublicKey(ephPrivate);
  const epk = ephPublic.export({ format: 'der', type: 'spki' }).subarray(-32);
  if (epk.length !== 32) throw new Error('ephemeral public key must be 32 bytes');

  const labelBuf = Buffer.from(header.label, 'ascii');
  const ridBuf = Buffer.from(header.requestId, 'ascii');
  const originBuf = Buffer.from(header.origin, 'ascii');

  let shared: Buffer | null = null;
  let okm: Buffer | null = null;
  let plaintext: Buffer | null = null;
  try {
    shared = crypto.diffieHellman({ privateKey: ephPrivate, publicKey: recipient });
    if (shared.length !== 32 || isAllZero(shared)) {
      throw new Error('X25519 key agreement produced a low-order shared secret');
    }
    const salt = Buffer.concat([epk, recipientRaw]);
    const info = Buffer.concat([labelBuf, ZERO_BYTE, ridBuf]);
    okm = Buffer.from(crypto.hkdfSync('sha256', shared, salt, info, 44));
    const aad = Buffer.concat([labelBuf, ZERO_BYTE, ridBuf, ZERO_BYTE, originBuf]);
    plaintext = Buffer.from(JSON.stringify({
      v: ENVELOPE_VERSION,
      requestId: header.requestId,
      nonce: header.nonce,
      fields,
    }), 'utf8');
    const cipher = crypto.createCipheriv(
      'chacha20-poly1305',
      okm.subarray(0, 32),
      okm.subarray(32, 44),
      { authTagLength: 16 },
    );
    cipher.setAAD(aad, { plaintextLength: plaintext.length });
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    const sealed = Buffer.concat([VERSION_BYTE, epk, ct]).toString('base64url');
    if (sealed.length > MAX_SEALED_CHARS) {
      throw new Error('sealed envelope exceeded maximum size');
    }
    return sealed;
  } finally {
    if (shared) shared.fill(0);
    if (okm) okm.fill(0);
    if (plaintext) plaintext.fill(0);
  }
}

function readStdinBounded(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    process.stdin.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      total += buf.length;
      if (total > MAX_STDIN_BYTES) {
        process.stdin.destroy();
        fail(new Error('stdin header exceeded size limit'));
        return;
      }
      chunks.push(buf);
    });
    process.stdin.on('error', () => fail(new Error('failed to read stdin header')));
    process.stdin.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

async function main(): Promise<void> {
  const fields = readFieldsFromEnv(process.env);
  try {
    const raw = await readStdinBounded();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('stdin header is not valid JSON');
    }
    const sealed = sealEnvelope(parsed as FillSealHeader, fields);
    process.stdout.write(sealed);
  } catch (error) {
    clearFillEnv(process.env);
    const message = error instanceof Error ? error.message : 'sealing failed';
    process.stderr.write(`cu-fill-seal: ${message}\n`);
    process.exitCode = 1;
  } finally {
    clearFillEnv(process.env);
    for (const key of Object.keys(fields) as FillFieldName[]) {
      delete fields[key];
    }
  }
}

if (require.main === module) void main();
