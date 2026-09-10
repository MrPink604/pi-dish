// Generated from src/core/host-identity.ts; edit that source and run npm run build:core.
import type { HostId } from './contracts';
declare function getHostId(): HostId;
declare function getHostLabel(settings?: unknown): string;
declare const _default: {
    getHostId: typeof getHostId;
    getHostLabel: typeof getHostLabel;
};
export = _default;
