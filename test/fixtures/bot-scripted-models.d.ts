// Generated test/tool from test/fixtures/bot-scripted-models.ts; edit that source and run npm run build:tests.
import type { Models } from '@earendil-works/pi-ai' with { 'resolution-mode': 'import' };
export declare function openBotModels(selector: string): Promise<{
    models: Models;
    close(): Promise<void>;
}>;
