// Generated from src/core/cu-vault-fill.ts; edit that source and run npm run build:core.
export declare const CU_VAULT_FILL_SETTING = "cuVaultFill";
export declare const CU_VAULT_FILL_AUDIT_FILE = "cu-vault-fill-audit.ndjson";
export declare const CU_VAULT_FILL_AUDIT_MAX_BYTES: number;
export declare const DEFAULT_CU_VAULT_FILL_IDENTITY = "cu-sandbox-proxy";
export declare const DEFAULT_CU_VAULT_FILL_POLL_WAIT_MS = 20000;
export declare const MAX_CU_VAULT_FILL_POLL_WAIT_MS = 25000;
export declare const CU_VAULT_FILL_EXECUTE_TIMEOUT_MS = 50000;
export declare const CU_VAULT_FILL_CANCEL_TIMEOUT_MS = 15000;
export declare const CU_VAULT_FILL_ENVELOPE_LABEL = "cu-broker vault-fill v1";
export declare const CU_VAULT_FILL_ENVELOPE_ALG = "X25519-HKDF-SHA256-ChaCha20Poly1305";
export declare const CU_VAULT_FILL_RETRYABLE_CODES: ReadonlySet<string>;
export type CuFillField = 'username' | 'password' | 'totp';
export type CuFillCancelReason = 'denied' | 'timeout' | 'error' | 'cancelled';
export type CuFillOutcome = 'filled' | 'denied' | 'refused' | 'timeout' | 'failed' | 'cancelled' | 'error';
export interface CuVaultFillConfig {
    readonly remote: string;
    readonly identity: string;
    readonly identitiesDir: string;
    readonly xdgConfigHome: string;
    readonly explicitXdgConfigHome: boolean;
    readonly pollWaitMs: number;
}
export interface CuVaultFillHttpRequest {
    readonly method: 'GET' | 'POST';
    readonly path: string;
    readonly body?: unknown;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
}
export interface CuVaultFillHttpResponse {
    readonly status: number;
    readonly body: unknown;
}
export interface CuVaultFillAuditEntry {
    readonly ts: string;
    readonly requestId: string;
    readonly remote: string;
    readonly origin: string;
    readonly topOrigin: string | null;
    readonly item: string;
    readonly fields: readonly CuFillField[];
    readonly outcome: CuFillOutcome;
    readonly code: string | null;
}
export interface CuVaultFillPorts {
    readonly config: CuVaultFillConfig;
    /** Repository root used to locate `skills/pi-dish-vault/scripts/{pi-dish-vault,cu-fill-seal}.js`. */
    readonly rootDirectory?: string;
    readonly requestRemote?: (remoteName: string, req: CuVaultFillHttpRequest) => Promise<CuVaultFillHttpResponse>;
    readonly vaultCli?: {
        readonly file: string;
        readonly prefixArgs?: readonly string[];
    };
    readonly sealerScript?: string;
    readonly auditFile?: () => string;
    readonly auditMaxBytes?: number;
    readonly now?: () => number;
    readonly pollErrorBackoffMs?: readonly number[];
    readonly executeRetryBackoffMs?: readonly number[];
    readonly log?: (message: string) => void;
}
export interface CuVaultFillCoordinator {
    start(): void;
    stop(): void;
    pollOnce(): Promise<void>;
    activeCount(): number;
}
/**
 * Parses `settings.json`'s opt-in `cuVaultFill` block. Returns `null` when
 * absent or disabled (`enabled !== true`). Throws on malformed enabled config.
 */
export declare function readCuVaultFillConfig(settings: Record<string, unknown>, baseDishDir?: string): CuVaultFillConfig | null;
/** Builds a concise approval reason, surfacing `topOrigin` whenever the form is in a cross-origin frame. */
export declare function buildFillApprovalReason(origin: string, topOrigin: string | null, reason: string | null): string;
export declare function createCuVaultFillCoordinator(ports: CuVaultFillPorts): CuVaultFillCoordinator;
