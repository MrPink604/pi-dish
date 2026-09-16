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
    listByHost(): Record<string, FleetArtifactListEntry[]>;
    isValidToken(token: unknown): token is string;
    isValidKind(kind: unknown): kind is ArtifactKind;
}
export declare function isValidToken(token: unknown): token is string;
export declare function isValidKind(kind: unknown): kind is ArtifactKind;
export declare function get(token: unknown): FleetArtifactRecord | null;
export declare function record(token: unknown, host: unknown, kind: unknown): FleetArtifactRecord | null;
/** A host-scoped revoke cannot remove another valid host's mapping. */
export declare function remove(token: unknown, host?: unknown): boolean;
export declare function listByHost(): Record<string, FleetArtifactListEntry[]>;
