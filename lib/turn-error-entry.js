// Generated from src/core/turn-error-entry.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TURN_ERROR_ENTRY_TYPE = void 0;
exports.turnErrorData = turnErrorData;
exports.isUnpersistedOmpRefusal = isUnpersistedOmpRefusal;
const helper_values_js_1 = require("./helper-values.js");
/**
 * A terminal assistant error the harness keeps out of its session file. OMP
 * never persists a classifier refusal (`stopDetails.type` refusal/sensitive,
 * e.g. "Refusal (cyber)"), so the transcript otherwise just stops. The bridge
 * records it with the extension API's appendEntry: a `custom` entry, which
 * harnesses never replay to the model.
 */
exports.TURN_ERROR_ENTRY_TYPE = 'pi-dish-turn-error';
/** The persisted fields of an assistant error message or a stored entry's data; null without an error. */
function turnErrorData(value) {
    if (!(0, helper_values_js_1.record)(value) || typeof value.errorMessage !== 'string' || !value.errorMessage)
        return null;
    const { errorMessage, model, provider, timestamp } = value;
    return {
        errorMessage,
        ...(typeof model === 'string' && model ? { model } : {}),
        ...(typeof provider === 'string' && provider ? { provider } : {}),
        ...(typeof timestamp === 'number' && Number.isFinite(timestamp) || typeof timestamp === 'string' ? { timestamp } : {}),
    };
}
/** OMP's classifier-refusal test (turn-recovery isClassifierRefusal, verified 18.18). */
function isUnpersistedOmpRefusal(message) {
    if (!(0, helper_values_js_1.record)(message) || message.role !== 'assistant' || message.stopReason !== 'error')
        return false;
    const type = (0, helper_values_js_1.record)(message.stopDetails) ? message.stopDetails.type : undefined;
    return type === 'refusal' || type === 'sensitive';
}
