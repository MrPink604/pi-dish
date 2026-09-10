// Generated from src/core/dish-store.ts; edit that source and run npm run build:core.
declare function dishDir(): string;
declare function readStore(name: string): Record<string, unknown>;
declare function writeStore(name: string, data: unknown): void;
declare const _default: {
    dishDir: typeof dishDir;
    readStore: typeof readStore;
    writeStore: typeof writeStore;
};
export = _default;
