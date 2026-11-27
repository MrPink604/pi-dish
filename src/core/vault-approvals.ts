/**
 * Operator approval of each Bitwarden item an agent asks for. The unlocked
 * `bw` session lives in the Agent Access listener; pi-dish records decisions
 * and never sees a secret. Pending requests and grants stay in memory on
 * purpose (a restart forgets them); per-device policies are read from
 * `~/.pi/dish/vault/policies.json` and every request/decision is appended to
 * `~/.pi/dish/vault-audit.ndjson` (0600).
 * The bridge requires a loopback peer plus `~/.pi/dish/vault/bridge.token`;
 * the model is cooperative (any agent with this UID could read the token).
 */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import dishStore = require('./dish-store');
import { asRecord } from './wire-protocol';
import type { NextFunction, Request, Response } from 'express';
import type { PushPayload } from './push-notifications';

export const VAULT_FIELDS = ['username', 'password', 'totp', 'uri', 'notes'] as const;
/** A built-in field, or `field:<name>` for a custom (text or hidden) field of the item. */
export type VaultField = typeof VAULT_FIELDS[number] | `field:${string}`;
const CUSTOM_FIELD_RE = /^field:[^\u0000-\u001f\u007f]{1,128}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
export const BRIDGE_HEADER = 'x-pi-dish-vault-bridge';
export const GRANT_WINDOW_MS = 15 * 60 * 1000;
export const LISTENER_STALE_MS = 45 * 1000;
export const MAX_REQUEST_LIFETIME_MS = 10 * 60 * 1000;
export const RECENT_LIMIT = 20;
export const VAULT_POLICY_FILE = 'policies.json';
export const VAULT_ENROLLED_FILE = 'enrolled.json';
export const VAULT_AUDIT_FILE = 'vault-audit.ndjson';
export const VAULT_AUDIT_MAX_BYTES = 1024 * 1024;
export const VAULT_AUDIT_READ_MAX_BYTES = 2 * 1024 * 1024;
const AUDIT_READ_CHUNK_BYTES = 64 * 1024;
const AUDIT_DEFAULT_LIMIT = 100;
const AUDIT_MAX_LIMIT = 500;
const AUDIT_MAX_FIELDS = 64;
const MAX_ITEM_URIS = 64;
const MAX_URI_CHARS = 2048;
const MAX_ORIGIN_CHARS = 512;
const PUSH_BODY_CHARS = 180;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const FINGERPRINT_RE = /^[0-9a-fA-F]{8,128}$/;
const POLICY_FINGERPRINT_RE = /^[0-9a-fA-F]{64}$/;
const POLICY_KEYS = new Set(['name', 'allowFolder', 'allowFolderId', 'allowedFields', 'allowWindow', 'allowCreate', 'requireOriginMatch']);

export interface VaultDevice { readonly name: string; readonly fingerprint: string }
export interface VaultSessionClaim { readonly ref: string; readonly name: string | null; readonly host: string | null }
export type VaultRequestStatus = 'pending' | 'approved' | 'denied' | 'expired';
export type VaultDecision = 'approve' | 'approve-window' | 'deny';
/** `release` hands existing fields to one command; `create` adds one login with a listener-generated password. */
export type VaultAction = 'release' | 'create';
export type VaultOriginMatch = 'match' | 'mismatch' | 'no-origin';
export type VaultAuditEvent = 'request' | 'decision';
export type VaultAuditActor = 'listener' | 'policy' | 'grant' | 'operator' | 'timeout';

export interface VaultDevicePolicy {
  readonly name?: string;
  readonly allowFolder?: string;
  readonly allowFolderId?: string;
  readonly allowedFields?: readonly VaultField[];
  readonly allowWindow?: boolean;
  readonly allowCreate?: boolean;
  readonly requireOriginMatch?: boolean;
}

export interface VaultAuditEntry {
  readonly ts: string;
  readonly event: VaultAuditEvent;
  readonly requestId: string;
  readonly action: VaultAction;
  readonly deviceFingerprint: string;
  readonly deviceName: string;
  readonly itemId: string | null;
  readonly itemName: string;
  readonly fields: readonly VaultField[];
  readonly folderId: string | null;
  readonly folder: string | null;
  readonly origin: string | null;
  readonly originMatch: VaultOriginMatch;
  readonly decision: string;
  readonly by: VaultAuditActor;
  readonly policyResult: string;
  readonly policyName: string | null;
}

export interface VaultAuditQuery {
  readonly limit?: number;
  readonly device?: string;
  readonly decision?: string;
  readonly maxBytes?: number;
}

export interface VaultRequest {
  readonly id: string;
  readonly device: VaultDevice;
  readonly action: VaultAction;
  /** The existing item's Bitwarden id when reported by the listener; null for old listeners or `create`. */
  readonly itemId: string | null;
  /** The existing item's name, or the new login's name. */
  readonly item: string;
  /** The requested fields, or for `create` the fields the new login will have. */
  readonly fields: readonly VaultField[];
  /** The item's Bitwarden folder id when reported by the listener; enforced by id when present in policy. */
  readonly folderId: string | null;
  /** The item's folder name (display when folderId is enforced; exact untrimmed match otherwise) or destination folder (for `create`). */
  readonly folder: string | null;
  /** Optional target origin (`scheme://host[:port]`) for origin-checked requests. */
  readonly origin: string | null;
  /** Whether `origin` matched an `https:` stored URI of the item. */
  readonly originMatch: VaultOriginMatch;
  /** False for `create` or when device policy disables 15-minute windows. */
  readonly allowWindow: boolean;
  /** Device policy name when a policy entry governs this device; null when unrestricted. */
  readonly policyName: string | null;
  /** Policy verdict recorded when the request was admitted (`default` or `allowed`). */
  readonly policyResult: string;
  /** Requester-claimed; shown as such. */
  readonly reason: string | null;
  /** Requester-claimed; shown as such. */
  readonly session: VaultSessionClaim | null;
  readonly createdAt: number;
  readonly expiresAt: number;
  status: VaultRequestStatus;
  decidedAt: number | null;
  /** Approved by a grant rather than a decision. */
  auto: boolean;
  grantId: string | null;
}

