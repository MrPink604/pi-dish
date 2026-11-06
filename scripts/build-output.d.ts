// Generated tool from scripts/build-output.ts; edit that source and run npm run build:tools.
export declare const root: string;
export declare function checkRequested(script: string): boolean;
export declare function programFiles(config: string): string[];
export interface OutputEntry {
    source: string;
    executable: boolean;
}
export type OutputMap = Map<string, OutputEntry>;
export interface OutputOptions {
    /** Names the mapping in duplicate/mismatch messages, e.g. `Tool`. */
    kind: string;
    declarations(source: string): boolean;
    executable(source: string): boolean;
}
export declare function siblingOutputs(sources: readonly string[], options: OutputOptions): OutputMap;
/** Compile `project`, hand the emitted tree to `step`, then delete it. */
export declare function buildProgram(project: string, prefix: string, step: (files: readonly string[], read: (file: string) => string) => void): boolean;
export declare function verifyMapping(kind: string, emitted: readonly string[], outputs: ReadonlyMap<string, unknown>, extra?: readonly string[]): void;
/** Tracked files that carry this builder's banner but are no longer owned by it. */
export declare function orphanedOutputs(directories: readonly string[], banner: string, outputs: ReadonlyMap<string, unknown>, recursive: boolean): string[];
export interface GeneratedOutput {
    file: string;
    target: string;
    content: string;
    mode: number;
}
export interface GeneratedOptions {
    /** Ownership banner, e.g. `// Generated tool from `. */
    banner: string;
    /** npm script that regenerates the output, e.g. `build:tools`. */
    command: string;
    read(file: string, source: string): string;
}
export declare function generatedOutputs(outputs: OutputMap, options: GeneratedOptions): GeneratedOutput[];
export interface WriteOptions {
    check: boolean;
    kind: string;
    command: string;
    checkOk: string;
    writeOk: string;
}
export declare function writeOutputs(prepared: readonly GeneratedOutput[], options: WriteOptions): void;
