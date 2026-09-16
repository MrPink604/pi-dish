// Generated from src/core/harness-feature-commands.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODELS_CACHE_TTL = void 0;
exports.harnessCommandAvailable = harnessCommandAvailable;
exports.runHarnessJsonCommand = runHarnessJsonCommand;
exports.runHarnessModelCommand = runHarnessModelCommand;
exports.withCatalogThinkingLevels = withCatalogThinkingLevels;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const session_launch_1 = require("./session-launch");
const session_api_1 = require("./session-api");
exports.MODELS_CACHE_TTL = 60000;
const HARNESS_JSON_EXIT_GRACE_MS = 250;
const harnessModelsCache = new Map();
function harnessCommandAvailable(descriptor) {
    const spec = (0, session_launch_1.harnessLaunchSpec)(descriptor);
    const command = spec.argv[0];
    if (!command)
        return false;
    const environment = { ...process.env, ...spec.env };
    const executable = (file) => { try {
        fs.accessSync(file, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    } };
    if (command.includes(path.sep))
        return executable(path.resolve(command));
    return String(environment.PATH || '').split(path.delimiter)
        .some(dir => dir && executable(path.join(dir, command)));
}
function resolveHarnessCwd(value) {
    const home = process.env.HOME || os.homedir();
    if (typeof value !== 'string' || !value.trim())
        return process.cwd();
    const trimmed = value.trim();
    const expanded = trimmed === '~' ? home
        : trimmed.startsWith('~/') ? path.join(home, trimmed.slice(2)) : trimmed;
    return path.resolve(expanded);
}
/** Interactive feature adapter; deliberately separate from pricing's runner. */
function runHarnessJsonCommand(descriptor, commandArgs, { cwd, acceptCompleteJson = false } = {}) {
    const spec = (0, session_launch_1.harnessLaunchSpec)(descriptor);
    const args = [...spec.argv.slice(1), ...commandArgs];
    return new Promise((resolve, reject) => {
        let settled = false;
        let completeJsonTimer;
        let streamedStdout = '';
        let child;
        const settle = (callback, value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(completeJsonTimer);
            callback(value);
        };
        const acceptStreamedJson = () => {
            if (!acceptCompleteJson || completeJsonTimer || !/[\r\n]\s*$/.test(streamedStdout))
                return;
            let parsed;
            try {
                parsed = JSON.parse(streamedStdout.trim());
            }
            catch {
                return;
            }
            // Accept a complete response after a short normal-exit grace, then stop
            // a CLI whose extensions left the event loop alive.
            completeJsonTimer = setTimeout(() => {
                settle(resolve, parsed);
                child.kill();
            }, HARNESS_JSON_EXIT_GRACE_MS);
        };
        child = (0, node_child_process_1.execFile)(spec.argv[0], args, {
            env: { ...process.env, ...spec.env },
            cwd: resolveHarnessCwd(cwd),
            timeout: 15_000,
            maxBuffer: 10 * 1024 * 1024,
        }, (error, stdout, stderr) => {
            if (settled)
                return;
            if (error)
                return settle(reject, new Error((stderr || error.message).trim()));
            try {
                const parsed = JSON.parse(stdout.trim() || '{}');
                settle(resolve, parsed);
            }
            catch (parseError) {
                settle(reject, new Error(`Could not parse ${descriptor.label} command output: ${parseError instanceof Error ? parseError.message : undefined}`));
            }
        });
        if (acceptCompleteJson && child.stdout) {
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk) => {
                if (streamedStdout.length <= 10 * 1024 * 1024)
                    streamedStdout += chunk;
                acceptStreamedJson();
            });
        }
    });
}
async function runHarnessModelCommand(descriptor, { cwd } = {}) {
    const cacheKey = `${descriptor.id}\0${resolveHarnessCwd(cwd)}`;
    const cached = harnessModelsCache.get(cacheKey);
    if (cached?.models && Date.now() - (cached.time ?? 0) < exports.MODELS_CACHE_TTL)
        return cached.models;
    if (cached?.inFlight)
        return cached.inFlight;
    const entry = cached || {};
    entry.inFlight = runHarnessJsonCommand(descriptor, descriptor.argv.models, { cwd, acceptCompleteJson: true }).then(parsed => {
        // JSON null threw in the former property read too; it is not an empty catalog.
        if (parsed === null || parsed === undefined)
            throw new TypeError(`Cannot read properties of ${parsed} (reading 'models')`);
        const models = typeof parsed === 'object' && 'models' in parsed ? parsed.models : undefined;
        entry.models = (0, session_api_1.normalizeModels)(models || parsed);
        entry.time = Date.now();
        return entry.models;
    }).finally(() => { delete entry.inFlight; });
    harnessModelsCache.set(cacheKey, entry);
    return entry.inFlight;
}
/** Live OMP lists omit catalog thinking ladders; missing catalog stays partial. */
async function withCatalogThinkingLevels(models, descriptor) {
    if (descriptor?.modelCatalog !== 'command')
        return models;
    if (!models.some(m => m && !Array.isArray(m.thinking)))
        return models;
    try {
        const catalog = await runHarnessModelCommand(descriptor, {});
        const levelsBySelector = new Map(catalog.filter(m => m && Array.isArray(m.thinking)).map(m => [m.selector, m.thinking]));
        return models.map(m => {
            if (!m || Array.isArray(m.thinking))
                return m;
            const thinking = levelsBySelector.get(m.selector)
                ?? levelsBySelector.get(`${m.provider}/${m.id}`);
            return thinking ? { ...m, thinking } : m;
        });
    }
    catch {
        return models;
    }
}
