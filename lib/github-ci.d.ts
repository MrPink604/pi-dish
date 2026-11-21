// Generated from src/core/github-ci.ts; edit that source and run npm run build:core.
export interface CiRun {
    id: number;
    attempt: number;
    number: number;
    branch: string;
    sha: string;
    title: string;
    url: string;
    conclusion: string | null;
    status: string;
}
export interface CiFailureDetails {
    jobs: string[];
    tests: string[];
    likelyKnownFlake: boolean;
}
export interface GitHubCi {
    listRuns(repo: string, workflow: string, etag: string | undefined, signal: AbortSignal): Promise<{
        notModified: true;
    } | {
        notModified: false;
        etag?: string;
        runs: CiRun[];
    }>;
    failureDetails(repo: string, run: CiRun, signal: AbortSignal): Promise<CiFailureDetails>;
}
export declare const CI_RUN_WINDOW = 100;
export declare function createGitHubCi(token: string | undefined, options?: {
    fetch?: typeof fetch;
}): GitHubCi;
