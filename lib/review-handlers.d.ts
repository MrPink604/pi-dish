// Generated from src/core/review-handlers.ts; edit that source and run npm run build:core.
import type { ApplicationRequest, RouteHandler } from './http-boundary';
import * as reviews from './reviews';
export interface ReviewHandlerPorts {
    sessionKnown(sessionId: string): boolean;
    /** Whether a request without a private-session unlock token must not see this session. */
    privateRefused?(req: ApplicationRequest, sessionId: string): boolean;
    sessionCwd(sessionId: string): string | null;
    /** An absolute path as the session's file viewer reaches it, or null. */
    resolveSessionFile(sessionId: string, absPath: string): Promise<string | null>;
    pageExists(token: string): boolean;
    /** The transcript's last message index; null when unknown. */
    lastMessageIndex(sessionId: string): number | null;
    /** Resolves to null once the session took it, or to why that is unconfirmed (SessionCommandHandlers.deliverText). */
    deliverMessage(sessionId: string, text: string): Promise<string | null>;
    log(line: string): void;
    /** How long a just-detached (or not yet reattached) waiting CLI keeps an answer from becoming a message. */
    graceMs?: number;
}
export interface ReviewHandlers {
    create: RouteHandler;
    list: RouteHandler;
    get: RouteHandler;
    lookup: RouteHandler;
    wait: RouteHandler;
    submit: RouteHandler;
    cancel: RouteHandler;
    media: RouteHandler;
    /** `review_updated` for a session's event stream; returns the unsubscribe. */
    subscribe(sessionId: string, listener: (data: {
        review: reviews.ClientReview;
    }) => void): () => void;
    /** Purges a permanently deleted session's review store and in-memory waiters/timers. */
    removeSession(sessionId: string): void;
    /** Settles answers a restart cut off: pending ones after the grace period, delivering ones as uncertain. */
    start(): void;
    stop(): void;
}
export declare function createReviewHandlers(ports: ReviewHandlerPorts): ReviewHandlers;
