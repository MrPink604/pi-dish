#!/usr/bin/env node
// Generated tool from scripts/check-source-policy.mts; edit that source and run npm run build:tools.
import { type SourceFile } from 'typescript/unstable/ast';
type InventorySummary = {
    executablePaths: number;
    shellPaths: number;
    compilerBodies: number;
    generatedRuntime: number;
    generatedDeclarations: number;
    supportDeclarations: number;
    exceptions: number;
};
export declare function inspectSource(source: SourceFile, fixture?: boolean): string[];
export declare function repositoryPaths(root: string): {
    paths: Set<string>;
    tracked: Set<string>;
    modes: Map<string, string>;
};
export declare function isExecutableFamilyPath(file: string): boolean;
export declare function shellInventoryPaths(paths: ReadonlySet<string>, modes: ReadonlyMap<string, string>): string[];
export declare function validateShellInventory(root: string, repository: ReturnType<typeof repositoryPaths>, declared: ReadonlySet<string>): {
    paths: string[];
    failures: string[];
};
export declare function validateLinguist(root: string, file: string, repository: ReadonlySet<string>, generated: ReadonlySet<string>, failures: string[]): void;
export declare function classifyExecutableInventory(executablePaths: readonly string[], generatedPaths: ReadonlySet<string>, compilerSources: ReadonlySet<string>, supportDeclarations: ReadonlySet<string>, exceptions: ReadonlySet<string>): {
    failures: string[];
    compilerBodies: Set<string>;
};
export declare function checkPolicy(root: string): {
    failures: string[];
    count: number;
    inventory: InventorySummary;
};
export {};