export interface VaultGrant {
  readonly id: string;
  readonly device: VaultDevice;
  readonly itemId: string | null;
  readonly item: string;
  readonly fields: readonly VaultField[];
  readonly sessionRef: string | null;
  readonly origin: string | null;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface VaultListenerStatus {
  readonly state: 'locked' | 'ready';
  readonly account: string | null;
  readonly devices: readonly VaultDevice[];
  readonly updatedAt: number;
}

export interface VaultOverview {
  readonly listener: (VaultListenerStatus & { readonly stale: boolean }) | null;
  readonly pending: readonly VaultRequest[];
  readonly recent: readonly VaultRequest[];
  readonly grants: readonly VaultGrant[];
}

type Failure = { readonly ok: false; readonly status: 400 | 403 | 404 | 409 | 500; readonly error: string };
type Result<T> = { readonly ok: true; readonly value: T } | Failure;

export interface VaultApprovalPorts {
  /** Called once when a request becomes pending (never for grant auto-approvals or policy refusals). */
  notify(request: VaultRequest): void;
  now?(): number;
  policyFile?(): string;
  enrolledFile?(): string;
  auditFile?(): string;
  auditMaxBytes?: number;
}

export interface VaultApprovals {
  overview(): VaultOverview;
  reportStatus(body: unknown): Result<VaultListenerStatus>;
  createRequest(body: unknown): Result<VaultRequest>;
  requestStatus(id: string): Result<VaultRequest>;
  abandon(id: string): Result<VaultRequest>;
  decide(id: string, decision: unknown): Result<VaultRequest>;
  revokeGrant(id: string): Result<VaultGrant>;
  audit(query?: VaultAuditQuery): readonly VaultAuditEntry[];
}

function fail(status: Failure['status'], error: string): Failure { return { ok: false, status, error }; }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function cleanString(value: unknown, max: number): string | null {
  const text = boundedString(value, max);
  return text && !CONTROL_CHAR_RE.test(text) ? text : null;
}

/** Single-line non-blank string with NO trimming (preserves exact folder names and ids). */
function exactCleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  if (!value.trim() || value.length > max || CONTROL_CHAR_RE.test(value)) return null;
  return value;
}

function optionalString(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return boundedString(value, max) ?? undefined;
}

function optionalCleanString(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return cleanString(value, max) ?? undefined;
}

function optionalExactCleanString(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return exactCleanString(value, max) ?? undefined;
}

function defaultPolicyFile(): string {
  return path.join(dishStore.dishDir(), 'vault', VAULT_POLICY_FILE);
}

function defaultEnrolledFile(policyPath: string): string {
  return path.join(path.dirname(policyPath), VAULT_ENROLLED_FILE);
}

function defaultAuditFile(): string {
  return path.join(dishStore.dishDir(), VAULT_AUDIT_FILE);
}

function decodeDevice(value: unknown): VaultDevice | null {
  const device = asRecord(value);
  const name = boundedString(device.name, 64);
  const fingerprint = typeof device.fingerprint === 'string' && FINGERPRINT_RE.test(device.fingerprint) ? device.fingerprint.toLowerCase() : null;
  return name && fingerprint ? { name, fingerprint } : null;
}

/** Unique field names: built-ins in canonical order, then custom fields as requested; null when empty or invalid. */
export function decodeFields(value: unknown): VaultField[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  return decodeFieldList(value);
}

function decodeFieldList(value: readonly unknown[]): VaultField[] | null {
  const wanted = new Set<unknown>(value);
  if (wanted.size !== value.length) return null;
  const custom: VaultField[] = [];
  for (const field of wanted) {
    if (VAULT_FIELDS.includes(field as typeof VAULT_FIELDS[number])) continue;
    if (typeof field !== 'string' || !CUSTOM_FIELD_RE.test(field)) return null;
    custom.push(field as `field:${string}`);
  }
  return [...VAULT_FIELDS.filter(field => wanted.has(field)), ...custom];
}

function sameFieldList(a: readonly VaultField[], b: readonly VaultField[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function decodeSession(value: unknown): VaultSessionClaim | null | undefined {
  if (value === undefined || value === null) return null;
  const session = asRecord(value);
  const ref = boundedString(session.ref, 200);
  const name = optionalString(session.name, 200);
  const host = optionalString(session.host, 100);
  if (!ref || name === undefined || host === undefined) return undefined;
  return { ref, name, host };
}

function decodeItemUris(value: unknown): readonly string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEM_URIS) return null;
  const uris: string[] = [];
  for (const entry of value) {
    const uri = cleanString(entry, MAX_URI_CHARS);
    if (!uri) return null;
    uris.push(uri);
  }
  return uris;
}

