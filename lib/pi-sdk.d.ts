// Generated from src/core/pi-sdk.ts; edit that source and run npm run build:core.
import type * as PiSDK from '@earendil-works/pi-coding-agent' with { 'resolution-mode': 'import' };
export interface ModelPricing {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
}
export interface PricingModel {
    provider: string;
    id: string;
    cost: ModelPricing;
}
export interface AvailableModel {
    id: string;
    name: string;
    provider: string;
    contextWindow: number;
    reasoning: boolean;
    pricing: ModelPricing | null;
    free: boolean;
}
export interface SessionCommand {
    name: string;
    description: string;
    source: 'builtin' | 'extension' | 'skill' | 'prompt';
    args?: string;
}
export interface SessionTreeNode {
    id: string;
    parentId: string | null;
    type: PiSDK.SessionEntry['type'];
    timestamp: string;
    depth: number;
    active: boolean;
    isLeaf: boolean;
    label: string | null;
    childCount: number;
    role?: string;
    text?: string;
    model?: string;
    stopReason?: string;
    errorMessage?: string;
    toolCalls?: {
        id: string;
        name: string;
        args: string;
    }[];
    toolName?: string;
    toolCallId?: string;
    isError?: boolean;
    tokensBefore?: number;
    modelId?: string;
    provider?: string;
    summary?: string;
}
export interface SessionTree {
    nodes: SessionTreeNode[];
    leafId: string | null;
    activePathIds: string[];
}
export interface SessionHtmlExportOptions {
    shareSnapshot?: unknown;
}
export interface BranchSessionOptions {
    summarize?: boolean;
    customInstructions?: string;
}
export interface BranchSessionResult {
    editorText: string | undefined;
    summarized: boolean;
}
export declare function getSDK(): Promise<typeof PiSDK>;
export declare function getRuntime(): Promise<PiSDK.ModelRuntime>;
export declare function getRegistry(): Promise<PiSDK.ModelRegistry>;
export declare function getAvailableModels(): Promise<AvailableModel[]>;
/**
 * Complete Pi rate card, including providers that are not currently
 * authenticated. Historical sessions still need those rates after a key or
 * subscription is removed, so usage pricing cannot use the accessible-model
 * list returned by getAvailableModels().
 */
export declare function getPricingModels(): Promise<PricingModel[]>;
export declare function renameSession(sessionPath: string, newName: string): Promise<boolean>;
export declare function switchModel(sessionPath: string, provider: string, modelId: string): Promise<boolean>;
export declare function getCommands(): Promise<SessionCommand[]>;
export declare function getSessionTree(sessionPath: string): Promise<SessionTree>;
export declare function exportSessionHtml(sessionPath: string, outputPath: string, profileId?: string, { shareSnapshot }?: SessionHtmlExportOptions): Promise<string>;
/**
 * Navigate an *inactive* session's tree (the TUI's /tree without a live pi
 * process — live sessions go through the bridge's navigate_tree instead).
 * Mirrors AgentSession.navigateTree semantics: a user-message target moves
 * the leaf to its parent and returns the message text for the composer;
 * `summarize` generates an LLM summary of the abandoned branch (using the
 * session's own model + stored auth) and appends it as a branch_summary
 * entry at the new leaf, where pi injects it as context on resume.
 *
 * Persistence gotcha: sm.branch() only moves an in-memory pointer — a
 * reopened file re-derives its leaf from the *last entry*, so an external
 * branch must append something. branchWithSummary persists that way by
 * nature; the summary-less path appends a no-op label entry (labels
 * contribute nothing to the LLM context) purely to anchor the new leaf.
 */
export declare function branchSession(sessionPath: string, entryId: string, options?: BranchSessionOptions): Promise<BranchSessionResult>;
