// Generated from src/core/relay-socket.ts; edit that source and run npm run build:core.
/** The bridge socket for a session: short and hashed, as a Unix socket path must be. */
export declare function relaySocketPath(sessionId: string): string;
/** pi-dish's own version, which a relay reports as its wrapper version. */
export declare function relayWrapperVersion(): string;