/** Parses a bare `http(s)://host[:port]` origin (no path, query, hash, userinfo, or wildcard authority). */
export function parseOrigin(raw: string): { readonly origin: string; readonly https: boolean } | null {
  if (!raw || raw.length > MAX_ORIGIN_CHARS || /[\u0000-\u0020\u007f]/.test(raw)) return null;
  if (!/^https?:\/\//i.test(raw) || raw.includes('?') || raw.includes('#') || raw.includes('@') || raw.includes('\\') || raw.includes('*') || /%2a/i.test(raw)) return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname !== '/' || !parsed.hostname || parsed.hostname.includes('*') || parsed.origin === 'null') return null;
  const afterScheme = raw.slice(parsed.protocol.length + 2);
  if (afterScheme.includes('/')) return null;
  return { origin: parsed.origin, https: parsed.protocol === 'https:' };
}

/** Extracts the exact `https:` origin of a stored Bitwarden URI; non-https, any userinfo (including empty `@`), wildcard authorities, or unparseable URIs yield null. */
export function httpsOriginOfUri(raw: string): string | null {
  if (!raw || raw.length > MAX_URI_CHARS || CONTROL_CHAR_RE.test(raw)) return null;
  const trimmed = raw.trim();
  if (!/^https:\/\//i.test(trimmed)) return null;
  const afterScheme = trimmed.slice('https://'.length);
  const authorityEnd = afterScheme.search(/[/?#\\]/);
  const authority = authorityEnd === -1 ? afterScheme : afterScheme.slice(0, authorityEnd);
  if (!authority || authority.includes('@') || authority.includes('*') || /%2a/i.test(authority)) return null;
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return null; }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.hostname.includes('*') || parsed.username || parsed.password || parsed.origin === 'null') return null;
  return parsed.origin;
}

/** Exact scheme+host+port (`https` only) match between a parsed request origin and an item's stored URIs. */
export function evaluateOriginMatch(
  origin: { readonly origin: string; readonly https: boolean } | null,
  itemUris: readonly string[],
): VaultOriginMatch {
  if (!origin) return 'no-origin';
  if (!origin.https || !itemUris.length) return 'mismatch';
  for (const uri of itemUris) {
    if (httpsOriginOfUri(uri) === origin.origin) return 'match';
  }
  return 'mismatch';
}

export type VaultPolicyLoadResult =
  | { readonly ok: true; readonly missing: boolean; readonly policies: ReadonlyMap<string, VaultDevicePolicy> }
  | { readonly ok: false; readonly error: string };

export type VaultEnrolledLoadResult =
  | { readonly state: 'ok'; readonly fingerprints: ReadonlySet<string> }
  | { readonly state: 'missing' }
  | { readonly state: 'error'; readonly error: string };

export type VaultPolicyResolution =
  | { readonly state: 'policy'; readonly policy: VaultDevicePolicy }
  | { readonly state: 'legacy' }
  | { readonly state: 'refused'; readonly policyResult: 'policy_config_error' | 'policy_missing_enrolled'; readonly error: string };

/** Writes `enrolled.json` atomically with strict 0600 permissions before rename. */
function persistEnrolledFingerprints(file: string, fingerprints: Iterable<string>): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sorted = [...new Set(fingerprints)].sort();
  const payload = `${JSON.stringify({ fingerprints: sorted }, null, 2)}\n`;
  try {
    if ((fs.statSync(file).mode & 0o777) === 0o600 && fs.readFileSync(file, 'utf8') === payload) return;
  } catch {}
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.fchmodSync(fd, 0o600);
      fs.writeFileSync(fd, payload);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    dishStore.syncDirectory(dir);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export function loadEnrolledFingerprints(file: string): VaultEnrolledLoadResult {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (isPlainObject(error) && error.code === 'ENOENT') return { state: 'missing' };
    return { state: 'error', error: `Could not read enrolled devices file: ${error instanceof Error ? error.message : String(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'error', error: 'Enrolled devices file is not valid JSON' };
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.fingerprints)) {
    return { state: 'error', error: 'Enrolled devices file must contain a "fingerprints" array' };
  }
  const fingerprints = new Set<string>();
  for (const raw of parsed.fingerprints) {
    if (typeof raw !== 'string' || !POLICY_FINGERPRINT_RE.test(raw)) {
      return { state: 'error', error: 'Enrolled devices file contains an invalid fingerprint' };
    }
    fingerprints.add(raw.toLowerCase());
  }
  return { state: 'ok', fingerprints };
}

/**
 * Loads per-device policies from `policies.json`. Policy keys must be 64-char
 * hex fingerprints (32-byte ids), normalized lowercase. On every successful
 * load of an existing policy file, persists the enrolled fingerprint set to
 * `enrolled.json` (0600, atomic).
 */
export function loadVaultPolicies(
  file: string = defaultPolicyFile(),
  enrolledPath: string | null = defaultEnrolledFile(file),
): VaultPolicyLoadResult {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (isPlainObject(error) && error.code === 'ENOENT') return { ok: true, missing: true, policies: new Map() };
    return { ok: false, error: `Could not read vault policies: ${error instanceof Error ? error.message : String(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Vault policy file is not valid JSON' };
  }
  if (!isPlainObject(parsed)) return { ok: false, error: 'Vault policy file must be a JSON object' };
  const topKeys = Object.keys(parsed);
  if (topKeys.length !== 1 || topKeys[0] !== 'devices' || !isPlainObject(parsed.devices)) {
    return { ok: false, error: 'Vault policy file must contain only a "devices" object' };
  }
  const policies = new Map<string, VaultDevicePolicy>();
  for (const [rawKey, rawEntry] of Object.entries(parsed.devices)) {
    if (!POLICY_FINGERPRINT_RE.test(rawKey)) {
      return { ok: false, error: `Invalid device fingerprint key in vault policies (must be 64 hex chars): ${rawKey}` };
    }
    const fingerprint = rawKey.toLowerCase();
    if (policies.has(fingerprint)) return { ok: false, error: `Duplicate device fingerprint in vault policies: ${fingerprint}` };
    if (!isPlainObject(rawEntry)) return { ok: false, error: `Policy for ${fingerprint} must be an object` };
    for (const key of Object.keys(rawEntry)) {
      if (!POLICY_KEYS.has(key)) return { ok: false, error: `Unknown policy key "${key}" for ${fingerprint}` };
    }
    let name: string | undefined;
    if (rawEntry.name !== undefined) {
      const value = cleanString(rawEntry.name, 64);
      if (!value) return { ok: false, error: `Invalid "name" in policy for ${fingerprint}` };
      name = value;
    }
    let allowFolder: string | undefined;
    if (rawEntry.allowFolder !== undefined) {
      const value = exactCleanString(rawEntry.allowFolder, 256);
      if (!value) return { ok: false, error: `Invalid "allowFolder" in policy for ${fingerprint}` };
      allowFolder = value;
    }
    let allowFolderId: string | undefined;
    if (rawEntry.allowFolderId !== undefined) {
      const value = exactCleanString(rawEntry.allowFolderId, 128);
      if (!value) return { ok: false, error: `Invalid "allowFolderId" in policy for ${fingerprint}` };
      allowFolderId = value;
    }
    let allowedFields: readonly VaultField[] | undefined;
    if (rawEntry.allowedFields !== undefined) {
      if (!Array.isArray(rawEntry.allowedFields)) return { ok: false, error: `Invalid "allowedFields" in policy for ${fingerprint}` };
      const fields = decodeFieldList(rawEntry.allowedFields);
      if (!fields) return { ok: false, error: `Invalid field entry in "allowedFields" for ${fingerprint}` };
      allowedFields = fields;
    }
    let allowWindow: boolean | undefined;
    if (rawEntry.allowWindow !== undefined) {
      if (typeof rawEntry.allowWindow !== 'boolean') return { ok: false, error: `Invalid "allowWindow" in policy for ${fingerprint}` };
      allowWindow = rawEntry.allowWindow;
    }
    let allowCreate: boolean | undefined;
    if (rawEntry.allowCreate !== undefined) {
      if (typeof rawEntry.allowCreate !== 'boolean') return { ok: false, error: `Invalid "allowCreate" in policy for ${fingerprint}` };
      allowCreate = rawEntry.allowCreate;
    }
    let requireOriginMatch: boolean | undefined;
    if (rawEntry.requireOriginMatch !== undefined) {
      if (typeof rawEntry.requireOriginMatch !== 'boolean') return { ok: false, error: `Invalid "requireOriginMatch" in policy for ${fingerprint}` };
      requireOriginMatch = rawEntry.requireOriginMatch;
    }
    policies.set(fingerprint, {
      ...(name !== undefined ? { name } : {}),
      ...(allowFolder !== undefined ? { allowFolder } : {}),
      ...(allowFolderId !== undefined ? { allowFolderId } : {}),
      ...(allowedFields !== undefined ? { allowedFields } : {}),
      ...(allowWindow !== undefined ? { allowWindow } : {}),
      ...(allowCreate !== undefined ? { allowCreate } : {}),
      ...(requireOriginMatch !== undefined ? { requireOriginMatch } : {}),
    });
  }
  if (enrolledPath !== null) {
    try {
      persistEnrolledFingerprints(enrolledPath, policies.keys());
    } catch (error) {
      console.error(`[vault] could not persist enrolled devices: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: true, missing: false, policies };
}

/**
 * Resolves effective policy authority for one device fingerprint:
 * - Valid `policies.json`: enforces the device's entry (or legacy if unlisted).
 * - Missing or malformed `policies.json`: refuses any fingerprint present in
 *   `enrolled.json` (or already admitted under a policy), while never-enrolled
 *   devices keep the legacy path.
 * - Missing `policies.json` + unreadable `enrolled.json`: logs and falls back to legacy.
 */
export function resolveDevicePolicy(
  fingerprint: string,
  policyPath: string = defaultPolicyFile(),
  enrolledPath: string = defaultEnrolledFile(policyPath),
  knownRestricted = false,
): VaultPolicyResolution {
  const normalized = fingerprint.toLowerCase();
  const loaded = loadVaultPolicies(policyPath, enrolledPath);
  if (loaded.ok) {
    if (!loaded.missing) {
      const policy = loaded.policies.get(normalized);
      return policy ? { state: 'policy', policy } : { state: 'legacy' };
    }
    const enrolled = loadEnrolledFingerprints(enrolledPath);
    if (enrolled.state === 'ok') {
      if (enrolled.fingerprints.has(normalized) || knownRestricted) {
        return {
          state: 'refused',
          policyResult: 'policy_missing_enrolled',
          error: 'Vault policy file is missing for an enrolled device; refusing request',
        };
      }
      return { state: 'legacy' };
    }
    if (enrolled.state === 'error') {
      console.error(`[vault] unreadable enrolled.json with missing policies.json: ${enrolled.error}`);
    }
    if (knownRestricted) {
      return {
        state: 'refused',
        policyResult: 'policy_missing_enrolled',
        error: 'Vault policy file is missing for an enrolled device; refusing request',
      };
    }
    return { state: 'legacy' };
  }

  // policies.json exists but is malformed or unreadable.
  const enrolled = loadEnrolledFingerprints(enrolledPath);
  console.error(`[vault] invalid policies.json: ${loaded.error}`);
  if (enrolled.state === 'ok') {
    if (enrolled.fingerprints.has(normalized) || knownRestricted) {
      return {
        state: 'refused',
        policyResult: 'policy_config_error',
        error: 'Vault policy configuration is invalid for an enrolled device; refusing request',
      };
    }
    return { state: 'legacy' };
  }
  if (enrolled.state === 'missing') {
    if (knownRestricted) {
      return {
        state: 'refused',
        policyResult: 'policy_config_error',
        error: 'Vault policy configuration is invalid for an enrolled device; refusing request',
      };
    }
    return { state: 'legacy' };
  }
  console.error(`[vault] unreadable enrolled.json while policies.json is invalid: ${enrolled.error}`);
  return {
    state: 'refused',
    policyResult: 'policy_config_error',
    error: 'Vault policy configuration and enrollment list are unreadable; refusing request',
  };
}

interface PolicyEvaluationInput {
  readonly action: VaultAction;
  readonly folderId: string | null;
  readonly folder: string | null;
  readonly fields: readonly VaultField[];
  readonly parsedOrigin: { readonly origin: string; readonly https: boolean } | null;
  readonly itemUris: readonly string[];
  readonly originMatch: VaultOriginMatch;
}

type PolicyEvaluation =
  | { readonly ok: true; readonly policyName: string | null; readonly policyResult: 'default' | 'allowed'; readonly allowWindow: boolean }
  | { readonly ok: false; readonly policyName: string; readonly policyResult: string; readonly error: string };

function evaluateDevicePolicy(
  policy: VaultDevicePolicy | undefined,
  input: PolicyEvaluationInput,
): PolicyEvaluation {
  if (!policy) {
    return { ok: true, policyName: null, policyResult: 'default', allowWindow: input.action === 'release' };
  }
  const policyName = policy.name ?? 'restricted';
  if (input.action === 'create' && policy.allowCreate === false) {
    return { ok: false, policyName, policyResult: 'denied:create_not_allowed', error: 'Policy refuses item creation for this device' };
  }
  if (policy.allowFolderId !== undefined) {
    // Enforced strictly by Bitwarden folder id; folder name is display-only.
    if (input.folderId !== policy.allowFolderId) {
      return {
        ok: false,
        policyName,
        policyResult: 'denied:folder_not_allowed',
        error: 'Policy allows only items in the configured folder id',
      };
    }
  } else if (policy.allowFolder !== undefined && input.folder !== policy.allowFolder) {
    return {
      ok: false,
      policyName,
      policyResult: 'denied:folder_not_allowed',
      error: `Policy allows only items in folder "${policy.allowFolder}"`,
    };
  }
  if (policy.allowedFields !== undefined) {
    const allowed = new Set<VaultField>(policy.allowedFields);
    const disallowed = input.fields.filter(field => !allowed.has(field));
    if (disallowed.length) {
      return {
        ok: false,
        policyName,
        policyResult: 'denied:field_not_allowed',
        error: `Policy refuses requested field(s): ${disallowed.join(', ')}`,
      };
    }
  }
  if (policy.requireOriginMatch === true) {
    if (!input.parsedOrigin) {
      return { ok: false, policyName, policyResult: 'denied:origin_required', error: 'Policy requires a request origin' };
    }
    if (!input.parsedOrigin.https) {
      return { ok: false, policyName, policyResult: 'denied:origin_not_https', error: 'Policy requires an https origin' };
    }
    if (!input.itemUris.length) {
      return { ok: false, policyName, policyResult: 'denied:item_has_no_uri', error: 'Policy refuses items with no stored URI' };
    }
    if (input.originMatch !== 'match') {
      return { ok: false, policyName, policyResult: 'denied:origin_mismatch', error: 'Request origin does not match any stored https URI of the item' };
    }
  }
  return {
    ok: true,
    policyName,
    policyResult: 'allowed',
    allowWindow: input.action === 'release' && policy.allowWindow !== false,
  };
}

function truncateString(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function truncateOptionalString(value: string | null, max: number): string | null {
  return value === null ? null : truncateString(value, max);
}

function projectAuditFields(fields: readonly VaultField[]): readonly VaultField[] {
  return fields.slice(0, AUDIT_MAX_FIELDS).map(field => truncateString(field, 136) as VaultField);
}

/** Projects and bounds an audit entry to the strict non-secret allowlist. */
function projectAuditEntry(entry: VaultAuditEntry): VaultAuditEntry {
  return {
    ts: truncateString(entry.ts, 64),
    event: entry.event,
    requestId: truncateString(entry.requestId, 64),
    action: entry.action,
    deviceFingerprint: truncateString(entry.deviceFingerprint, 128),
    deviceName: truncateString(entry.deviceName, 64),
    itemId: truncateOptionalString(entry.itemId, 128),
    itemName: truncateString(entry.itemName, 256),
    fields: projectAuditFields(entry.fields),
    folderId: truncateOptionalString(entry.folderId, 128),
    folder: truncateOptionalString(entry.folder, 256),
    origin: truncateOptionalString(entry.origin, MAX_ORIGIN_CHARS),
    originMatch: entry.originMatch,
    decision: truncateString(entry.decision, 64),
    by: entry.by,
    policyResult: truncateString(entry.policyResult, 128),
    policyName: truncateOptionalString(entry.policyName, 64),
  };
}

const VALID_AUDIT_ACTORS = new Set<VaultAuditActor>(['listener', 'policy', 'grant', 'operator', 'timeout']);

/** Projects a parsed JSON record from disk through the exact same allowlist and bounds used on write. */
function projectAuditEntryFromUnknown(raw: unknown): VaultAuditEntry | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.ts !== 'string' || typeof raw.requestId !== 'string' || typeof raw.decision !== 'string') return null;
  if (raw.event !== 'request' && raw.event !== 'decision') return null;
  if (raw.action !== 'release' && raw.action !== 'create') return null;
  if (typeof raw.deviceFingerprint !== 'string' || typeof raw.deviceName !== 'string' || typeof raw.itemName !== 'string') return null;
  if (!Array.isArray(raw.fields)) return null;
  const fields: VaultField[] = [];
  for (const field of raw.fields.slice(0, AUDIT_MAX_FIELDS)) {
    if (typeof field !== 'string') continue;
    if (VAULT_FIELDS.includes(field as typeof VAULT_FIELDS[number]) || CUSTOM_FIELD_RE.test(field)) {
      fields.push(truncateString(field, 136) as VaultField);
    }
  }
  const originMatch: VaultOriginMatch = raw.originMatch === 'match' || raw.originMatch === 'mismatch' || raw.originMatch === 'no-origin'
    ? raw.originMatch
    : 'no-origin';
  if (typeof raw.by !== 'string' || !VALID_AUDIT_ACTORS.has(raw.by as VaultAuditActor)) return null;
  if (typeof raw.policyResult !== 'string') return null;
  return projectAuditEntry({
    ts: raw.ts,
    event: raw.event,
    requestId: raw.requestId,
    action: raw.action,
    deviceFingerprint: raw.deviceFingerprint,
    deviceName: raw.deviceName,
    itemId: typeof raw.itemId === 'string' ? raw.itemId : null,
    itemName: raw.itemName,
    fields,
    folderId: typeof raw.folderId === 'string' ? raw.folderId : null,
    folder: typeof raw.folder === 'string' ? raw.folder : null,
    origin: typeof raw.origin === 'string' ? raw.origin : null,
    originMatch,
    decision: raw.decision,
    by: raw.by as VaultAuditActor,
    policyResult: raw.policyResult,
    policyName: typeof raw.policyName === 'string' ? raw.policyName : null,
  });
}

/**
 * Appends one projected, bounded secret-free audit line (0600), rotating to `.1`
 * against the projected post-append size. If rotation fails while the file would
 * exceed `maxBytes`, refuses to append, logs the error, and throws.
 */
function appendVaultAudit(file: string, entry: VaultAuditEntry, maxBytes: number): void {
  const line = `${JSON.stringify(projectAuditEntry(entry))}\n`;
  const lineBytes = Buffer.byteLength(line, 'utf8');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let currentSize = 0;
  try {
    currentSize = fs.statSync(file).size;
  } catch (error) {
    if (!isPlainObject(error) || error.code !== 'ENOENT') throw error;
  }
  if (currentSize > 0 && currentSize + lineBytes > maxBytes) {
    try {
      fs.renameSync(file, `${file}.1`);
      fs.chmodSync(`${file}.1`, 0o600);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[vault] audit rotate failed while over cap: ${detail}`);
      throw new Error(`Vault audit rotation failed while over size cap: ${detail}`);
    }
  }
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }
}

function collectAuditTailFromFile(
  file: string,
  budgetBytes: number,
  limit: number,
  filter: { readonly device?: string; readonly decision?: string },
  out: VaultAuditEntry[],
): number {
  if (budgetBytes <= 0 || out.length >= limit) return budgetBytes;
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch (error) {
    if (isPlainObject(error) && error.code === 'ENOENT') return budgetBytes;
    throw error;
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= 0) return budgetBytes;
    const stopAt = Math.max(0, size - budgetBytes);
    let pos = size;
    let carry: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let remaining = budgetBytes;

    const acceptLine = (rawLine: Buffer): void => {
      const trimmed = rawLine.toString('utf8').trim();
      if (!trimmed) return;
      try {
        const projected = projectAuditEntryFromUnknown(JSON.parse(trimmed));
        if (!projected) return;
        if (filter.device && projected.deviceFingerprint !== filter.device) return;
        if (filter.decision && projected.decision !== filter.decision) return;
        out.push(projected);
      } catch {
        // Ignore a corrupt or truncated line rather than failing the whole read.
      }
    };

    while (pos > stopAt && out.length < limit) {
      const readSize = Math.min(AUDIT_READ_CHUNK_BYTES, pos - stopAt);
      pos -= readSize;
      const buf = Buffer.allocUnsafe(readSize);
      const bytesRead = fs.readSync(fd, buf, 0, readSize, pos);
      remaining -= bytesRead;
      const slice = bytesRead === readSize ? buf : buf.subarray(0, bytesRead);
      const combined = carry.length ? Buffer.concat([slice, carry]) : slice;
      let lineEnd = combined.length;
      let idx = lineEnd > 0 ? combined.lastIndexOf(0x0a, lineEnd - 1) : -1;
      while (idx !== -1) {
        acceptLine(combined.subarray(idx + 1, lineEnd));
        if (out.length >= limit) return Math.max(0, remaining);
        lineEnd = idx;
        idx = lineEnd > 0 ? combined.lastIndexOf(0x0a, lineEnd - 1) : -1;
      }
      carry = combined.subarray(0, lineEnd);
    }
    // Emit leading line only if we reached byte 0 without cutting mid-line at the byte budget.
    if (pos === 0 && stopAt === 0 && carry.length && out.length < limit) {
      acceptLine(carry);
    }
    return Math.max(0, remaining);
  } finally {
    fs.closeSync(fd);
  }
}

/** Tail-reads newest-first audit entries within a bounded byte budget (~2 MiB default), stopping once `limit` is reached. */
export function readVaultAudit(file: string = defaultAuditFile(), query: VaultAuditQuery = {}): readonly VaultAuditEntry[] {
  const limit = Math.min(AUDIT_MAX_LIMIT, Math.max(1, Number.isInteger(query.limit) ? query.limit! : AUDIT_DEFAULT_LIMIT));
  const budget = Math.max(1, Number.isInteger(query.maxBytes) ? query.maxBytes! : VAULT_AUDIT_READ_MAX_BYTES);
  const filter = { device: query.device?.toLowerCase(), decision: query.decision };
  const entries: VaultAuditEntry[] = [];
  const remaining = collectAuditTailFromFile(file, budget, limit, filter, entries);
  if (entries.length < limit && remaining > 0) {
    collectAuditTailFromFile(`${file}.1`, remaining, limit, filter, entries);
  }
  return entries;
}

/** Notification for a pending request; the reason is the agent's claim, so it follows the facts. */
export function vaultPushPayload(request: VaultRequest): Omit<PushPayload, 'hostId'> {
  const who = request.session?.name || request.session?.ref;
  const lead = who ? `${who} on ${request.device.name}` : request.device.name;
  let body = request.action === 'create'
    ? `${lead} wants to create ${request.item} in ${request.folder} (${request.fields.join(', ')})`
    : `${lead} wants ${request.item} (${request.fields.join(', ')})`;
  if (request.origin) {
    const badge = request.originMatch === 'match' ? ' [origin matched]' : request.originMatch === 'mismatch' ? ' [origin mismatch]' : '';
    body += ` on ${request.origin}${badge}`;
  }
  if (request.reason) body += ` — ${request.reason}`;
  if (body.length > PUSH_BODY_CHARS) body = `${body.slice(0, PUSH_BODY_CHARS - 1)}…`;
  return { kind: 'vault', title: request.action === 'create' ? 'Vault create request' : 'Vault request', body, sessionId: null, tag: `vault:${request.id}`, vaultRequestId: request.id };
}

export function createVaultApprovals(ports: VaultApprovalPorts): VaultApprovals {
  const now = ports.now || Date.now;
  const policyFile = ports.policyFile || defaultPolicyFile;
  const enrolledFile = ports.enrolledFile || (() => defaultEnrolledFile(policyFile()));
  const auditFile = ports.auditFile || defaultAuditFile;
  const auditMaxBytes = ports.auditMaxBytes ?? VAULT_AUDIT_MAX_BYTES;
  const requests = new Map<string, VaultRequest>();
  const requestMeta = new Map<string, PolicyEvaluationInput>();
  const grants = new Map<string, VaultGrant>();
  let listener: VaultListenerStatus | null = null;

  // Prime enrolled.json on startup if a valid policies.json already exists.
  loadVaultPolicies(policyFile(), enrolledFile());

  function recordAuditStrict(entry: Omit<VaultAuditEntry, 'ts'>, at: number): { readonly ok: true } | { readonly ok: false; readonly error: string } {
    try {
      appendVaultAudit(auditFile(), { ts: new Date(at).toISOString(), ...entry }, auditMaxBytes);
      return { ok: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[vault] audit write failed: ${detail}`);
      return { ok: false, error: detail };
    }
  }

  function recordAuditBestEffort(entry: Omit<VaultAuditEntry, 'ts'>, at: number): void {
    recordAuditStrict(entry, at);
  }

  function requestAuditBase(request: VaultRequest): Omit<VaultAuditEntry, 'ts' | 'event' | 'decision' | 'by'> {
    return {
      requestId: request.id,
      action: request.action,
      deviceFingerprint: request.device.fingerprint,
      deviceName: request.device.name,
      itemId: request.itemId,
      itemName: request.item,
      fields: request.fields,
      folderId: request.folderId,
      folder: request.folder,
      origin: request.origin,
      originMatch: request.originMatch,
      policyResult: request.policyResult,
      policyName: request.policyName,
    };
  }

  function settle(request: VaultRequest, status: Exclude<VaultRequestStatus, 'pending'>, at: number): void {
    request.status = status;
    request.decidedAt = at;
  }

  /** Expires overdue requests and grants, and trims decided history. */
  function sweep(): void {
    const at = now();
    for (const request of requests.values()) {
      if (request.status === 'pending' && request.expiresAt <= at) {
        settle(request, 'expired', at);
        recordAuditBestEffort({ ...requestAuditBase(request), event: 'decision', decision: 'expired', by: 'timeout' }, at);
      }
    }
    for (const grant of grants.values()) if (grant.expiresAt <= at) grants.delete(grant.id);
    const decided = [...requests.values()].filter(request => request.status !== 'pending')
      .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
    for (const stale of decided.slice(RECENT_LIMIT)) {
      requests.delete(stale.id);
      requestMeta.delete(stale.id);
    }
  }

  function find(id: string): Result<VaultRequest> {
    sweep();
    const request = requests.get(id);
    return request ? { ok: true, value: request } : fail(404, 'Unknown vault request');
  }

  return {
    overview() {
      sweep();
      const all = [...requests.values()];
      const projectPending = (request: VaultRequest): VaultRequest => {
        if (!request.allowWindow) return request;
        // Re-check current policy so the UI never offers a window the server would reject.
        const resolved = resolveDevicePolicy(request.device.fingerprint, policyFile(), enrolledFile(), request.policyName !== null);
        if (resolved.state === 'refused') return { ...request, allowWindow: false };
        if (resolved.state === 'policy') {
          const meta = requestMeta.get(request.id);
          const verdict = meta ? evaluateDevicePolicy(resolved.policy, meta) : null;
          if (!verdict || !verdict.ok || !verdict.allowWindow) return { ...request, allowWindow: false };
        }
        return request;
      };
      return {
        listener: listener ? { ...listener, stale: now() - listener.updatedAt > LISTENER_STALE_MS } : null,
        pending: all.filter(request => request.status === 'pending').sort((a, b) => a.createdAt - b.createdAt).map(projectPending),
        recent: all.filter(request => request.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)),
        grants: [...grants.values()].sort((a, b) => a.expiresAt - b.expiresAt),
      };
    },

    reportStatus(body) {
      const status = asRecord(body);
      const state = status.state;
      if (state !== 'locked' && state !== 'ready') return fail(400, "state must be 'locked' or 'ready'");
      const account = optionalString(status.account, 200);
      if (account === undefined) return fail(400, 'account must be a short string');
      const rawDevices = status.devices ?? [];
      if (!Array.isArray(rawDevices) || rawDevices.length > 64) return fail(400, 'devices must be a list');
      const devices = rawDevices.map(decodeDevice);
      if (devices.some(device => !device)) return fail(400, 'each device needs a name and a hex fingerprint');
      listener = { state, account, devices: devices as VaultDevice[], updatedAt: now() };
      return { ok: true, value: listener };
    },

    createRequest(body) {
      sweep();
      const input = asRecord(body);
      const id = typeof input.id === 'string' && ID_RE.test(input.id) ? input.id : null;
      if (!id) return fail(400, 'id must be 8-64 letters, digits or dashes');
      if (requests.has(id)) return fail(409, 'Duplicate vault request id');
      const device = decodeDevice(input.device);
      if (!device) return fail(400, 'device needs a name and a hex fingerprint');
      const action = input.action ?? 'release';
      if (action !== 'release' && action !== 'create') return fail(400, "action must be 'release' or 'create'");
      const item = boundedString(input.item, 256);
      if (!item) return fail(400, 'item is required');
      const itemId = optionalCleanString(input.itemId, 128);
      if (itemId === undefined) return fail(400, 'itemId must be a short single-line string');
      const folderId = optionalExactCleanString(input.folderId, 128);
      if (folderId === undefined) return fail(400, 'folderId must be a short single-line string');
      const folder = action === 'create'
        ? exactCleanString(input.folder, 256)
        : optionalExactCleanString(input.folder, 256);
      if (action === 'create' && !folder) return fail(400, 'a create names its folder');
      if (folder === undefined) return fail(400, 'folder must be a short single-line string');
      const fields = decodeFields(input.fields);
      if (!fields) return fail(400, `fields must be distinct values from: ${VAULT_FIELDS.join(', ')}, field:<name>`);
      const rawOrigin = optionalCleanString(input.origin, MAX_ORIGIN_CHARS);
      if (rawOrigin === undefined) return fail(400, 'origin must be a bare http(s) origin (scheme://host[:port])');
      const parsedOrigin = rawOrigin ? parseOrigin(rawOrigin) : null;
      if (rawOrigin && !parsedOrigin) return fail(400, 'origin must be a bare http(s) origin (scheme://host[:port])');
      const itemUris = decodeItemUris(input.itemUris);
      if (!itemUris) return fail(400, 'itemUris must be an array of up to 64 URI strings');
      const reason = optionalString(input.reason, 500);
      if (reason === undefined) return fail(400, 'reason must be at most 500 characters');
      const session = decodeSession(input.session);
      if (session === undefined) return fail(400, 'session needs a ref (name and host optional)');
      const at = now();
      const expiresAt = typeof input.expiresAt === 'number' && Number.isFinite(input.expiresAt) ? input.expiresAt : NaN;
      if (!(expiresAt > at)) return fail(400, 'expiresAt must be a future epoch-millisecond time');

      const origin = parsedOrigin?.origin ?? null;
      const originMatch = evaluateOriginMatch(parsedOrigin, itemUris);
      const evalMeta: PolicyEvaluationInput = { action, folderId, folder, fields, parsedOrigin, itemUris, originMatch };
      const resolved = resolveDevicePolicy(device.fingerprint, policyFile(), enrolledFile(), false);
      if (resolved.state === 'refused') {
        recordAuditBestEffort({
          event: 'request',
          requestId: id,
          action,
          deviceFingerprint: device.fingerprint,
          deviceName: device.name,
          itemId,
          itemName: item,
          fields,
          folderId,
          folder,
          origin,
          originMatch,
          decision: 'refused',
          by: 'policy',
          policyResult: resolved.policyResult,
          policyName: null,
        }, at);
        return fail(500, resolved.error);
      }

      const policy = resolved.state === 'policy' ? resolved.policy : undefined;
      const verdict = evaluateDevicePolicy(policy, evalMeta);
      if (!verdict.ok) {
        recordAuditBestEffort({
          event: 'request',
          requestId: id,
          action,
          deviceFingerprint: device.fingerprint,
          deviceName: device.name,
          itemId,
          itemName: item,
          fields,
          folderId,
          folder,
          origin,
          originMatch,
          decision: 'refused',
          by: 'policy',
          policyResult: verdict.policyResult,
          policyName: verdict.policyName,
        }, at);
        return fail(403, verdict.error);
      }

      const request: VaultRequest = {
        id,
        device,
        action,
        itemId,
        item,
        fields,
        folderId,
        folder,
        origin,
        originMatch,
        allowWindow: verdict.allowWindow,
        policyName: verdict.policyName,
        policyResult: verdict.policyResult,
        reason,
        session,
        createdAt: at,
        expiresAt: Math.min(expiresAt, at + MAX_REQUEST_LIFETIME_MS),
        status: 'pending',
        decidedAt: null,
        auto: false,
        grantId: null,
      };
      // A grant covers the same device, item (by itemId when carried), field array,
      // claimed session and origin; creates and allowWindow:false devices bypass grants.
      const grant = request.allowWindow ? [...grants.values()].find(candidate => candidate.device.fingerprint === device.fingerprint
        && (itemId !== null ? candidate.itemId === itemId : (candidate.itemId === null && candidate.item === item))
        && sameFieldList(candidate.fields, fields)
        && candidate.sessionRef === (session?.ref ?? null)
        && candidate.origin === origin) : undefined;
      if (grant) {
        // Audit MUST be written before publishing a grant auto-approval.
        const written = recordAuditStrict({ ...requestAuditBase(request), event: 'request', decision: 'approved', by: 'grant' }, at);
        if (!written.ok) return fail(500, 'Could not write vault audit record; refusing grant auto-approval');
        settle(request, 'approved', at);
        request.auto = true;
        request.grantId = grant.id;
        requests.set(id, request);
        requestMeta.set(id, evalMeta);
      } else {
        requests.set(id, request);
        requestMeta.set(id, evalMeta);
        recordAuditBestEffort({ ...requestAuditBase(request), event: 'request', decision: 'pending', by: 'listener' }, at);
        ports.notify(request);
      }
      return { ok: true, value: request };
    },

    requestStatus: find,

    abandon(id) {
      const found = find(id);
      if (found.ok && found.value.status === 'pending') {
        const at = now();
        settle(found.value, 'expired', at);
        recordAuditBestEffort({ ...requestAuditBase(found.value), event: 'decision', decision: 'abandoned', by: 'listener' }, at);
      }
      return found;
    },

    decide(id, decision) {
      if (decision !== 'approve' && decision !== 'approve-window' && decision !== 'deny') {
        return fail(400, "decision must be 'approve', 'approve-window' or 'deny'");
      }
      const found = find(id);
      if (!found.ok) return found;
      const request = found.value;
      if (request.status !== 'pending') return fail(409, `This request is already ${request.status}`);

      // Deny must always work, even if policy is unreadable or audit write fails.
      if (decision === 'deny') {
        const at = now();
        settle(request, 'denied', at);
        recordAuditBestEffort({ ...requestAuditBase(request), event: 'decision', decision: 'denied', by: 'operator' }, at);
        return { ok: true, value: request };
      }

      if (decision === 'approve-window' && request.action === 'create') {
        return fail(400, 'A create is approved once; it opens no window');
      }

      const at = now();
      const meta = requestMeta.get(request.id);
      if (!meta) return fail(500, 'Missing immutable request metadata; refusing approval');

      // Reload policy and re-evaluate the FULL policy before BOTH approve and approve-window.
      const resolved = resolveDevicePolicy(request.device.fingerprint, policyFile(), enrolledFile(), request.policyName !== null);
      if (resolved.state === 'refused') {
        recordAuditBestEffort({
          ...requestAuditBase(request),
          event: 'decision',
          decision: 'refused',
          by: 'policy',
          policyResult: resolved.policyResult,
        }, at);
        return fail(500, resolved.error);
      }
      const currentPolicy = resolved.state === 'policy' ? resolved.policy : undefined;
      const verdict = evaluateDevicePolicy(currentPolicy, meta);
      if (!verdict.ok) {
        recordAuditBestEffort({
          ...requestAuditBase(request),
          event: 'decision',
          decision: 'refused',
          by: 'policy',
          policyResult: verdict.policyResult,
          policyName: verdict.policyName,
        }, at);
        return fail(403, verdict.error);
      }
      if (decision === 'approve-window' && (!request.allowWindow || !verdict.allowWindow)) {
        recordAuditBestEffort({
          ...requestAuditBase(request),
          event: 'decision',
          decision: 'window-refused',
          by: 'policy',
          policyResult: 'denied:window_not_allowed',
          policyName: verdict.policyName ?? request.policyName ?? 'restricted',
        }, at);
        return fail(400, 'Window approvals are disabled by policy for this device');
      }

      // Write audit BEFORE publishing a positive decision or grant; refuse (500) on write/rotation failure.
      const written = recordAuditStrict({
        ...requestAuditBase(request),
        event: 'decision',
        decision: decision === 'approve-window' ? 'approved-window' : 'approved',
        by: 'operator',
        policyResult: verdict.policyResult,
        policyName: verdict.policyName,
      }, at);
      if (!written.ok) {
        return fail(500, 'Could not write vault audit record; refusing approval');
      }

      settle(request, 'approved', at);
      if (decision === 'approve-window') {
        const grant: VaultGrant = {
          id: crypto.randomUUID(),
          device: request.device,
          itemId: request.itemId,
          item: request.item,
          fields: request.fields,
          sessionRef: request.session?.ref ?? null,
          origin: request.origin,
          createdAt: at,
          expiresAt: at + GRANT_WINDOW_MS,
        };
        grants.set(grant.id, grant);
        request.grantId = grant.id;
      }
      return { ok: true, value: request };
    },

    revokeGrant(id) {
      sweep();
      const grant = grants.get(id);
      if (!grant) return fail(404, 'Unknown vault grant');
      grants.delete(id);
      return { ok: true, value: grant };
    },

    audit(query) {
      return readVaultAudit(auditFile(), query);
    },
  };
}

/** The listener's bridge credential, created 0600 on first use (exclusive, so racing first uses agree). */
function readBridgeToken(): string {
  const file = path.join(dishStore.dishDir(), 'vault', 'bridge.token');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file, `${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return fs.readFileSync(file, 'utf8').trim();
}

const LOOPBACK: Record<string, true> = { '127.0.0.1': true, '::1': true, '::ffff:127.0.0.1': true };

type VaultHandler = (req: Request<{ id: string }>, res: Response) => void;

export interface VaultHandlers {
  /** Loopback peer and bridge token, ahead of every bridge route. */
  bridgeGate(req: Request, res: Response, next: NextFunction): void;
  bridgeStatus: VaultHandler;
  bridgeCreate: VaultHandler;
  bridgeGet: VaultHandler;
  bridgeAbandon: VaultHandler;
  overview: VaultHandler;
  audit: VaultHandler;
  decide: VaultHandler;
  revokeGrant: VaultHandler;
}

export function createVaultHandlers(vault: VaultApprovals, token: () => string = readBridgeToken): VaultHandlers {
  function reply<T>(res: Response, result: Result<T>, send: (value: T) => void): void {
    if (result.ok) send(result.value);
    else res.status(result.status).json({ error: result.error });
  }
  return {
    bridgeGate(req, res, next) {
      let expectedText = '';
      try {
        expectedText = token().trim();
      } catch {
        res.status(403).json({ error: 'The vault bridge accepts only the local listener' });
        return;
      }
      const given = Buffer.from(req.get(BRIDGE_HEADER) || '');
      const expected = Buffer.from(expectedText);
      const tokenOk = expected.length > 0 && given.length === expected.length && crypto.timingSafeEqual(given, expected);
      if (LOOPBACK[req.socket.remoteAddress || ''] !== true || !tokenOk) {
        res.status(403).json({ error: 'The vault bridge accepts only the local listener' });
        return;
      }
      next();
    },
    bridgeStatus: (req, res) => reply(res, vault.reportStatus(req.body), () => res.status(204).end()),
    bridgeCreate: (req, res) => reply(res, vault.createRequest(req.body), request => res.status(201).json({ status: request.status })),
    bridgeGet: (req, res) => reply(res, vault.requestStatus(req.params.id), request => res.json({ status: request.status })),
    bridgeAbandon: (req, res) => reply(res, vault.abandon(req.params.id), () => res.status(204).end()),
    overview: (_req, res) => { res.json(vault.overview()); },
    audit(req, res) {
      res.setHeader('Cache-Control', 'private, no-store');
      let limit: number | undefined;
      if (req.query.limit !== undefined) {
        if (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)) {
          res.status(400).json({ error: 'limit must be a positive integer' });
          return;
        }
        limit = Math.min(AUDIT_MAX_LIMIT, Math.max(1, Number(req.query.limit)));
      }
      let device: string | undefined;
      if (req.query.device !== undefined && req.query.device !== '') {
        if (typeof req.query.device !== 'string' || !FINGERPRINT_RE.test(req.query.device)) {
          res.status(400).json({ error: 'device must be a hex fingerprint' });
          return;
        }
        device = req.query.device.toLowerCase();
      }
      let decision: string | undefined;
      if (req.query.decision !== undefined && req.query.decision !== '') {
        const cleaned = cleanString(req.query.decision, 64);
        if (!cleaned) {
          res.status(400).json({ error: 'decision must be a short string' });
          return;
        }
        decision = cleaned;
      }
      res.json({ entries: vault.audit({ limit, device, decision }) });
    },
    decide: (req, res) => reply(res, vault.decide(req.params.id, asRecord(req.body).decision), request => res.json({ request })),
    revokeGrant: (req, res) => reply(res, vault.revokeGrant(req.params.id), () => res.status(204).end()),
  };
}
