// Generated from src/core/dish-store.ts; edit that source and run npm run build:core.
declare function dishDir(): string;
declare function replaceFile(file: string, data: string | NodeJS.ArrayBufferView, mode?: number): void;
declare function syncDirectory(dir: string): void;
/** replaceFile that survives a crash once it returns; the directory must exist. */
declare function replaceFileDurably(file: string, data: string): void;
declare function readStore(name: string): Record<string, unknown>;
declare function writeStore(name: string, data: unknown): void;
declare function readDishSettings(): Record<string, unknown>;
declare function writeDishSettings(settings: Record<string, unknown>): void;
declare const _default: {
    dishDir: typeof dishDir;
    replaceFile: typeof replaceFile;
    replaceFileDurably: typeof replaceFileDurably;
    syncDirectory: typeof syncDirectory;
    readStore: typeof readStore;
    writeStore: typeof writeStore;
    readDishSettings: typeof readDishSettings;
    writeDishSettings: typeof writeDishSettings;
};
export = _default;
