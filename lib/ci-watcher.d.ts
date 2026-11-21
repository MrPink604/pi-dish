// Generated from src/core/ci-watcher.ts; edit that source and run npm run build:core.
import { type CiFailureDetails, type GitHubCi } from './github-ci';
interface RepoConfig {
    repo: string;
    workflow: string;
    bot: string;
    recovery: boolean;
}
export interface CiConfig {
    repos: RepoConfig[];
    token?: string;
}
/** Only the named bot host can poll, even if this settings block is copied to peers. */
export declare function readCiConfig(settings: Record<string, unknown>, hostId: string, envToken?: string): CiConfig | null;
export interface CiEvent extends CiFailureDetails {
    id: string;
    kind: 'failure' | 'recovered';
    repo: string;
    workflow: string;
    branch: string;
    sha: string;
    title: string;
    url: string;
    runId: number;
    attempt: number;
}
type Position = {
    number: number;
    attempt: number;
};
type Branch = Position & {
    failing: boolean;
};
type Pending = {
    event: CiEvent;
    pushAttempted: boolean;
};
interface RepoState {
    floor: number;
    seen: Record<string, Position>;
    branches: Record<string, Branch>;
    pending: Pending[];
}
interface State {
    version: 1;
    repos: Record<string, RepoState>;
}
interface Ports {
    config: CiConfig | null;
    github: GitHubCi;
    load(): unknown;
    save(state: State): void;
    deliverBot(target: string, event: CiEvent): Promise<void>;
    notify(target: string, event: CiEvent): Promise<void>;
    log(message: string): void;
}
export interface CiWatcher {
    poll(): Promise<void>;
    start(): void;
    stop(): void;
}
export declare function createCiWatcher(ports: Ports): CiWatcher;
export {};
