#!/usr/bin/env node
// Generated tool from scripts/check-source-policy.mts; edit that source and run npm run build:tools.
import { type SourceFile } from 'typescript/unstable/ast';
export declare function inspectSource(source: SourceFile, fixture?: boolean): string[];
export declare function checkPolicy(root: string): {
    failures: string[];
    count: number;
};
