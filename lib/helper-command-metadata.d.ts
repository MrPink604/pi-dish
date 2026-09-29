// Generated from src/core/helper-command-metadata.ts; edit that source and run npm run build:core.
export declare const PI_EMULATED_THINKING_LEVELS: readonly string[];
export declare const EMULATED_COMMAND_METADATA: {
    readonly compact: {
        readonly name: 'compact';
        readonly description: 'Manually compact the session context';
        readonly args: '[instructions]';
    };
    readonly model: {
        readonly name: 'model';
        readonly description: 'Switch model (usage: /model provider/model-id)';
        readonly args: '<model>';
    };
    readonly name: {
        readonly name: 'name';
        readonly description: 'Set session display name';
        readonly args: '<name>';
    };
    readonly thinking: {
        readonly name: 'thinking';
        readonly description: 'Set thinking level';
        readonly args: `<${string}>`;
    };
    readonly abort: {
        readonly name: 'abort';
        readonly description: 'Abort the current agent operation';
    };
    readonly reload: {
        readonly name: 'reload';
        readonly description: 'Reload extensions, skills, and prompt templates';
    };
    readonly btw: {
        readonly name: 'btw';
        readonly description: 'Ask an ephemeral side question using the current session context';
    };
};
