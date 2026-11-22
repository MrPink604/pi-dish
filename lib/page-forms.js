// Generated from src/core/page-forms.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORM_STYLE = exports.MAX_ANSWER_BYTES = exports.MAX_FORM_RESPONSE_BYTES = exports.PAGE_FORMS_RELAY_LIMIT = exports.MAX_RECEIPTS = exports.FORM_CLIENT_HEADER = exports.SUBMISSION_ID_RE = exports.PAGE_FORMS_CAPABILITY = exports.FIELD_TYPES = void 0;
exports.isAbsoluteImage = isAbsoluteImage;
exports.mayContainForm = mayContainForm;
exports.pageDocumentPath = pageDocumentPath;
exports.parsePageForm = parsePageForm;
exports.readPageForm = readPageForm;
exports.parseFormSpec = parseFormSpec;
exports.validateAnswers = validateAnswers;
exports.changedQuestions = changedQuestions;
exports.visibleText = visibleText;
exports.formatFormMessage = formatFormMessage;
exports.readSubmissions = readSubmissions;
exports.receiptOf = receiptOf;
exports.acceptSubmission = acceptSubmission;
exports.finishSubmission = finishSubmission;
exports.deleteSubmissions = deleteSubmissions;
exports.clientSpec = clientSpec;
exports.formFingerprint = formFingerprint;
exports.renderForm = renderForm;
exports.renderPageForm = renderPageForm;
/**
 * Forms in published pages. An agent declares one form in its HTML page with
 * `<script type="application/pi-dish-form">{JSON}</script>`. Publishing
 * validates it. The sandboxed artifact only ever shows a read-only preview;
 * the owner answers in pi-dish's own form view (`/forms/:token`), which reads
 * the spec and submits through the authenticated API. A submission is checked
 * against the spec on disk at that moment, then formatted as one message for
 * the session that published the page.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dish_store_1 = require("./dish-store");
const helper_format_1 = require("./helper-format");
const helper_values_1 = require("./helper-values");
exports.FIELD_TYPES = ['choice', 'grid', 'multi', 'yesno', 'approve', 'text', 'longtext'];
/** An option image that is served as given; anything else resolves under the page. */
function isAbsoluteImage(url) {
    return /^(?:https?:)?\/\//i.test(url) || /^data:image\//i.test(url);
}
/** Advertised in /api/host; a hub relays form calls only to a host that has it. */
exports.PAGE_FORMS_CAPABILITY = 'pageFormsV2';
/** Submission ids, chosen by the form view; also checked before a hub relays one. */
exports.SUBMISSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/**
 * Required on every form route: `view` (the owner form view), `cli`
 * (pi-dish-pages) or `relay` (a hub's dedicated form relay). A cross-site page
 * cannot add a custom header without a CORS preflight these routes never
 * answer, so an older hub's generic relay, which strips Origin (and on plain
 * HTTP has no Fetch Metadata to forward), cannot carry a cross-site request.
 */
