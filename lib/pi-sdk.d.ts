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
/** Full rate card incl. unauthenticated providers: historical sessions still need removed providers' rates. */
export declare function getPricingModels(): Promise<PricingModel[]>;
export declare function renameSession(sessionPath: string, newName: string): Promise<boolean>;
export declare function switchModel(sessionPath: string, provider: string, modelId: string): Promise<boolean>;
export declare function getCommands(): Promise<SessionCommand[]>;
export declare function getSessionTree(sessionPath: string): Promise<SessionTree>;
export declare function exportSessionHtml(sessionPath: string, outputPath: string, profileId?: string, { shareSnapshot }?: SessionHtmlExportOptions): Promise<string>;
/**
 * The TUI's /tree for an *inactive* session (live ones use the bridge's
 * navigate_tree), mirroring AgentSession.navigateTree semantics.
 *
 * sm.branch() only moves an in-memory pointer; a reopened file derives its
 * leaf from the last entry, so the summary-less path appends a no-op label
 * entry purely to anchor the new leaf.
 */
export declare function branchSession(sessionPath: string, entryId: string, options?: BranchSessionOptions): Promise<BranchSessionResult>;
