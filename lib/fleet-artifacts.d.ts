// Generated from src/core/fleet-artifacts.ts; edit that source and run npm run build:core.
export type ArtifactKind = 'share' | 'page';
export interface FleetArtifactRecord {
    host: string;
    kind: ArtifactKind;
    createdAt: number | null;
}
export interface FleetArtifactListEntry {
    token: string;
    kind: ArtifactKind;
    createdAt: number | null;
}
/** M3-owned port consumed by M5 relay; untrusted inputs stay unknown. */
export interface FleetArtifactStore {
    get(token: unknown): FleetArtifactRecord | null;
    record(token: unknown, host: unknown, kind: unknown): FleetArtifactRecord | null;
    remove(token: unknown, host?: unknown): boolean;
    suppress(token: unknown): boolean;
    isSuppressed(token: unknown): boolean;
    listByHost(): Record<string, FleetArtifactListEntry[]>;
    isValidToken(token: unknown): token is string;
    isValidKind(kind: unknown): kind is ArtifactKind;
}
export declare function isValidToken(token: unknown): token is string;
export declare function isValidKind(kind: unknown): kind is ArtifactKind;
export declare function get(token: unknown): FleetArtifactRecord | null;
export declare function record(token: unknown, host: unknown, kind: unknown): FleetArtifactRecord | null;
/**
 * Drop a live mapping (an owner revoke seen by the hub). A host-scoped revoke
 * cannot remove another valid host's mapping, and a tombstone is never
 * removed here — only record() lifts a suppression.
 */
export declare function remove(token: unknown, host?: unknown): boolean;
/** Whether the token was explicitly unmapped on this hub. */
export declare function isSuppressed(token: unknown): boolean;
/**
 * Explicit unmap: end public reachability through this hub and keep it ended
 * against discovery. Returns whether a live mapping existed.
 */
export declare function suppress(token: unknown): boolean;
export declare function listByHost(): Record<string, FleetArtifactListEntry[]>;