exports.FORM_CLIENT_HEADER = 'x-pi-dish-form-client';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const FORM_MARKER_RE = /application\/pi-dish-form/i;
// One start-tag attribute, its `>` or a stray `/`; a quoted value may hold `>`, `=` or spaces.
const ATTRIBUTE_RE = /[\s/]*(?:(>)|([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?)/y;
const TAG_OPEN_RE = /<([a-zA-Z][^\s/>]*)/y;
// Elements whose content is text or inert, not markup, up to their own end tag.
const RAW_TEXT = { script: true, style: true, textarea: true, title: true, template: true };
const TEMPLATE_CLOSE_RE = /<\/template(?=[\t\n\f\r />])/iy;
const MAX_QUESTIONS = 300;
const MAX_OPTIONS = 50;
const MAX_TEXT = 10000;
const MAX_SHORT_TEXT = 1000;
const KEPT_SUBMISSIONS = 30;
/** Receipts are never evicted; a page that has taken this many takes no more. */
exports.MAX_RECEIPTS = 2000;
/** The body a hub relays for one form call, and what every form response must fit. */
exports.PAGE_FORMS_RELAY_LIMIT = 1024 * 1024;
exports.MAX_FORM_RESPONSE_BYTES = 960 * 1024;
// Each part fits, with room for the rest, in MAX_FORM_RESPONSE_BYTES.
const MAX_SPEC_BYTES = 256 * 1024;
exports.MAX_ANSWER_BYTES = 256 * 1024;
const MAX_WIRE_BYTES = 512 * 1024;
// What one answer and the whole message may contribute to the agent's context.
const MAX_MESSAGE_VALUE = 2000;
const MAX_MESSAGE_BYTES = 32 * 1024;
const TOP_KEYS = ['title', 'intro', 'submitLabel', 'fields'];
const OPTION_KEYS = ['value', 'label', 'image', 'help'];
const ROW_KEYS = ['id', 'label', 'help', 'required', 'default', 'options'];
const FIELD_KEYS = {
    choice: ['options'],
    grid: ['options', 'rows'],
    multi: ['options'],
    yesno: ['yes', 'no'],
    approve: ['yes', 'no'],
    text: ['placeholder'],
    longtext: ['placeholder'],
};
const COMMON_KEYS = ['id', 'type', 'label', 'help', 'required', 'default'];
/** Cheap pre-check before any parsing; matches every spelling the block regex accepts. */
function mayContainForm(html) {
    return FORM_MARKER_RE.test(html);
}
/** The page document that may carry a form: an .html file root or a directory's index.html. */
function pageDocumentPath(root) {
    try {
        const stat = fs.statSync(root);
        if (stat.isDirectory())
            return path.join(root, 'index.html');
        return stat.isFile() && path.extname(root).toLowerCase() === '.html' ? root : null;
    }
    catch {
        return null;
    }
}
/**
 * A small tolerant scan for `<script type="application/pi-dish-form">`: a
 * comment is skipped whole (an unterminated one runs to the end, as in a
 * browser), every start tag's attributes are read with their quoted values
 * (so markup inside a value is text), raw-text content is skipped up to a
 * real end tag (`</name` then HTML whitespace, `/` or `>`) and `<template>`
 * content up to its matching end tag (nesting counted; comments and raw-text
 * contents inside it skipped), and
 * only a script's own `type` attribute (the first, case-insensitive) declares.
 * Known limits, none of which can answer a form (that takes the owner's
 * submit in pi-dish's own view): foreign content such as an SVG `<title/>`
 * or `<script>` is read with HTML rules, CDATA sections are not recognized,
 * and entity-encoded markup is not decoded.
 */
function findBlocks(html) {
    const blocks = [];
    for (let at = html.indexOf('<'); at !== -1; at = html.indexOf('<', at)) {
        if (html.startsWith('<!--', at)) {
            const close = html.indexOf('-->', at + 4);
            if (close === -1)
                break;
            at = close + 3;
            continue;
        }
        TAG_OPEN_RE.lastIndex = at;
        const name = TAG_OPEN_RE.exec(html)?.[1].toLowerCase();
        const tag = name ? startTag(html, TAG_OPEN_RE.lastIndex) : null;
        if (!name || !tag) {
            at++;
            continue;
        }
        if (!Object.hasOwn(RAW_TEXT, name)) {
            at = tag.end;
            continue;
        }
        const close = name === 'template' ? templateEnd(html, tag.end) : rawTextEnd(html, name, tag.end);
        const contentEnd = close === -1 ? html.length : close;
        const end = close === -1 ? html.length : (html.indexOf('>', close) + 1 || html.length);
        if (name === 'script' && tag.attributes.get('type')?.trim().toLowerCase() === 'application/pi-dish-form') {
            blocks.push({ start: at, end, source: html.slice(tag.end, contentEnd) });
        }
        at = end;
    }
    return blocks;
}
/** Where a raw-text element whose content starts at `from` ends (its `</name`), or -1. */
function rawTextEnd(html, name, from) {
    const closing = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'gi');
    closing.lastIndex = from;
    return closing.exec(html)?.index ?? -1;
}
/**
 * Where the template whose content starts at `from` ends (its `</template`),
 * or -1. Its content is scanned like the document: comments skipped, every
 * start tag read with its quoted attribute values, raw-text contents skipped,
 * nested templates counted.
 */
function templateEnd(html, from) {
    let depth = 1;
    for (let at = html.indexOf('<', from); at !== -1; at = html.indexOf('<', at)) {
        if (html.startsWith('<!--', at)) {
            const close = html.indexOf('-->', at + 4);
            if (close === -1)
                return -1;
            at = close + 3;
            continue;
        }
        TEMPLATE_CLOSE_RE.lastIndex = at;
        if (TEMPLATE_CLOSE_RE.test(html)) {
            if (--depth === 0)
                return at;
            at += 2;
            continue;
        }
        TAG_OPEN_RE.lastIndex = at;
        const name = TAG_OPEN_RE.exec(html)?.[1].toLowerCase();
        const tag = name ? startTag(html, TAG_OPEN_RE.lastIndex) : null;
        if (!name || !tag) {
            at++;
            continue;
        }
        if (name === 'template') {
            depth++;
            at = tag.end;
        }
        else if (Object.hasOwn(RAW_TEXT, name)) {
            const close = rawTextEnd(html, name, tag.end);
            if (close === -1)
                return -1;
            at = close + 2 + name.length;
        }
        else {
            at = tag.end;
        }
    }
    return -1;
}
/** A start tag's attributes from just past its name, and where it ends; null when unterminated or malformed. */
function startTag(html, from) {
    const attributes = new Map();
    ATTRIBUTE_RE.lastIndex = from;
    for (let match = ATTRIBUTE_RE.exec(html); match; match = ATTRIBUTE_RE.exec(html)) {
        if (match[1])
            return { attributes, end: ATTRIBUTE_RE.lastIndex };
        const name = match[2].toLowerCase();
        if (!attributes.has(name))
            attributes.set(name, match[3] ?? match[4] ?? match[5] ?? '');
    }
    return null;
}
/** Null when the document declares no form. */
function parsePageForm(html) {
    if (!mayContainForm(html))
        return null;
    const blocks = findBlocks(html);
    if (!blocks.length)
        return null;
    if (blocks.length > 1) {
        return { errors: [`a page may contain only one pi-dish-form block (found ${blocks.length})`], block: blocks[0] };
    }
    if (Buffer.byteLength(blocks[0].source) > MAX_SPEC_BYTES) {
        return { errors: [`the pi-dish-form block is larger than ${MAX_SPEC_BYTES / 1024} KiB`], block: blocks[0] };
    }
    const result = parseFormSpec(blocks[0].source);
    return 'spec' in result ? { spec: result.spec, block: blocks[0] } : { errors: result.errors, block: blocks[0] };
}
/** Reads the live page document; null when it has no form or cannot be read. */
function readPageForm(root) {
    const file = pageDocumentPath(root);
    if (!file)
        return null;
    let html;
    try {
        html = fs.readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
    return parsePageForm(html);
}
function parseFormSpec(source) {
    let raw;
    try {
        raw = JSON.parse(source);
    }
    catch (error) {
        return { errors: [`the pi-dish-form block is not valid JSON (${error instanceof Error ? error.message : String(error)})`] };
    }
    const errors = [];
    const spec = validateSpec(raw, errors);
    if (!spec || errors.length)
        return { errors };
    // What pi-dish's form view loads, possibly through a hub's relay, with every
    // relative image resolved under the longest page route it could get.
    const wire = Buffer.byteLength(JSON.stringify(clientSpec(spec, url => (isAbsoluteImage(url) ? url : `/page/${'x'.repeat(43)}/${url}`))));
    if (wire > MAX_WIRE_BYTES) {
        return { errors: [`the form is ${Math.ceil(wire / 1024)} KiB as sent to pi-dish's form view (limit ${MAX_WIRE_BYTES / 1024} KiB): `
                    + 'give a grid shared "options" instead of repeating them per row, or use smaller images'] };
    }
    return { spec };
}
function optionalText(value, where, max, errors) {
    if (value == null)
        return null;
    if (typeof value !== 'string') {
        errors.push(`${where} must be a string`);
        return null;
    }
    if (value.length > max) {
        errors.push(`${where} is longer than ${max} characters`);
        return null;
    }
    return value.trim() || null;
}
function unknownKeys(value, allowed, where, errors) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key))
            errors.push(`${where} has unknown key "${key}" (allowed: ${allowed.join(', ')})`);
    }
}
// Relative URLs resolve under the page; absolute ones must be web or inline images.
function safeImage(value) {
    if (/^(?:https?:)?\/\//i.test(value) || /^data:image\//i.test(value))
        return true;
    return !/^[a-z][a-z0-9+.-]*:/i.test(value.replace(/[\s\u0000-\u001f]/g, ''));
}
function validateOptions(value, where, errors) {
    if (!Array.isArray(value) || !value.length) {
        errors.push(`${where} must be a non-empty array`);
        return null;
    }
    if (value.length > MAX_OPTIONS) {
        errors.push(`${where} has more than ${MAX_OPTIONS} options`);
        return null;
    }
    const options = [];
    const seen = new Set();
    value.forEach((item, index) => {
        const at = `${where}[${index}]`;
        const option = typeof item === 'string' ? { value: item } : item;
        if (!(0, helper_values_1.record)(option)) {
            errors.push(`${at} must be a string or an object with "value"`);
            return;
        }
        unknownKeys(option, OPTION_KEYS, at, errors);
        const optionValue = option.value;
        if (typeof optionValue !== 'string' || !optionValue.trim() || optionValue.length > 200) {
            errors.push(`${at}.value must be a non-empty string of at most 200 characters`);
            return;
        }
        if (seen.has(optionValue)) {
            errors.push(`${at}.value "${optionValue}" is repeated`);
            return;
        }
        seen.add(optionValue);
        let image = optionalText(option.image, `${at}.image`, 2000, errors);
        if (image && !safeImage(image)) {
            errors.push(`${at}.image must be a relative, http(s) or data:image URL`);
            image = null;
        }
        options.push({
            value: optionValue,
            label: optionalText(option.label, `${at}.label`, 500, errors) || optionValue,
            image,
            help: optionalText(option.help, `${at}.help`, 2000, errors),
        });
    });
    return options;
}
function validateDefault(question, value, where, errors) {
    if (value == null)
        return null;
    const values = question.options.map(option => option.value);
    switch (question.kind) {
        case 'choice':
            if (typeof value === 'string' && values.includes(value))
                return value;
            errors.push(`${where}.default must be one of the option values (${values.join(', ')})`);
            return null;
        case 'multi':
            if (Array.isArray(value) && value.every(item => typeof item === 'string' && values.includes(item))) {
                return [...new Set(value)];
            }
            errors.push(`${where}.default must be an array of option values (${values.join(', ')})`);
            return null;
        case 'bool':
            if (typeof value === 'boolean')
                return value;
            errors.push(`${where}.default must be true or false`);
            return null;
        default:
            // An empty default is no default: an empty answer reads as unanswered.
            if (typeof value === 'string' && value.length <= (question.kind === 'text' ? MAX_SHORT_TEXT : MAX_TEXT))
                return value || null;
            errors.push(`${where}.default must be a string`);
            return null;
    }
}
function claimId(value, where, ids, errors) {
    if (typeof value !== 'string' || !ID_RE.test(value)) {
        errors.push(`${where}.id must be 1-64 characters of letters, digits, ".", "_", ":" or "-", starting with a letter or digit`);
        return null;
    }
    if (ids.has(value)) {
        errors.push(`${where}.id "${value}" is used more than once`);
        return null;
    }
    ids.add(value);
    return value;
}
function requiredFlag(value, where, errors, fallback = false) {
    if (value == null)
        return fallback;
    if (typeof value === 'boolean')
        return value;
    errors.push(`${where}.required must be true or false`);
    return fallback;
}
function validateSpec(raw, errors) {
    if (!(0, helper_values_1.record)(raw)) {
        errors.push('the pi-dish-form block must be a JSON object with a "fields" array');
        return null;
    }
    unknownKeys(raw, TOP_KEYS, 'the form', errors);
    if (!Array.isArray(raw.fields) || !raw.fields.length) {
        errors.push('"fields" must be a non-empty array');
        return null;
    }
    const ids = new Set();
    const sections = [];
    const questions = [];
    raw.fields.forEach((field, index) => {
        let where = `fields[${index}]`;
        if (!(0, helper_values_1.record)(field)) {
            errors.push(`${where} must be an object`);
            return;
        }
        if (typeof field.id === 'string')
            where += ` ("${field.id}")`;
        const type = field.type;
        if (typeof type !== 'string' || !exports.FIELD_TYPES.includes(type)) {
            errors.push(`${where}.type must be one of ${exports.FIELD_TYPES.join(', ')}`);
            return;
        }
        const fieldType = type;
        unknownKeys(field, [...COMMON_KEYS, ...FIELD_KEYS[fieldType]].filter(key => fieldType !== 'grid' || key !== 'default'), where, errors);
        // An invalid id is already an error, so the spec is discarded; keep
        // checking the rest of the field so every mistake is reported at once.
        const id = claimId(field.id, where, ids, errors) ?? '';
        const label = optionalText(field.label, `${where}.label`, 500, errors);
        const help = optionalText(field.help, `${where}.help`, 2000, errors);
        const required = requiredFlag(field.required, where, errors);
        if (fieldType === 'grid') {
            const shared = field.options == null ? null : validateOptions(field.options, `${where}.options`, errors);
            if (!Array.isArray(field.rows) || !field.rows.length) {
                errors.push(`${where}.rows must be a non-empty array`);
                return;
            }
            const rows = [];
            field.rows.forEach((row, rowIndex) => {
                let rowWhere = `${where}.rows[${rowIndex}]`;
                if (!(0, helper_values_1.record)(row)) {
                    errors.push(`${rowWhere} must be an object`);
                    return;
                }
                if (typeof row.id === 'string')
                    rowWhere += ` ("${row.id}")`;
                unknownKeys(row, ROW_KEYS, rowWhere, errors);
                const rowId = claimId(row.id, rowWhere, ids, errors) ?? '';
                const options = row.options == null ? shared : validateOptions(row.options, `${rowWhere}.options`, errors);
                if (!options) {
                    if (row.options == null && field.options == null)
                        errors.push(`${rowWhere} needs "options" (or give the grid shared "options")`);
                    return;
                }
                const question = {
                    id: rowId, kind: 'choice',
                    label: optionalText(row.label, `${rowWhere}.label`, 500, errors) || rowId,
                    help: optionalText(row.help, `${rowWhere}.help`, 2000, errors),
                    required: requiredFlag(row.required, rowWhere, errors, required),
                    options, default: null, yes: 'yes', no: 'no', placeholder: null,
                };
                question.default = validateDefault(question, row.default, rowWhere, errors);
                rows.push(question);
            });
            sections.push({ kind: 'grid', id, label: label || id, help, options: shared, questions: rows });
            questions.push(...rows);
            return;
        }
        const kind = fieldType === 'yesno' || fieldType === 'approve' ? 'bool' : fieldType;
        const options = kind === 'choice' || kind === 'multi' ? validateOptions(field.options, `${where}.options`, errors) : [];
        if (!options)
            return;
        const approve = fieldType === 'approve';
        const question = {
            id, kind, label: label || id, help, required, options, default: null,
            yes: optionalText(field.yes, `${where}.yes`, 100, errors) || (approve ? 'approve' : 'yes'),
            no: optionalText(field.no, `${where}.no`, 100, errors) || (approve ? 'reject' : 'no'),
            placeholder: optionalText(field.placeholder, `${where}.placeholder`, 500, errors),
        };
        question.default = validateDefault(question, field.default, where, errors);
        sections.push({ kind: 'question', question });
        questions.push(question);
    });
    if (questions.length > MAX_QUESTIONS)
        errors.push(`a form may have at most ${MAX_QUESTIONS} questions (found ${questions.length})`);
    return {
        title: optionalText(raw.title, 'title', 500, errors),
        intro: optionalText(raw.intro, 'intro', 4000, errors),
        submitLabel: optionalText(raw.submitLabel, 'submitLabel', 100, errors),
        sections,
        questions,
    };
}
// ---- answers ---------------------------------------------------------------
function validateAnswers(spec, raw) {
    if (!(0, helper_values_1.record)(raw))
        return { errors: ['answers must be an object keyed by field id'] };
    const errors = [];
    const known = new Set(spec.questions.map(question => question.id));
    for (const key of Object.keys(raw))
        if (!known.has(key))
            errors.push(`unknown field "${key}"`);
    const answers = {};
    for (const question of spec.questions) {
        const value = raw[question.id];
        const values = question.options.map(option => option.value);
        let answer = null;
        if (value == null || value === '')
            answer = null;
        else if (question.kind === 'choice') {
            if (typeof value === 'string' && values.includes(value))
                answer = value;
            else
                errors.push(`"${question.id}" must be one of ${values.join(', ')}`);
        }
        else if (question.kind === 'multi') {
            if (Array.isArray(value) && value.every(item => typeof item === 'string' && values.includes(item))) {
                answer = values.filter(option => value.includes(option));
            }
            else
                errors.push(`"${question.id}" must be a list of ${values.join(', ')}`);
        }
        else if (question.kind === 'bool') {
            if (typeof value === 'boolean')
                answer = value;
            else
                errors.push(`"${question.id}" must be true or false`);
        }
        else if (typeof value === 'string' && value.length <= (question.kind === 'text' ? MAX_SHORT_TEXT : MAX_TEXT)) {
            answer = value;
        }
        else
            errors.push(`"${question.id}" must be text of at most ${question.kind === 'text' ? MAX_SHORT_TEXT : MAX_TEXT} characters`);
        const empty = answer == null || (Array.isArray(answer) && !answer.length) || (typeof answer === 'string' && !answer.trim());
        if (question.required && empty)
            errors.push(`"${question.id}" is required`);
        answers[question.id] = answer;
    }
    // Budgeted as stored and served: the serialized answer set, escapes included.
    const serialized = Buffer.byteLength(JSON.stringify(answers));
    if (serialized > exports.MAX_ANSWER_BYTES)
        errors.push(`the answers total ${Math.ceil(serialized / 1024)} KiB as stored (limit ${exports.MAX_ANSWER_BYTES / 1024} KiB)`);
    return errors.length ? { errors } : { answers };
}
function sameAnswer(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
        const left = Array.isArray(a) ? [...a].sort() : [];
        const right = Array.isArray(b) ? [...b].sort() : [];
        return left.length === right.length && left.every((value, index) => value === right[index]);
    }
    return (a ?? null) === (b ?? null);
}
/** Questions with a default whose answer differs from it, in form order. */
function changedQuestions(spec, answers) {
    return spec.questions.filter(question => question.default != null && !sameAnswer(answers[question.id] ?? null, question.default));
}
// C0 (except tab and newline), DEL, C1, bidi and line-separator controls are
// shown as escapes, so an answer can neither drive a terminal (ANSI sequences
// lose their ESC) nor reorder or hide text in the agent's transcript.
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
function visibleText(text) {
    return text.replace(/\r\n?/g, '\n').replace(CONTROL_RE, (char) => {
        const code = char.charCodeAt(0);
        return code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`;
    });
}
// Prompt syntax OMP (18.22) acts on wherever it appears in a prompt: `^model`
// selectors, `@file` mentions (read and attached), `+N[k|m]` turn budgets and
// standalone magic keywords. A preceding backslash defuses each, so a message
// for an OMP session is written with one on every line (the stored answer set
// keeps the raw text). Other harnesses get the text as it is. Every message
// opens with `[`, so an answer's leading `/` (a command) or `!` never reaches
// the start of the prompt.
const MAGIC_KEYWORDS = /(?<![\p{L}\p{N}_./\\-])(ultrathink|chillax|orchestrate|workflowz|jevify)(?![\p{L}\p{N}_/\\-])/gu;
function literalPrompt(text) {
    return text
        .replace(/(^|\s)\^/g, '$1\\^')
        .replace(/(^|[\s([{<"'`])@/g, '$1\\@')
        .replace(/(^|\s)\+(?=\d)/g, '$1\\+')
        .replace(MAGIC_KEYWORDS, '\\$1');
}
function messageText(text) {
    const shown = visibleText(text);
    return shown.length > MAX_MESSAGE_VALUE
        ? `${shown.slice(0, MAX_MESSAGE_VALUE)}… (${shown.length - MAX_MESSAGE_VALUE} more characters in the full answer set)`
        : shown;
}
function formatValue(question, value) {
    if (value == null)
        return '(no answer)';
    if (typeof value === 'boolean')
        return messageText(value ? question.yes : question.no);
    if (Array.isArray(value))
        return value.length ? value.map(messageText).join(', ') : '(none)';
    return value.trim() ? messageText(value) : '(empty)';
}
function answerLine(question, value, suffix = '') {
    const formatted = formatValue(question, value);
    if (typeof value !== 'string' || !formatted.includes('\n'))
        return `${question.id}: ${formatted}${suffix}`;
    const body = formatted.split('\n').map(line => `  ${line}`).join('\n');
    return `${question.id}:${suffix} |\n${body}`;
}
function isoSeconds(at) {
    return new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
/**
 * Changed answers first, unchanged defaults summarized, then answers that had
 * no default; the footer names this submission's own stored answer set. The
 * whole message, footer and omission marker included, fits MAX_MESSAGE_BYTES.
 */
function formatFormMessage({ spec, answers, token, submissionId, pageTitle, submittedAt, revision, previousAt, ompRecipient }) {
    const literal = ompRecipient ? literalPrompt : (text) => text;
    const title = messageText((pageTitle || spec.title || 'untitled page').replace(/\s+/g, ' '));
    const header = literal(revision > 1
        ? `[form response revision ${revision}: ${title} (${token}), submitted ${isoSeconds(submittedAt)}${previousAt ? `; replaces the response of ${isoSeconds(previousAt)}` : ''}]`
        : `[form response: ${title} (${token}), submitted ${isoSeconds(submittedAt)}]`);
    const raw = [];
    const changed = changedQuestions(spec, answers);
    for (const question of changed) {
        raw.push(answerLine(question, answers[question.id] ?? null, ` (default ${formatValue(question, question.default)})`));
    }
    const defaulted = spec.questions.filter(question => question.default != null);
    if (defaulted.length > changed.length)
        raw.push(changed.length ? 'all other fields: default' : 'no changes from defaults');
    const unanswered = [];
    for (const question of spec.questions) {
        if (question.default != null)
            continue;
        const value = answers[question.id] ?? null;
        if (value == null)
            unanswered.push(question.id);
        else
            raw.push(answerLine(question, value));
    }
    if (unanswered.length)
        raw.push(`unanswered: ${unanswered.join(', ')}`);
    const lines = raw.map(literal);
    const footer = `full answer set: pi-dish-pages answers ${token} --submission ${submissionId}`;
    const omitted = (count) => `… (${count} more lines in the full answer set)`;
    // The widest marker is reserved up front, so writing the real one never overflows.
    let used = Buffer.byteLength(header) + Buffer.byteLength(footer) + Buffer.byteLength(omitted(lines.length)) + 3;
    const kept = [];
    for (const [index, line] of lines.entries()) {
        const cost = Buffer.byteLength(line) + 1;
        if (used + cost > MAX_MESSAGE_BYTES) {
            kept.push(omitted(lines.length - index));
            break;
        }
        kept.push(line);
        used += cost;
    }
    return [header, ...kept, footer].join('\n');
}
// ---- submissions -------------------------------------------------------------
const STORE = 'page-forms.json';
const RECEIPT_STATES = { delivering: true, delivered: true, failed: true, uncertain: true };
function isReceiptRecord(value) {
    return (0, helper_values_1.record)(value) && typeof value.id === 'string' && typeof value.state === 'string' && Object.hasOwn(RECEIPT_STATES, value.state)
        && Number.isInteger(value.revision) && typeof value.acceptedAt === 'number'
        && (value.finishedAt === null || typeof value.finishedAt === 'number')
        && (value.error === null || typeof value.error === 'string') && typeof value.sessionId === 'string';
}
function isSubmission(value) {
    return (0, helper_values_1.record)(value) && typeof value.fingerprint === 'string' && (0, helper_values_1.record)(value.answers) && Array.isArray(value.changed)
        && isReceiptRecord(value);
}
/**
 * A token's record, or null when the store has none. A record that is there
 * but malformed or inconsistent (an id without its receipt, a revision the
 * current answer set does not carry) throws: read as empty, it could replay
 * a delivered id or move the revision back.
 */
function formRecord(store, token) {
    if (!Object.hasOwn(store, token))
        return null;
    const entry = store[token];
    const malformed = (why) => { throw new Error(`${STORE}: the record of page ${token} is malformed (${why})`); };
    if (!(0, helper_values_1.record)(entry))
        return malformed('not an object');
    const { revision, current, submissions, receipts } = entry;
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0)
        return malformed('revision');
    if (!Array.isArray(receipts) || !receipts.every(isReceiptRecord))
        return malformed('receipts');
    if (!Array.isArray(submissions) || !submissions.every(isSubmission))
        return malformed('submissions');
    if (current !== null && !isSubmission(current))
        return malformed('current answer set');
    const byId = new Map(receipts.map(receipt => [receipt.id, receipt]));
    if (byId.size !== receipts.length)
        return malformed('a repeated receipt id');
    for (const submission of submissions) {
        const receipt = byId.get(submission.id);
        if (!receipt || receipt.state !== submission.state || receipt.revision !== submission.revision) {
            return malformed(`submission ${submission.id} disagrees with its receipt`);
        }
    }
    if (current ? current.state !== 'delivered' || current.revision !== revision || byId.get(current.id)?.state !== 'delivered' : revision !== 0) {
        return malformed('the revision and the current answer set disagree');
    }
    if (receipts.some(receipt => receipt.state === 'delivered' && receipt.revision > revision)) {
        return malformed('a delivered receipt past the revision');
    }
    return { revision, current, submissions, receipts };
}
// Raw answers are the owner's words: the file is owner-only and replaced durably.
function writeForms(store) {
    fs.mkdirSync((0, dish_store_1.dishDir)(), { recursive: true });
    (0, dish_store_1.replaceFileDurably)(path.join((0, dish_store_1.dishDir)(), STORE), JSON.stringify(store, null, 2) + '\n');
}
// Unlike dish-store's lenient readStore, only a missing file is empty: an
// unreadable or corrupt store throws, so a delivered id is never replayed.
function readForms() {
    let text;
    try {
        text = fs.readFileSync(path.join((0, dish_store_1.dishDir)(), STORE), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return {};
        throw error;
    }
    const data = JSON.parse(text);
    if (!(0, helper_values_1.record)(data))
        throw new Error(`${STORE} is not a JSON object`);
    return data;
}
function readSubmissions(token) {
    return formRecord(readForms(), token) ?? { revision: 0, current: null, submissions: [], receipts: [] };
}
function receiptOf(receipt) {
    const { id, state, revision, acceptedAt, finishedAt, error } = receipt;
    return { id, state, revision, acceptedAt, finishedAt, error };
}
/** Records an accepted submission, answers and receipt, before anything is sent. */
function acceptSubmission(token, submission) {
    const store = readForms();
    const entry = formRecord(store, token) ?? { revision: 0, current: null, submissions: [], receipts: [] };
    entry.submissions = [...entry.submissions, submission].slice(-KEPT_SUBMISSIONS);
    const { id, state, revision, acceptedAt, finishedAt, error, sessionId } = submission;
    entry.receipts = [...entry.receipts, { id, state, revision, acceptedAt, finishedAt, error, sessionId }];
    store[token] = entry;
    writeForms(store);
}
/**
 * Settles a submission; a delivered one becomes the current answer set and
 * advances the revision in the same write. False when the page was
 * unpublished meanwhile: revocation removed the entry and wins.
 */
function finishSubmission(token, id, outcome) {
    const store = readForms();
    const entry = formRecord(store, token);
    const receipt = entry?.receipts.find(item => item.id === id);
    if (!entry || !receipt)
        return false;
    Object.assign(receipt, outcome);
    const submission = entry.submissions.find(item => item.id === id);
    if (submission)
        Object.assign(submission, outcome);
    if (outcome.state === 'delivered' && submission && submission.revision > entry.revision) {
        entry.revision = submission.revision;
        entry.current = submission;
    }
    store[token] = entry;
    writeForms(store);
    return true;
}
function deleteSubmissions(token) {
    const store = readForms();
    if (!Object.hasOwn(store, token))
        return;
    delete store[token];
    writeForms(store);
}
// ---- the owner form's data -----------------------------------------------------
/**
 * Everything the trusted owner form renders, image URLs resolved for it. A
 * grid's shared options travel once, on the grid; its rows carry only options
 * of their own. The fingerprint covers this (unresolved) plus the destination
 * session, so a view of another form or recipient cannot submit to this one.
 */
function clientSpec(spec, resolveImage = url => url) {
    const options = (list) => list.map(option => ({ ...option, image: option.image ? resolveImage(option.image) : null }));
    const question = (item, shared = null) => ({
        id: item.id, kind: item.kind, label: item.label, help: item.help, required: item.required,
        default: item.default, yes: item.yes, no: item.no, placeholder: item.placeholder,
        options: shared && item.options === shared ? null : options(item.options),
    });
    return {
        title: spec.title,
        intro: spec.intro,
        submitLabel: spec.submitLabel,
        sections: spec.sections.map(section => section.kind === 'question'
            ? { kind: 'question', question: question(section.question) }
            : {
                kind: 'grid', id: section.id, label: section.label, help: section.help,
                options: section.options ? options(section.options) : null,
                questions: section.questions.map(item => question(item, section.options)),
            }),
    };
}
function formFingerprint(spec, sessionId) {
    return crypto.createHash('sha256').update(JSON.stringify(clientSpec(spec))).update('\0').update(sessionId)
        .digest('base64url').slice(0, 22);
}
// ---- rendering ---------------------------------------------------------------
/** Shared by the artifact's inline preview and the owner form view's stylesheet. */
exports.FORM_STYLE = `
.pdf{--pdf-accent:#268bd2;color-scheme:light dark;font:16px/1.45 ui-sans-serif,system-ui,sans-serif;color:CanvasText;background:Canvas;
  border:1px solid color-mix(in srgb,CanvasText 22%,Canvas);border-radius:12px;margin:16px 0;padding:0;max-width:100%}
.pdf *{box-sizing:border-box}
.pdf-head{padding:14px 16px 4px}.pdf-head h2{margin:0 0 6px;font-size:1.2em}.pdf-head p{margin:0 0 8px;white-space:pre-wrap}
.pdf-notice{margin:8px 16px;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,var(--pdf-accent) 12%,Canvas);font-size:14px}
.pdf-notice:empty{display:none}
.pdf-section{margin:0;padding:10px 16px;border:0;border-top:1px solid color-mix(in srgb,CanvasText 12%,Canvas)}
.pdf-section>h3{margin:4px 0;font-size:1.05em}
.pdf-q{margin:0;padding:10px 12px;border:0;border-left:4px solid transparent;border-radius:6px;min-width:0}
.pdf-section>.pdf-q{padding-left:12px}
.pdf-q[data-changed]{border-left-color:var(--pdf-accent);background:color-mix(in srgb,var(--pdf-accent) 7%,Canvas)}
.pdf-q legend{padding:0;font-weight:600;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.pdf-id{font:12px ui-monospace,monospace;padding:1px 6px;border-radius:4px;background:color-mix(in srgb,CanvasText 10%,Canvas)}
.pdf-req{font-size:12px;font-weight:400;color:#cb4b16}
.pdf-flag{display:none;font-size:12px;font-weight:600;color:var(--pdf-accent)}
.pdf-q[data-changed] .pdf-flag{display:inline}
.pdf-help{margin:4px 0 0;font-size:14px;color:color-mix(in srgb,CanvasText 70%,Canvas);white-space:pre-wrap}
.pdf-opts{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.pdf-opts.pdf-images{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
.pdf-opt{position:relative;display:flex;flex-direction:column;justify-content:center;gap:6px;min-height:44px;min-width:44px;padding:8px 12px;
  border:1px solid color-mix(in srgb,CanvasText 25%,Canvas);border-radius:8px;cursor:pointer;background:Canvas}
.pdf-opt:has(input:checked){border-color:var(--pdf-accent);box-shadow:0 0 0 2px var(--pdf-accent)}
.pdf-opt:has(input:focus-visible){outline:2px solid var(--pdf-accent);outline-offset:2px}
.pdf-opt input{position:absolute;opacity:0;pointer-events:none}
.pdf-opt img{display:block;width:100%;height:auto;max-height:260px;object-fit:contain;border-radius:4px}
.pdf-opt-label{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.pdf-opt-label::before{content:"";flex:none;width:18px;height:18px;border:2px solid color-mix(in srgb,CanvasText 45%,Canvas);border-radius:50%}
.pdf-opt[data-multi] .pdf-opt-label::before{border-radius:4px}
.pdf-opt:has(input:checked) .pdf-opt-label::before{border-color:var(--pdf-accent);background:radial-gradient(var(--pdf-accent) 45%,transparent 50%)}
.pdf-opt[data-multi]:has(input:checked) .pdf-opt-label::before{background:var(--pdf-accent)}
.pdf-default{font-size:11px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,CanvasText 12%,Canvas)}
.pdf-opt-help{font-size:13px;color:color-mix(in srgb,CanvasText 70%,Canvas)}
.pdf-text{display:block;width:100%;min-height:44px;margin-top:8px;padding:10px;font:inherit;color:CanvasText;background:Canvas;
  border:1px solid color-mix(in srgb,CanvasText 30%,Canvas);border-radius:8px}
textarea.pdf-text{min-height:96px;resize:vertical}
.pdf-bar{position:sticky;bottom:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 16px;
  border-top:1px solid color-mix(in srgb,CanvasText 18%,Canvas);border-radius:0 0 12px 12px;background:Canvas;box-shadow:0 -6px 16px #0002}
.pdf-summary{flex:1 1 200px;font-size:14px;min-width:0;overflow-wrap:anywhere}
.pdf-status{flex:1 1 100%;font-size:13px;color:color-mix(in srgb,CanvasText 70%,Canvas)}
.pdf-status:empty{display:none}
.pdf-status[data-tone=error]{color:#dc322f}
.pdf-status[data-tone=ok]{color:#2aa035}
.pdf-status[data-tone=warn]{color:#b58900}
.pdf-submit{min-height:44px;min-width:44px;padding:10px 18px;font:inherit;font-weight:600;color:#fff;background:var(--pdf-accent);
  border:0;border-radius:8px;cursor:pointer}
.pdf-submit:disabled{opacity:.55;cursor:default}
.pdf-button{min-height:44px;min-width:44px;padding:10px 14px;font:inherit;color:CanvasText;background:Canvas;
  border:1px solid color-mix(in srgb,CanvasText 35%,Canvas);border-radius:8px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.pdf-answer{display:inline-flex;align-items:center;min-height:44px;margin-top:6px;padding:10px 16px;font-weight:600;color:#fff;
  background:var(--pdf-accent);border-radius:8px;text-decoration:none}
.pdf fieldset:disabled .pdf-opt,.pdf fieldset:disabled .pdf-text{cursor:default;opacity:.85}
.pdf-error{margin:16px 0;padding:12px 16px;border:2px solid #dc322f;border-radius:10px;font:14px/1.4 ui-sans-serif,system-ui,sans-serif}
body.pdf-app{margin:0 auto;padding:12px;max-width:860px;font:16px/1.45 ui-sans-serif,system-ui,sans-serif;color-scheme:light dark}
.pdf-app-nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.pdf-app-nav h1{margin:0;font-size:1.25em}
.pdf-actions{display:flex;flex-wrap:wrap;gap:8px;flex:1 1 100%}
.pdf-actions:empty{display:none}
.pdf-conflict{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 16px;padding:12px 16px;border:2px solid #dc322f;border-radius:10px;font-size:14px;scroll-margin-top:12px}
.pdf-conflict:empty{display:none}
.pdf-conflict p{flex:1 1 100%;margin:0}
`;
function renderOption(question, option) {
    const isDefault = Array.isArray(question.default) ? question.default.includes(option.value) : question.default === option.value;
    const multi = question.kind === 'multi';
    return `<label class="pdf-opt"${multi ? ' data-multi' : ''}>`
        + `<input type="${multi ? 'checkbox' : 'radio'}" name="${(0, helper_format_1.escapeHtml)(question.id)}" value="${(0, helper_format_1.escapeHtml)(option.value)}"${isDefault ? ' checked' : ''}>`
        + (option.image ? `<img src="${(0, helper_format_1.escapeHtml)(option.image)}" alt="${(0, helper_format_1.escapeHtml)(option.label)}" loading="lazy">` : '')
        + `<span class="pdf-opt-label">${(0, helper_format_1.escapeHtml)(option.label)}${isDefault ? ' <span class="pdf-default">default</span>' : ''}</span>`
        + (option.help ? `<span class="pdf-opt-help">${(0, helper_format_1.escapeHtml)(option.help)}</span>` : '')
        + '</label>';
}
function renderControls(question) {
    if (question.kind === 'choice' || question.kind === 'multi') {
        const images = question.options.some(option => option.image);
        return `<div class="pdf-opts${images ? ' pdf-images' : ''}">${question.options.map(option => renderOption(question, option)).join('')}</div>`;
    }
    if (question.kind === 'bool') {
        const options = [
            { value: 'true', label: question.yes, image: null, help: null },
            { value: 'false', label: question.no, image: null, help: null },
        ];
        const asChoice = { ...question, kind: 'choice', default: question.default == null ? null : String(question.default) };
        return `<div class="pdf-opts">${options.map(option => renderOption(asChoice, option)).join('')}</div>`;
    }
    const value = typeof question.default === 'string' ? question.default : '';
    const placeholder = question.placeholder ? ` placeholder="${(0, helper_format_1.escapeHtml)(question.placeholder)}"` : '';
    const name = (0, helper_format_1.escapeHtml)(question.id);
    return question.kind === 'text'
        ? `<input class="pdf-text" type="text" name="${name}" maxlength="${MAX_SHORT_TEXT}" value="${(0, helper_format_1.escapeHtml)(value)}"${placeholder}>`
        : `<textarea class="pdf-text" name="${name}" maxlength="${MAX_TEXT}"${placeholder}>${(0, helper_format_1.escapeHtml)(value)}</textarea>`;
}
function renderQuestion(question) {
    const defaultText = question.default == null ? '' : formatValue(question, question.default);
    return `<fieldset class="pdf-q" data-q="${(0, helper_format_1.escapeHtml)(question.id)}" data-kind="${question.kind}" disabled>`
        + `<legend><span class="pdf-id">${(0, helper_format_1.escapeHtml)(question.id)}</span> ${(0, helper_format_1.escapeHtml)(question.label)}`
        + (question.required ? ' <span class="pdf-req">required</span>' : '')
        + `<span class="pdf-flag">changed${defaultText ? ` (default ${(0, helper_format_1.escapeHtml)(defaultText)})` : ''}</span></legend>`
        + (question.help ? `<p class="pdf-help">${(0, helper_format_1.escapeHtml)(question.help)}</p>` : '')
        + renderControls(question)
        + '</fieldset>';
}
/**
 * The artifact's copy: disabled controls showing the defaults, no submit and
 * no data beyond the page's own source. `answerHref` links the owner to
 * pi-dish's form view where the serving front has one.
 */
function renderForm(spec, answerHref) {
    const sections = spec.sections.map(section => section.kind === 'question'
        ? `<div class="pdf-section">${renderQuestion(section.question)}</div>`
        : `<section class="pdf-section" data-grid="${(0, helper_format_1.escapeHtml)(section.id)}"><h3>${(0, helper_format_1.escapeHtml)(section.label)}</h3>`
            + (section.help ? `<p class="pdf-help">${(0, helper_format_1.escapeHtml)(section.help)}</p>` : '')
            + section.questions.map(renderQuestion).join('')
            + '</section>').join('');
    const notice = answerHref
        ? `Read-only preview. <a class="pdf-answer" href="${(0, helper_format_1.escapeHtml)(answerHref)}" data-pi-dish-answer>Answer in pi-dish</a>`
        : 'Read-only preview. The page owner answers this form in pi-dish.';
    return '<div class="pdf" data-pi-dish-form>'
        + `<style>${exports.FORM_STYLE}</style>`
        + (spec.title || spec.intro
            ? `<header class="pdf-head">${spec.title ? `<h2>${(0, helper_format_1.escapeHtml)(spec.title)}</h2>` : ''}${spec.intro ? `<p>${(0, helper_format_1.escapeHtml)(spec.intro)}</p>` : ''}</header>`
            : '')
        + `<p class="pdf-notice">${notice}</p>`
        + sections
        + '</div>';
}
function renderErrors(errors) {
    return `<div class="pdf-error" data-pi-dish-form-error><strong>This page's pi-dish form is invalid:</strong><ul>`
        + errors.map(error => `<li>${(0, helper_format_1.escapeHtml)(error)}</li>`).join('') + '</ul></div>';
}
/** Replaces the declaration block with the rendered form, or with its errors. */
function renderPageForm(html, parsed, answerHref) {
    const block = parsed.block;
    const rendered = 'spec' in parsed ? renderForm(parsed.spec, answerHref) : renderErrors(parsed.errors);
    if (!block)
        return rendered + html;
    return html.slice(0, block.start) + rendered + html.slice(block.end);
}
