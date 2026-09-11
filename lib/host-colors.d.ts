// Generated from src/core/host-colors.ts; edit that source and run npm run build:core.
export declare const HOST_COLOR_SLOTS = 5;
/** Only validated, own #rrggbb values may become CSS colors. */
export declare function sanitizeHostColors(raw: unknown): Record<string, string>;
export declare function sanitizeHostColorOrder(raw: unknown): string[];
/** First-seen slots remain stable; explicit overrides do not reorder hosts. */
export declare function assignHostColor(order: unknown, key: string, overrides: unknown): {
    color: string;
    order: string[];
    index: number;
    appended: boolean;
    custom: boolean;
};
export declare function rgbStringToHex(value: unknown): string | null;
