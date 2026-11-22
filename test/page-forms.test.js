// Generated test/tool from test/page-forms.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Forms in published pages: the authoring format and its publish-time
 * errors, answer validation, the delivered message (escaped and capped), the
 * receipt store, and the authorization boundary. The sandboxed page carries no
 * authority and only links to pi-dish's own form view; the form API answers
 * same-origin owner requests on the main app (or a hub's main app relaying to
 * the page's host), never the public share listener, never a cross-site or
 * sandboxed caller, and never for a locked private session.
 *
 * Two real servers boot as children: an owner host with a fake live pi bridge
 * session and a public share listener, and a hub that lists it as a remote.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const node_child_process_1 = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const test_types_js_1 = require("./test-types.js");
const test_env_js_1 = require("./test-env.js");
const forms = require('../lib/page-forms');
const SERVER = path.join(__dirname, '..', 'server.js');
const SESSION_ID = '2026-11-22T09-00-00-formfix1';
const IDLE_ID = '2026-11-22T08-00-00-formidle';
const PRIVATE_ID = '2026-11-22T07-00-00-formpriv';
const GALLERY_SPEC = {
    title: 'Gallery picks',
    intro: 'Pick one image per row.',
    fields: [
        { id: 'row4', type: 'grid', label: 'Row 4', rows: [
                { id: '4.1', label: 'Hero', default: 'A', options: [{ value: 'A', image: 'img/4.1-a.jpg' }, { value: 'B', image: 'img/4.1-b.jpg' }] },
                { id: '4.2', label: 'Kitchen', default: 'A', options: [{ value: 'A', image: 'img/4.2-a.jpg' }, { value: 'B', image: 'img/4.2-b.jpg' }] },
            ] },
        { id: '12.2', type: 'choice', label: 'Garden', default: 'C', options: ['A', 'B', 'C'] },
        { id: 'rule6', type: 'approve', label: 'Rule 6 still holds', yes: 'ok', no: 'not ok', default: true },
        { id: 'names', type: 'yesno', label: 'Names ok?' },
        { id: 'tags', type: 'multi', options: ['warm', 'cool', 'mono'], default: ['warm'] },
        { id: 'notes', type: 'longtext', label: 'Notes' },
    ],
};
function formPage(spec) {
    return `<!doctype html><html><body><h1>Picks</h1>\n<script type="application/pi-dish-form">\n${JSON.stringify(spec, null, 2)}\n</script>\n<p>after</p></body></html>`;
}
function parsedSpec(spec) {
    const parsed = forms.parsePageForm(formPage(spec));
    assert.ok(parsed && 'spec' in parsed, JSON.stringify(parsed));
    return parsed.spec;
}
test('a gallery form parses into one question per field or grid row, with defaults', () => {
    const spec = parsedSpec(GALLERY_SPEC);
    assert.deepEqual(spec.questions.map(question => [question.id, question.kind, question.default]), [
        ['4.1', 'choice', 'A'], ['4.2', 'choice', 'A'], ['12.2', 'choice', 'C'],
        ['rule6', 'bool', true], ['names', 'bool', null], ['tags', 'multi', ['warm']], ['notes', 'longtext', null],
    ]);
    assert.equal(spec.questions[0].options[1].image, 'img/4.1-b.jpg');
    assert.equal(forms.parsePageForm('<p>no form here</p>'), null);
});
test('publish-time validation reports every mistake with where it is', () => {
    const result = forms.parseFormSpec(JSON.stringify({ fields: [
            { id: '4.2', type: 'choice', options: ['A', 'B'], predicted: 'A' },
            { id: '4.2', type: 'radio' },
            { id: 'bad id', type: 'choice', options: ['A', 'A'], default: 'Z' },
            { id: 'img', type: 'choice', options: [{ value: 'A', image: 'javascript:alert(1)' }] },
            { id: 'grid', type: 'grid', rows: [{ id: 'g1' }] },
        ] }));
    assert.ok('errors' in result);
    assert.deepEqual(result.errors, [
        'fields[0] ("4.2") has unknown key "predicted" (allowed: id, type, label, help, required, default, options)',
        'fields[1] ("4.2").type must be one of choice, grid, multi, yesno, approve, text, longtext',
        'fields[2] ("bad id").id must be 1-64 characters of letters, digits, ".", "_", ":" or "-", starting with a letter or digit',
        'fields[2] ("bad id").options[1].value "A" is repeated',
        'fields[2] ("bad id").default must be one of the option values (A)',
        'fields[3] ("img").options[0].image must be a relative, http(s) or data:image URL',
        'fields[4] ("grid").rows[0] ("g1") needs "options" (or give the grid shared "options")',
    ]);
    const json = forms.parseFormSpec('{"fields": [');
    assert.ok('errors' in json && /not valid JSON/.test(json.errors[0]));
    const twice = forms.parsePageForm(formPage(GALLERY_SPEC) + formPage(GALLERY_SPEC));
    assert.ok(twice && 'errors' in twice);
    assert.deepEqual(twice.errors, ['a page may contain only one pi-dish-form block (found 2)']);
});
test('answers are checked against the spec: options, types, required and unknown ids', () => {
    const spec = parsedSpec({ fields: [
            { id: 'pick', type: 'choice', options: ['A', 'B'], required: true },
            { id: 'ok', type: 'yesno' },
            { id: 'many', type: 'multi', options: ['x', 'y'] },
            { id: 'name', type: 'text' },
        ] });
    const bad = forms.validateAnswers(spec, { pick: 'Z', ok: 'yes', many: ['x', 'q'], name: 3, extra: 1 });
    assert.ok('errors' in bad);
    assert.deepEqual(bad.errors, [
        'unknown field "extra"', '"pick" must be one of A, B', '"pick" is required',
        '"ok" must be true or false', '"many" must be a list of x, y', '"name" must be text of at most 1000 characters',
    ]);
    const good = forms.validateAnswers(spec, { pick: 'B', ok: false, many: ['y', 'x'], name: '' });
    assert.deepEqual(good, { answers: { pick: 'B', ok: false, many: ['x', 'y'], name: null } });
});
test('the delivered message lists changed fields first, then answers without defaults', () => {
    const spec = parsedSpec(GALLERY_SPEC);
    const answers = { '4.1': 'A', '4.2': 'B', '12.2': 'A', rule6: true, names: true, tags: ['warm'], notes: 'Warmer crop on row 3.\nKeep the rest.' };
    const checked = forms.validateAnswers(spec, answers);
    assert.ok('answers' in checked);
    const at = Date.UTC(2026, 10, 22, 14, 3, 5);
    assert.equal(forms.formatFormMessage({
        spec, answers: checked.answers, token: 'tok123', submissionId: 'sub-1', pageTitle: 'OSBG gallery', submittedAt: at, revision: 1, previousAt: null, ompRecipient: false,
    }), [
        '[form response: OSBG gallery (tok123), submitted 2026-11-22T14:03:05Z]',
        '4.2: B (default A)',
        '12.2: A (default C)',
        'all other fields: default',
        'names: yes',
        'notes: |',
        '  Warmer crop on row 3.',
        '  Keep the rest.',
        'full answer set: pi-dish-pages answers tok123 --submission sub-1',
    ].join('\n'));
    const untouched = forms.validateAnswers(spec, { '4.1': 'A', '4.2': 'A', '12.2': 'C', rule6: false, tags: ['warm'] });
    assert.ok('answers' in untouched);
    assert.equal(forms.formatFormMessage({
        spec, answers: untouched.answers, token: 'tok123', submissionId: 'sub-2', pageTitle: null, submittedAt: at + 60_000, revision: 2, previousAt: at, ompRecipient: false,
    }), [
        '[form response revision 2: Gallery picks (tok123), submitted 2026-11-22T14:04:05Z; replaces the response of 2026-11-22T14:03:05Z]',
        'rule6: not ok (default ok)',
        'all other fields: default',
        'unanswered: names, notes',
        'full answer set: pi-dish-pages answers tok123 --submission sub-2',
    ].join('\n'));
});
test('terminal and bidi controls in answers reach the agent as visible escapes, within caps', () => {
    const spec = parsedSpec({ fields: [
            { id: 'name', type: 'text' }, { id: 'notes', type: 'longtext' }, { id: 'long', type: 'longtext' },
        ] });
    const checked = forms.validateAnswers(spec, {
        name: '\u001b[31mred\u001b[0m\u0007\u202eevil\u0085\u061c', notes: 'one\r\ntwo\rthree\u0000', long: 'x'.repeat(3000),
    });
    assert.ok('answers' in checked);
    const message = forms.formatFormMessage({
        spec, answers: checked.answers, token: 't', submissionId: 's', pageTitle: 'T\u001b]0;pwned\u0007', submittedAt: 0, revision: 1, previousAt: null, ompRecipient: true,
    });
    assert.doesNotMatch(message, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u202e]/, 'no raw control character survives');
    assert.match(message, /^\[form response: T\\x1b\]0;pwned\\x07 \(t\)/);
    assert.match(message, /\nname: \\x1b\[31mred\\x1b\[0m\\x07\\u202eevil\\x85\\u061c\n/);
    assert.match(message, /\nnotes: \|\n {2}one\n {2}two\n {2}three\\x00\n/);
    assert.match(message, /\nlong: x{2000}… \(1000 more characters in the full answer set\)\n/);
    // The raw answers are kept as given, for the owner-only store.
    assert.equal(checked.answers.name, '\u001b[31mred\u001b[0m\u0007\u202eevil\u0085\u061c');
});
// What OMP 18.22 acts on wherever it appears in a prompt (extensions/pi-dish-bridge/core.ts
// MODEL_MENTION_SELECTOR; OMP's file-mentions, turn-budget and magic-keywords modules).
const OMP_MODEL_MENTION = /(?:^|\s)\^([^\s^]+)(?=\s|$)/;
const OMP_FILE_MENTION = /(?:^|[\s([{<"'`])@(?:"[^"]+"|'[^']+'|[^\s@]+)/;
const OMP_TURN_BUDGET = /(?:^|\s)\+(\d+(?:\.\d+)?)([km])?(!)?(?=\s|$)/i;
const OMP_MAGIC_KEYWORD = /(?<![\p{L}\p{N}_./\\-])(?<!::)(?:ultrathink|chillax|orchestrate|workflowz|jevify)(?![\p{L}\p{N}_/\\-])(?!\.[\p{L}\p{N}_-])(?!\()/u;
test('answers reach an OMP agent as literal text: no model mention, file mention, turn budget, keyword, command or shell escape', () => {
    const spec = parsedSpec({ title: '^title', fields: [
            { id: 'pattern', type: 'text' }, { id: 'command', type: 'text' }, { id: 'shell', type: 'text' },
            { id: 'notes', type: 'longtext' }, { id: 'pick', type: 'choice', options: ['^a', 'b'] },
            { id: 'file', type: 'text' }, { id: 'budget', type: 'text' }, { id: 'word', type: 'text' }, { id: 'ultrathink', type: 'yesno' },
        ] });
    const checked = forms.validateAnswers(spec, {
        pattern: '^foo$', command: '/compact now', shell: '!rm -rf ~', notes: '^bar\n/model x\n!ls\n@notes.md', pick: '^a',
        file: 'see @secrets.txt and (@"a b")', budget: '+500k then +2', word: 'ultrathink, chillax.', ultrathink: true,
    });
    assert.ok('answers' in checked);
    const message = forms.formatFormMessage({
        spec, answers: checked.answers, token: 't', submissionId: 'sub-literal', pageTitle: null, submittedAt: 0, revision: 1, previousAt: null, ompRecipient: true,
    });
    for (const syntax of [OMP_MODEL_MENTION, OMP_FILE_MENTION, OMP_TURN_BUDGET, OMP_MAGIC_KEYWORD])
        assert.doesNotMatch(message, syntax, message);
    assert.ok(message.startsWith('[form response: \\^title (t)'), 'the prompt never starts with "/" or "!"');
    assert.deepEqual(message.split('\n').slice(1, -1), [
        'pattern: \\^foo$', 'command: /compact now', 'shell: !rm -rf ~', 'notes: |', '  \\^bar', '  /model x', '  !ls', '  \\@notes.md', 'pick: \\^a',
        'file: see \\@secrets.txt and (\\@"a b")', 'budget: \\+500k then \\+2', 'word: \\ultrathink, \\chillax.', '\\ultrathink: yes',
    ]);
    assert.equal(checked.answers.pattern, '^foo$', 'the stored answer keeps the raw text');
    // A pi or ACP recipient acts on none of that syntax: it gets the answers as written.
    const plain = forms.formatFormMessage({
        spec, answers: checked.answers, token: 't', submissionId: 'sub-literal', pageTitle: null, submittedAt: 0, revision: 1, previousAt: null, ompRecipient: false,
    });
    assert.ok(plain.startsWith('[form response: ^title (t)'));
    assert.deepEqual(plain.split('\n').slice(1, 3), ['pattern: ^foo$', 'command: /compact now']);
    assert.match(plain, /\nfile: see @secrets\.txt and \(@"a b"\)\nbudget: \+500k then \+2\nword: ultrathink, chillax\.\nultrathink: yes\n/);
});
test('only a real <script type="application/pi-dish-form"> outside comments declares a form', () => {
    const block = `<script type="application/pi-dish-form">${JSON.stringify({ fields: [{ id: 'ok', type: 'yesno' }] })}</script>`;
    assert.equal(forms.parsePageForm(`<!-- ${block} -->`), null, 'commented out');
    assert.equal(forms.parsePageForm(`<!-- unterminated ${block}`), null, 'inside an unterminated comment');
    assert.equal(forms.parsePageForm(block.replace('<script type=', '<script data-type=')), null, 'a data-type attribute');
    assert.equal(forms.parsePageForm(block.replace('<script type=', '<script data-x="a" title="type=application/pi-dish-form" type="text/plain" x=')), null);
    assert.equal(forms.parsePageForm(block.replace('<script type=', '<script title="a type=application/pi-dish-form" x=')), null, 'a quoted value that holds " type=" is not the type attribute');
    const quoted = forms.parsePageForm(`<p title="<script type=application/pi-dish-form>">x</p>${block.replace('<script type=', '<SCRIPT title="1 > 0" TYPE=')}`);
    assert.ok(quoted && 'spec' in quoted, 'a ">" in a quoted value, and upper-case names, still read as one tag');
    const real = forms.parsePageForm(`<!-- ${block} --><p>a <!-- b --> c</p>${block}`);
    assert.ok(real && 'spec' in real, 'the live block after a commented one is the form');
    assert.equal(forms.parsePageForm(`<template>${block}</template>`), null, 'template content is inert');
    const labelled = `<script type="application/pi-dish-form">${JSON.stringify({ fields: [{ id: 'ok', type: 'yesno', label: 'see </script-example> here' }] })}</script>`;
    const ended = forms.parsePageForm(labelled);
    assert.ok(ended && 'spec' in ended, '"</script-example>" does not end the script');
    assert.equal(ended.spec.questions[0].label, 'see </script-example> here');
    assert.equal(forms.parsePageForm(`<template><template></template>${block}</template>`), null, 'a nested template is counted');
    assert.equal(forms.parsePageForm(`<template><!-- </template> -->${block}</template>`), null, 'an end tag inside a comment does not end it');
    const after = forms.parsePageForm(`<template><template></template></template>${block}`);
    assert.ok(after && 'spec' in after, 'the form after the outer template still counts');
    const rcdata = forms.parsePageForm(`<template><textarea>a literal <template> tag</textarea><script>"<template>"</script></template>${block}`);
    assert.ok(rcdata && 'spec' in rcdata, 'a <template> inside a template\'s textarea or script is text, not nesting');
    const quotedInside = forms.parsePageForm(`<template><div title="<style>"></div><p data-x='<template>'></p></template>${block}`);
    assert.ok(quotedInside && 'spec' in quotedInside, 'markup inside a quoted value within a template is text');
    // U+00A0 is whitespace to a regex `\s`, not to HTML: `</script` followed by it does not end the script.
    const spaced = forms.parsePageForm(`<script type="application/pi-dish-form">${JSON.stringify({ fields: [{ id: 'ok', type: 'yesno', label: 'a </script\u00a0b> c' }] })}</script>`);
    assert.ok(spaced && 'spec' in spaced, 'only HTML whitespace delimits the end tag');
});
test('the message fits its UTF-8 byte budget, and a shared grid travels once, for a non-ASCII grid', () => {
    const value = (row) => `選択肢🙂${row}-${'é'.repeat(150)}`;
    const rows = Array.from({ length: 300 }, (_, row) => ({ id: `r${row}`, label: `行 ${row} 🖼️`, default: 'A',
        options: [{ value: 'A', label: 'エー' }, { value: value(row), label: 'ビー' }] }));
    const perRow = parsedSpec({ fields: [{ id: 'grid', type: 'grid', label: 'ギャラリー', rows }] });
    const answers = forms.validateAnswers(perRow, Object.fromEntries(rows.map((row, index) => [row.id, value(index)])));
    assert.ok('answers' in answers);
    const message = forms.formatFormMessage({
        spec: perRow, answers: answers.answers, token: 't', submissionId: 'sub-utf8', pageTitle: 'ページ', submittedAt: 0, revision: 1, previousAt: null, ompRecipient: true,
    });
    assert.ok(Buffer.byteLength(message) <= 32 * 1024, `message is ${Buffer.byteLength(message)} bytes`);
    assert.match(message, /\n… \(\d+ more lines in the full answer set\)\nfull answer set: pi-dish-pages answers t --submission sub-utf8$/);
    const image = `data:image/svg+xml,${'%3Csvg%3E'.repeat(200)}`;
    const shared = parsedSpec({ fields: [{ id: 'grid', type: 'grid', label: 'ギャラリー', options: [{ value: 'A', image }, { value: 'B', image }],
                rows: Array.from({ length: 300 }, (_, row) => ({ id: `s${row}`, label: `行 ${row}`, default: 'A' })) }] });
    const wire = JSON.stringify(forms.clientSpec(shared));
    assert.equal(wire.split(image).length - 1, 2, 'shared options are sent once, on the grid');
    const tooBig = forms.parseFormSpec(JSON.stringify({ fields: [{ id: 'g', type: 'grid', rows: Array.from({ length: 300 }, (_, row) => ({
                    id: `b${row}`, options: [{ value: 'A', image: `data:image/png;base64,${'Q'.repeat(1900)}` }]
                })) }] }));
    assert.ok('errors' in tooBig);
    assert.match(tooBig.errors[0], /KiB as sent to pi-dish's form view \(limit 512 KiB\)/);
});
test('the artifact gets a read-only preview with no authority; only an answer link where the front serves /forms', () => {
    const html = formPage(GALLERY_SPEC);
    const parsed = forms.parsePageForm(html);
    assert.ok(parsed);
    const linked = forms.renderPageForm(html, parsed, '/forms/tok123');
    const plain = forms.renderPageForm(html, parsed, null);
    for (const rendered of [linked, plain]) {
        assert.doesNotMatch(rendered, /application\/pi-dish-form"|<form|type="submit"|fingerprint|data-form-key/);
        assert.match(rendered, /<h1>Picks<\/h1>\n<div class="pdf" data-pi-dish-form>/);
        assert.match(rendered, /<\/div>\n<p>after<\/p>/);
        assert.equal(rendered.match(/<fieldset class="pdf-q"[^>]* disabled>/g)?.length, 7);
        assert.match(rendered, /<input type="radio" name="4\.2" value="A" checked><img src="img\/4\.2-a\.jpg"/);
    }
    assert.match(linked, /<a class="pdf-answer" href="\/forms\/tok123" data-pi-dish-answer>Answer in pi-dish<\/a>/);
    assert.doesNotMatch(plain, /\/forms\//);
    const hostile = forms.parsePageForm(formPage({ title: '</script><img src=x onerror=alert(1)>', fields: [{ id: 'a', type: 'text', label: '<b>x</b>' }] }));
    assert.ok(hostile);
    assert.doesNotMatch(forms.renderPageForm('', hostile, null), /<img src=x|<b>x<\/b>/);
});
test('the answer store is owner-only, keeps durable receipts and the current answers, and revocation wins', () => {
    const previous = process.env.HOME;
    const home = (0, test_env_js_1.createTestTempDir)('pi-dish-forms-store-');
    process.env.HOME = home;
    try {
        const submission = (id, revision) => ({
            id, state: 'delivering', revision, acceptedAt: revision, finishedAt: null, error: null,
            sessionId: 's', fingerprint: 'f', answers: { a: id }, changed: [],
        });
        forms.acceptSubmission('tok', submission('sub-00001', 1));
        const file = path.join(home, '.pi', 'dish', 'page-forms.json');
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        assert.deepEqual(forms.readSubmissions('tok').submissions[0].answers, { a: 'sub-00001' }, 'the answers are stored before any outcome');
        assert.equal(forms.finishSubmission('tok', 'sub-00001', { state: 'delivered', error: null, finishedAt: 2 }), true);
        // Forty more attempts, none delivered: the history rolls over, the receipts and the current answers do not.
        for (let index = 0; index < 40; index++) {
            forms.acceptSubmission('tok', submission(`sub-x${String(index).padStart(4, '0')}`, 2));
            forms.finishSubmission('tok', `sub-x${String(index).padStart(4, '0')}`, { state: 'uncertain', error: 'cut off', finishedAt: 3 });
        }
        const stored = forms.readSubmissions('tok');
        assert.equal(stored.submissions.some(item => item.id === 'sub-00001'), false, 'the history is bounded');
        assert.equal(stored.receipts.length, 41, 'every accepted id keeps its receipt');
        assert.equal(stored.receipts.find(item => item.id === 'sub-x0000')?.state, 'uncertain');
        assert.equal(stored.revision, 1);
        assert.deepEqual(stored.current?.answers, { a: 'sub-00001' }, 'the delivered answers outlive the history');
        forms.deleteSubmissions('tok');
        assert.equal(forms.finishSubmission('tok', 'sub-x0039', { state: 'delivered', error: null, finishedAt: 4 }), false);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {}, 'a revoked page is not recreated');
    }
    finally {
        process.env.HOME = previous;
    }
});
test('sizes are budgeted as served: resolved image URLs and serialized answers', () => {
    // Under the wire limit as written, over it once every relative image resolves under the page route.
    const rows = Array.from({ length: 300 }, (_, row) => ({
        id: `r${row}`, options: Array.from({ length: 25 }, (_, option) => ({ value: String.fromCharCode(97 + option), image: 'i.png' })),
    }));
    const source = JSON.stringify({ fields: [{ id: 'g', type: 'grid', rows }] });
    assert.ok(Buffer.byteLength(source) < 256 * 1024, 'the block itself is within its limit');
    const resolved = forms.parseFormSpec(source);
    assert.ok('errors' in resolved);
    assert.match(resolved.errors[0], /as sent to pi-dish's form view \(limit 512 KiB\)/);
    // Control characters are short to count and long to serialize.
    const spec = parsedSpec({ fields: Array.from({ length: 5 }, (_, index) => ({ id: `t${index}`, type: 'longtext' })) });
    const escaped = '\u0001'.repeat(10000);
    const checked = forms.validateAnswers(spec, Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`t${index}`, escaped])));
    assert.ok('errors' in checked, '50,000 characters that serialize to ~300 KiB are refused');
    assert.match(checked.errors[0], /KiB as stored \(limit 256 KiB\)/);
});
test('relayed asset paths are re-encoded or refused, and every spelling of the form route is recognized', () => {
    const relay = require('../lib/relay-handlers');
    assert.equal(relay.encodedAssetPath('/img/a b#c?.png'), '/img/a%20b%23c%3F.png');
    assert.equal(relay.encodedAssetPath('/'), '/');
    assert.equal(relay.encodedAssetPath('/dir/'), '/dir/');
    // Names the owner itself serves: redundant separators collapse; literal `\` and `%` stay encoded.
    assert.equal(relay.encodedAssetPath('/img//plain.txt'), '/img/plain.txt');
    assert.equal(relay.encodedAssetPath('//'), '/');
    assert.equal(relay.encodedAssetPath('/back\\slash.txt'), '/back%5Cslash.txt');
    assert.equal(relay.encodedAssetPath('/100% done.txt'), '/100%25%20done.txt');
    assert.equal(relay.encodedAssetPath('/a%41.txt'), '/a%2541.txt');
    for (const hostile of ['/../../api/sessions', '/a/../b', '/./a', '/a\\..\\b', '/..\\api', '/%2e%2e/api', '/a%2fb', '/a%5c..%5cb',
        '/a%252fb', '/%252e%252e', '/a\u0000b', '/a%00b']) {
        assert.equal(relay.encodedAssetPath(hostile), null, hostile);
    }
    for (const spelling of ['/page-forms/t', '/PAGE-FORMS/t', '/Page-Forms', '/page%2Dforms/t', '/page%252Dforms/t',
        '//page-forms/t', '/x/..%2fpage-forms/t', '\\page-forms\\t', '/%E0%A4%A']) {
        assert.equal(relay.namesPageForms(spelling), true, spelling);
    }
    assert.equal(relay.namesPageForms('/sessions/page-formsx'), false);
});
test('PI_DISH_PUBLIC_ORIGINS keeps only bare http(s) origins and says why it drops the rest', () => {
    const access = require('../lib/access-handlers');
    const warnings = [];
    const origins = access.parsePublicOrigins(' https://pi.example.com, http://lan:8080/ , https://pi.example.com/app, '
        + 'https://user:pw@pi.example.com, ftp://pi.example.com, not a url, https://x.example?y=1', message => warnings.push(message));
    assert.deepEqual([...origins], ['https://pi.example.com', 'http://lan:8080']);
    assert.equal(warnings.length, 5);
    assert.match(warnings.join('\n'), /no path, query or fragment[\s\S]*no credentials[\s\S]*only http and https[\s\S]*not a URL/);
});
// ---- servers ---------------------------------------------------------------
const children = [];
const prompts = [];
let bridge = null;
// The fake bridge's connections: a test reports a running turn through them.
const bridgeSockets = [];
const bridgeEvent = (event) => { for (const socket of bridgeSockets)
    socket.write(JSON.stringify({ type: 'event', event, data: {} }) + '\n'); };
const helpers = [];
test.after(() => {
    for (const child of children) {
        try {
            child.kill('SIGKILL');
        }
        catch { }
    }
    bridge?.close();
    for (const server of helpers)
        server.close();
});
function listen(server) {
    helpers.push(server);
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('helper lacks TCP address'));
            resolve(`http://127.0.0.1:${address.port}`);
        });
    });
}
// The test program's lib is ES2022: no Promise.withResolvers.
function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            if (!address || typeof address === 'string')
                return reject(new Error('Port probe lacks TCP address'));
            probe.close(error => error ? reject(error) : resolve(address.port));
        });
    });
}
// Polls real child processes and background delivery; there is no event to await across processes.
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function boot(home, share, extra = {}) {
    const port = await freePort();
    const sharePort = share ? await freePort() : null;
    const env = { ...(0, test_env_js_1.sanitizeTestEnv)(), HOME: home, HOST: '127.0.0.1', PORT: String(port), TMUX_TMPDIR: path.join(home, 'tmux'), ...extra };
    if (sharePort)
        Object.assign(env, { PI_DISH_SHARE_PORT: String(sharePort), PI_DISH_SHARE_HOST: '127.0.0.1' });
    fs.mkdirSync(path.join(home, 'tmux'), { recursive: true });
    const child = (0, node_child_process_1.spawn)(process.execPath, [SERVER], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    children.push(child);
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    const base = `http://127.0.0.1:${port}`;
    const shareBase = sharePort ? `http://127.0.0.1:${sharePort}` : null;
    const deadline = Date.now() + 30_000;
    for (;;) {
        if (child.exitCode !== null)
            throw new Error(`server exited (${child.exitCode}): ${stderr}`);
        try {
            const ready = await fetch(`${base}/api/host`);
            const shareReady = shareBase ? await fetch(`${shareBase}/page/none`) : null;
            if (ready.ok && (!shareReady || shareReady.status === 404))
                break;
        }
        catch { }
        if (Date.now() > deadline)
            throw new Error(`server did not come up: ${stderr}`);
        await pause(100);
    }
    return { base, shareBase };
}
async function json(response) {
    const text = await response.text();
    try {
        return (0, test_types_js_1.record)(JSON.parse(text));
    }
    catch {
        throw new Error(`not JSON (${response.status}): ${text.slice(0, 200)}`);
    }
}
// Every form API caller names itself (FORM_CLIENT_HEADER); these tests call as the CLI does.
const CLI = { 'X-Pi-Dish-Form-Client': 'cli' };
const formFetch = (url, init = {}) => fetch(url, { ...init, headers: { ...CLI, ...init.headers } });
const post = (url, body, headers = {}) => formFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
let owner;
let hub;
let home = '';
let token = '';
// What the agent could read of its submission at the moment each prompt arrived.
const readAtPrompt = [];
const PUBLIC_ORIGIN = 'https://pi.example.test';
// Runs after the agent's read and before it takes the prompt (one test makes the store unwritable there).
let beforeAnswer = null;
// Every path the owner received through the hub, after a normalizing proxy resolved it.
const ownerSaw = [];
// Page tokens whose form calls the proxy cuts off mid-body.
const FAULTY_TOKEN = 'FaultyFormToken0000001';
// A pre-feature peer: no form protocol, one page.
const OLD_PEER_TOKEN = 'OldPeerFormToken000001';
// While set, the fake bridge refuses prompts with this error, as OMP's bridge refuses an unknown model mention.
let refusePrompts = null;
// What the fake bridge answers an admitted `prompt` with (a bridge that offers followUpIfBusy).
const ADMITTED = { queued: false, admitted: true };
let promptAnswer = ADMITTED;
function writeSession(dir, id, cwd) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(file, [
        { type: 'session', cwd, timestamp: '2026-11-22T09:00:00.000Z' },
        { type: 'message', message: { role: 'user', content: 'publish the gallery' } },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    return file;
}
async function formState(base, pageToken) {
    return json(await formFetch(`${base}/api/page-forms/${pageToken}`));
}
// Submits as pi-dish's own form view would, then waits for the receipt to settle.
async function submitted(base, pageToken, submissionId, answers) {
    const state = await formState(base, pageToken);
    const response = await post(`${base}/api/page-forms/${pageToken}`, {
        submissionId, fingerprint: state.fingerprint, expectedRevision: state.revision, answers,
    });
    const accepted = await json(response);
    assert.ok(response.status === 202 || response.status === 200, JSON.stringify(accepted));
    for (let i = 0; i < 100; i++) {
        const receipt = (0, test_types_js_1.record)((await formReceipt(base, pageToken, submissionId)).receipt);
        if (receipt.state !== 'delivering')
            return receipt;
        await pause(50);
    }
    throw new Error('the receipt did not settle');
}
async function formReceipt(base, pageToken, submissionId) {
    return json(await formFetch(`${base}/api/page-forms/${pageToken}/receipts/${submissionId}`));
}
test('boot an owner host with a live session and a hub that fronts it', async () => {
    home = (0, test_env_js_1.createTestTempDir)('pi-dish-forms-');
    const sessions = path.join(home, '.pi', 'agent', 'sessions', 'project');
    const sessionFile = writeSession(sessions, SESSION_ID, path.join(home, 'project'));
    writeSession(sessions, IDLE_ID, path.join(home, 'idle'));
    writeSession(path.join(home, '.local', 'state', 'pi-dish', 'private-sessions', 'pi'), PRIVATE_ID, path.join(home, 'hidden'));
    const socketPath = path.join(home, 'bridge.sock');
    bridge = net.createServer(socket => {
        socket.on('error', () => { });
        bridgeSockets.push(socket);
        socket.write(JSON.stringify({ type: 'hello', turnInProgress: false, queue: { steering: [], followUp: [] } }) + '\n');
        let buffer = '';
        socket.on('data', chunk => {
            buffer += chunk;
            for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
                const message = (0, test_types_js_1.record)(JSON.parse(buffer.slice(0, end)));
                buffer = buffer.slice(end + 1);
                const data = message.command === 'prompt' ? promptAnswer
                    : message.command === 'get_available_models' ? { models: [] } : message.command === 'get_commands' ? [] : {};
                const answer = () => socket.write(JSON.stringify({ type: 'response', id: message.id, success: true, data }) + '\n');
                if (message.command === 'prompt' && refusePrompts) {
                    socket.write(JSON.stringify({ type: 'response', id: message.id, success: false, error: refusePrompts }) + '\n');
                    continue;
                }
                if (message.command !== 'prompt') {
                    answer();
                    continue;
                }
                prompts.push(message);
                // Like an agent acting on the message at once: fetch the answer set it names before taking the prompt.
                const named = /full answer set: pi-dish-pages answers (\S+) --submission (\S+)$/.exec(String(message.message));
                if (!named) {
                    answer();
                    continue;
                }
                void formFetch(`${owner.base}/api/page-forms/${named[1]}?submission=${named[2]}`).then(async (response) => {
                    readAtPrompt.push({ status: response.status, ...(0, test_types_js_1.record)(await response.json()) });
                }).finally(() => { beforeAnswer?.(); answer(); });
            }
        });
    });
    await new Promise(resolve => bridge.listen(socketPath, resolve));
    const registry = path.join(home, '.pi', 'dish', 'sessions');
    fs.mkdirSync(registry, { recursive: true });
    fs.writeFileSync(path.join(registry, `${SESSION_ID}.json`), JSON.stringify({
        sessionId: SESSION_ID, sessionFile, socketPath, pid: process.pid, cwd: path.join(home, 'project'), name: 'Form fixture',
        capabilities: { followUpIfBusy: true },
    }));
    owner = await boot(home, true, { PI_DISH_PUBLIC_ORIGINS: `${PUBLIC_ORIGIN}, not a url` });
    // The hub reaches the owner through a proxy that normalizes paths (WHATWG
    // dot-segment resolution), as a reverse proxy or CDN in between may.
    const proxy = await listen(http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://owner.invalid');
        ownerSaw.push(url.pathname);
        if (url.pathname === `/page/${FAULTY_TOKEN}` && req.method === 'HEAD')
            return res.writeHead(200).end();
        if (url.pathname.startsWith(`/api/page-forms/${FAULTY_TOKEN}`)) {
            res.writeHead(200, { 'content-type': 'application/json', 'content-length': '400' });
            res.write('{"token":"');
            return setImmediate(() => res.socket?.destroy());
        }
        const upstream = http.request(`${owner.base}${url.pathname}${url.search}`, { method: req.method, headers: req.headers }, (answer) => {
            res.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(res);
        });
        upstream.on('error', () => { res.writeHead(502).end(); });
        req.pipe(upstream);
    }));
    const oldPeer = await listen(http.createServer((req, res) => {
        if (req.url === '/api/host') {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ hostId: '33333333-3333-4333-8333-333333333333', label: 'old', version: '1.0.0', capabilities: { pages: true } }));
        }
        if (req.url?.startsWith(`/page/${OLD_PEER_TOKEN}`))
            return res.writeHead(200, { 'content-type': 'text/html' }).end('<p>old</p>');
        res.writeHead(404).end();
    }));
    const hubHome = (0, test_env_js_1.createTestTempDir)('pi-dish-forms-hub-');
    fs.mkdirSync(path.join(hubHome, '.pi', 'dish'), { recursive: true });
    fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'settings.json'), JSON.stringify({
        remotes: [{ name: 'owner', url: proxy }, { name: 'oldpeer', url: oldPeer }],
    }));
    hub = await boot(hubHome, true);
});
test('publishing validates the form, needs a non-private session and returns the owner form path', async () => {
    const site = path.join(home, 'project', 'gallery');
    fs.mkdirSync(site, { recursive: true });
    const index = path.join(site, 'index.html');
    fs.writeFileSync(index, formPage({ fields: [{ id: '4.2', type: 'choice', options: ['A'], predicted: 'A' }] }));
    const rejected = await post(`${owner.base}/api/pages`, { path: site, sessionId: SESSION_ID });
    assert.equal(rejected.status, 400);
    assert.match(String((await json(rejected)).error), /^invalid pi-dish-form: fields\[0\] \("4\.2"\) has unknown key "predicted"/);
    assert.deepEqual(await (await fetch(`${owner.base}/api/pages`)).json(), [], 'an invalid form is not registered');
    const orphan = path.join(home, 'orphan.html');
    fs.writeFileSync(orphan, formPage(GALLERY_SPEC));
    const unowned = await post(`${owner.base}/api/pages`, { path: orphan });
    assert.equal(unowned.status, 400, 'a form page needs a session to deliver to');
    assert.match(String((await json(unowned)).error), /needs the session that publishes it/);
    const hidden = path.join(home, 'hidden.html');
    fs.writeFileSync(hidden, formPage(GALLERY_SPEC));
    const privatePublish = await post(`${owner.base}/api/pages`, { path: hidden, sessionId: PRIVATE_ID });
    assert.equal(privatePublish.status, 400);
    assert.match(String((await json(privatePublish)).error), /private session cannot publish a pi-dish-form/);
    fs.writeFileSync(index, formPage(GALLERY_SPEC));
    const published = await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: SESSION_ID }));
    assert.equal(published.sessionId, SESSION_ID);
    token = String(published.token);
    assert.deepEqual(published.form, { questions: 7, answerPath: `/forms/${token}` });
});
test('no page HTML carries authority: the owner page links to /forms, the public copy does not', async () => {
    const ownerView = await (await fetch(`${owner.base}/page/${token}/`)).text();
    assert.ok(owner.shareBase);
    const publicView = await (await fetch(`${owner.shareBase}/page/${token}/`)).text();
    for (const html of [ownerView, publicView]) {
        assert.doesNotMatch(html, /data-form-key|fingerprint|submissionId|page-forms|type="submit"/);
        assert.equal(html.match(/<fieldset class="pdf-q"[^>]* disabled>/g)?.length, 7, 'controls are disabled');
    }
    assert.match(ownerView, new RegExp(`<a class="pdf-answer" href="/forms/${token}"`));
    assert.match(ownerView, new RegExp(`<script src="/artifact-comments\\.js\\?v=[0-9a-f]{16}" data-page-token="${token}"></script>`));
    assert.doesNotMatch(publicView, /\/forms\/|artifact-comments/);
    const view = await fetch(`${owner.base}/forms/${token}`);
    assert.equal(view.status, 200);
    assert.match(String(view.headers.get('content-security-policy')), /frame-ancestors 'none'/);
    assert.equal(view.headers.get('x-frame-options'), 'DENY');
    assert.match(String(view.headers.get('cache-control')), /no-store/);
    const shell = await view.text();
    assert.match(shell, new RegExp(`<main id="pdfApp" data-token="${token}">`));
    assert.match(shell, /<script src="\/forms\.js\?v=[0-9a-f]{16}" defer><\/script>/);
    assert.match(shell, /<link rel="stylesheet" href="\/forms\.css\?v=[0-9a-f]{16}">/);
    assert.equal((await fetch(`${owner.shareBase}/forms/${token}`)).status, 404, 'the public listener has no form view');
});
test('cross-origin, opaque, non-JSON and public-listener requests are refused and send nothing', async () => {
    const state = await formState(owner.base, token);
    assert.equal(typeof state.fingerprint, 'string');
    const body = { submissionId: 'evil-000001', fingerprint: state.fingerprint, expectedRevision: 0, answers: { '4.2': 'B' } };
    const url = `${owner.base}/api/page-forms/${token}`;
    const host = new URL(owner.base).host;
    const refused = [
        { Origin: 'https://evil.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' },
        { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'none' }, { 'Sec-Fetch-Site': 'cross-site', Origin: owner.base },
        // An opaque origin is refused even when Fetch Metadata claims same-origin.
        { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
        // A forwarded host never vouches for an origin; neither does the wrong scheme.
        { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example' },
        { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example', 'Sec-Fetch-Site': 'same-origin' },
        { Origin: `https://${host}`, 'Sec-Fetch-Site': 'same-origin' },
    ];
    for (const headers of refused) {
        const response = await post(url, body, headers);
        assert.equal(response.status, 403, JSON.stringify(headers));
        assert.match(String(response.headers.get('cache-control')), /no-store/);
        assert.equal((await formFetch(url, { headers })).status, 403, `reads too: ${JSON.stringify(headers)}`);
    }
    const proxied = await json(await formFetch(url, { headers: { Origin: 'https://other.example', 'Sec-Fetch-Site': 'same-origin' } }));
    assert.match(String(proxied.error), /add that origin to PI_DISH_PUBLIC_ORIGINS/);
    const plain = await formFetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
    assert.equal(plain.status, 415, 'a simple (unpreflighted) cross-site body type is refused');
    assert.ok(owner.shareBase);
    for (const target of [`${owner.shareBase}/api/page-forms/${token}`, `${owner.shareBase}/page/${token}/`]) {
        assert.equal((await post(target, body)).status, 404, `${target} must not accept a submission`);
    }
    const accepted = [
        { Origin: owner.base, 'Sec-Fetch-Site': 'same-origin' }, { 'Sec-Fetch-Site': 'same-origin' },
        { Origin: PUBLIC_ORIGIN, 'Sec-Fetch-Site': 'same-origin' },
    ];
    for (const headers of accepted) {
        assert.equal((await formFetch(url, { headers })).status, 200, `pi-dish's own form view reads it: ${JSON.stringify(headers)}`);
    }
    // A request that names no form client is refused, Fetch headers or not. That
    // is an older hub's generic relay on plain HTTP: Origin stripped, and no
    // Fetch Metadata, which browsers send only to secure origins.
    const unnamed = [{}, { 'Sec-Fetch-Site': 'same-origin' }, { Origin: owner.base, 'Sec-Fetch-Site': 'same-origin' }];
    for (const headers of unnamed) {
        for (const init of [{ headers }, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }]) {
            assert.equal((await fetch(url, init)).status, 403, `no client header: ${JSON.stringify(init)}`);
        }
    }
    assert.equal((await formFetch(url, { headers: { 'X-Pi-Dish-Form-Client': 'browser' } })).status, 403, 'only the known clients');
    assert.equal(prompts.length, 0, 'nothing reached the agent');
    assert.deepEqual(await formReceipt(owner.base, token, 'evil-000001'), { error: 'no such submission' });
});
test('a stale form or revision is refused before delivery', async () => {
    const state = await formState(owner.base, token);
    const url = `${owner.base}/api/page-forms/${token}`;
    const answers = { '4.1': 'A', '4.2': 'A', '12.2': 'C', rule6: true, tags: ['warm'] };
    const stale = await post(url, { submissionId: 'stale-00001', fingerprint: 'not-this-form', expectedRevision: 0, answers });
    assert.equal(stale.status, 409);
    assert.equal((await json(stale)).code, 'stale');
    const behind = await post(url, { submissionId: 'stale-00002', fingerprint: state.fingerprint, expectedRevision: 3, answers });
    assert.equal(behind.status, 409);
    assert.equal((await json(behind)).code, 'revision');
    // The agent edits the form after the view loaded: the old fingerprint no longer submits.
    const index = path.join(home, 'project', 'gallery', 'index.html');
    fs.writeFileSync(index, formPage({ ...GALLERY_SPEC, fields: [...GALLERY_SPEC.fields, { id: 'extra', type: 'yesno' }] }));
    try {
        const changed = await post(url, { submissionId: 'stale-00003', fingerprint: state.fingerprint, expectedRevision: 0, answers });
        assert.equal(changed.status, 409);
        assert.equal((await json(changed)).code, 'stale');
    }
    finally {
        fs.writeFileSync(index, formPage(GALLERY_SPEC));
    }
    assert.equal(prompts.length, 0);
});
test('a submission is readable when its prompt arrives, delivered once; a retry with its id never sends again', async () => {
    const answers = { '4.1': 'A', '4.2': 'B', '12.2': 'A', rule6: true, names: true, tags: ['warm'], notes: 'Looks good' };
    const receipt = await submitted(owner.base, token, 'first-000001', answers);
    assert.equal(receipt.state, 'delivered');
    assert.equal(receipt.revision, 1);
    const own = await json(await formFetch(`${owner.base}/api/page-forms/${token}?submission=first-000001`));
    assert.deepEqual((0, test_types_js_1.record)(own.submission).changed, ['4.2', '12.2']);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].deliverAs, 'followUpIfBusy', 'the bridge picks prompt or follow-up at admission');
    const message = String(prompts[0].message);
    assert.match(message, new RegExp(`^\\[form response: Gallery picks \\(${token}\\), submitted \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ\\]\\n`));
    assert.deepEqual(message.split('\n').slice(1), [
        '4.2: B (default A)', '12.2: A (default C)', 'all other fields: default',
        'names: yes', 'notes: Looks good', `full answer set: pi-dish-pages answers ${token} --submission first-000001`,
    ]);
    // The answer set the message names was stored before the prompt went out.
    assert.equal(readAtPrompt.length, 1);
    assert.equal(readAtPrompt[0].status, 200);
    assert.deepEqual((0, test_types_js_1.record)(readAtPrompt[0].submission).answers, answers);
    assert.equal((0, test_types_js_1.record)(readAtPrompt[0].submission).state, 'delivering');
    const state = await formState(owner.base, token);
    for (let attempt = 0; attempt < 3; attempt++) {
        const retry = await post(`${owner.base}/api/page-forms/${token}`, {
            submissionId: 'first-000001', fingerprint: state.fingerprint, expectedRevision: 0, answers,
        });
        assert.equal(retry.status, 200);
        const repeated = await json(retry);
        assert.equal(repeated.repeated, true);
        assert.equal((0, test_types_js_1.record)(repeated.receipt).state, 'delivered');
    }
    assert.equal(prompts.length, 1, 'retries never send a second copy');
    const second = await submitted(owner.base, token, 'second-00001', { ...answers, rule6: false });
    assert.equal(second.revision, 2);
    assert.equal(prompts.length, 2);
    assert.match(String(prompts[1].message), /^\[form response revision 2: .*; replaces the response of .*\]\n4\.2: B \(default A\)\n12\.2: A \(default C\)\nrule6: not ok \(default ok\)\n/);
    const after = await formState(owner.base, token);
    assert.equal(after.revision, 2);
    assert.deepEqual((0, test_types_js_1.record)(after.latest).answers, { ...answers, rule6: false });
    assert.equal((0, test_types_js_1.record)(after.latest).fingerprint, state.fingerprint);
    assert.deepEqual(after.unresolved, []);
    const first = await json(await formFetch(`${owner.base}/api/page-forms/${token}?submission=first-000001`));
    assert.deepEqual((0, test_types_js_1.record)(first.submission).answers, answers, 'each prompt\'s own answer set stays readable');
    assert.equal(JSON.stringify(after).includes(SESSION_ID) || JSON.stringify(first).includes(SESSION_ID), false, 'the destination session is not exposed');
    assert.equal(fs.statSync(path.join(home, '.pi', 'dish', 'page-forms.json')).mode & 0o777, 0o600);
});
test('a session that is not running fails the receipt without consuming a revision; a cut-off one shows as unresolved', async () => {
    const idle = path.join(home, 'idle-form.html');
    fs.writeFileSync(idle, formPage({ fields: [{ id: 'ok', type: 'yesno', default: true }] }));
    const page = await json(await post(`${owner.base}/api/pages`, { path: idle, sessionId: IDLE_ID }));
    const idleToken = String(page.token);
    const receipt = await submitted(owner.base, idleToken, 'idle-0000001', { ok: false });
    assert.equal(receipt.state, 'failed');
    assert.match(String(receipt.error), /not running/);
    assert.equal((await formState(owner.base, idleToken)).revision, 0);
    // A submission still marked delivering that no running delivery owns (pi-dish restarted mid-send).
    const storeFile = path.join(home, '.pi', 'dish', 'page-forms.json');
    const stored = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    const cutOff = { ...stored[idleToken].receipts[0], id: 'idle-0000002', state: 'delivering', error: null, finishedAt: null, acceptedAt: Date.now() };
    stored[idleToken].receipts.push(cutOff);
    fs.writeFileSync(storeFile, JSON.stringify(stored));
    const fresh = await formState(owner.base, idleToken);
    assert.deepEqual(fresh.unresolved.map(item => [item.id, item.state]), [['idle-0000002', 'uncertain']], 'a fresh view learns of the unsettled submission');
});
test('re-publishing a form to another session rotates the token; the old answers are gone', async () => {
    const site = path.join(home, 'project', 'rebound');
    fs.mkdirSync(site, { recursive: true });
    fs.writeFileSync(path.join(site, 'index.html'), formPage({ fields: [{ id: 'ok', type: 'yesno', default: true }] }));
    const first = await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: SESSION_ID }));
    const oldToken = String(first.token);
    assert.equal((await submitted(owner.base, oldToken, 'bound-000001', { ok: false })).state, 'delivered');
    const same = await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: SESSION_ID }));
    assert.equal(same.token, oldToken, 'the same recipient keeps its link');
    const rebound = await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: IDLE_ID }));
    assert.notEqual(rebound.token, oldToken);
    assert.equal(rebound.replacedToken, oldToken);
    assert.deepEqual(rebound.form, { questions: 1, answerPath: `/forms/${rebound.token}` });
    assert.equal((await formFetch(`${owner.base}/api/page-forms/${oldToken}`)).status, 404);
    assert.equal((await formFetch(`${owner.base}/api/page-forms/${oldToken}?submission=bound-000001`)).status, 404);
    assert.equal((await fetch(`${owner.base}/page/${oldToken}/`)).status, 404);
    const fresh = await formState(owner.base, String(rebound.token));
    assert.equal(fresh.revision, 0);
    assert.equal(fresh.latest, null);
    const store = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'dish', 'page-forms.json'), 'utf8'));
    assert.equal(Object.hasOwn(store, oldToken), false);
});
test('a locked private session\'s form is invisible and cannot be prompted', async () => {
    const hidden = path.join(home, 'hidden-registered.html');
    fs.writeFileSync(hidden, formPage({ fields: [{ id: 'ok', type: 'yesno' }] }));
    // Registered directly, as an older pi-dish could have: publishing now refuses it.
    const pagesFile = path.join(home, '.pi', 'dish', 'pages.json');
    const registry = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    registry['privateFormToken0001'] = { root: hidden, title: 'Hidden', sessionId: PRIVATE_ID, createdAt: Date.now() };
    fs.writeFileSync(pagesFile, JSON.stringify(registry));
    const pin = await fetch(`${owner.base}/api/private-sessions/pin`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2468' }),
    });
    assert.equal(pin.status, 200);
    const url = `${owner.base}/api/page-forms/privateFormToken0001`;
    assert.equal((await formFetch(url)).status, 404, 'a locked private destination looks unknown');
    const before = prompts.length;
    const attempt = await post(url, { submissionId: 'priv-0000001', fingerprint: 'x', expectedRevision: 0, answers: { ok: true } });
    assert.equal(attempt.status, 404);
    assert.equal(prompts.length, before);
    const unlocked = await json(await post(`${owner.base}/api/private-sessions/unlock`, { pin: '2468' }));
    const opened = await formFetch(url, { headers: { 'X-Pi-Dish-Private-Unlock': String(unlocked.token) } });
    assert.equal(opened.status, 200, 'the PIN opens it like any private route');
    delete registry['privateFormToken0001'];
    fs.writeFileSync(pagesFile, JSON.stringify(registry));
});
test('a hub relays the owner page and form API to the page\'s host after its own same-origin check', async () => {
    const hubView = await (await fetch(`${hub.base}/page/${token}/`)).text();
    assert.match(hubView, new RegExp(`<a class="pdf-answer" href="/forms/${token}"`), 'this hub serves /forms');
    assert.ok(hub.shareBase);
    const hubPublic = await (await fetch(`${hub.shareBase}/page/${token}/`)).text();
    assert.doesNotMatch(hubPublic, /\/forms\//);
    const before = prompts.length;
    const state = await formState(hub.base, token);
    assert.equal(state.revision, 2);
    const body = { submissionId: 'hub-00000001', fingerprint: state.fingerprint, expectedRevision: 2, answers: { '4.1': 'B', '4.2': 'A', '12.2': 'C', rule6: true, tags: [] } };
    assert.equal((await post(`${hub.shareBase}/api/page-forms/${token}`, body)).status, 404);
    assert.equal((await post(`${hub.base}/api/page-forms/${token}`, body, { 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'refused before the relay');
    // The generic fleet proxy never carries form calls, in either direction.
    for (const call of [post(`${hub.base}/hosts/owner/api/page-forms/${token}`, body), formFetch(`${hub.base}/hosts/owner/api/page-forms/${token}`)]) {
        assert.equal((await call).status, 403);
    }
    assert.equal(prompts.length, before);
    const receipt = await submitted(hub.base, token, 'hub-00000001', body.answers);
    assert.equal(receipt.state, 'delivered');
    assert.equal(receipt.revision, 3);
    assert.equal(prompts.length, before + 1);
    assert.match(String(prompts.at(-1)?.message), /\n4\.1: B \(default A\)\ntags: \(none\) \(default warm\)\nall other fields: default\nunanswered: names, notes\n/);
});
// Sends the path exactly as written (fetch would resolve dot segments first).
function rawRequest(base, requestPath, method = 'GET', body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(base);
        const payload = body === null ? null : JSON.stringify(body);
        const request = http.request({ host: url.hostname, port: url.port, path: requestPath, method,
            headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}), ...headers } }, (response) => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { text += chunk; });
            response.on('end', () => resolve({ status: response.statusCode ?? 0, text }));
        });
        request.on('error', reject);
        request.end(payload ?? undefined);
    });
}
test('a hub never sends the owner a path that a normalizing proxy could resolve elsewhere', async () => {
    assert.ok(hub.shareBase);
    ownerSaw.length = 0;
    const hostile = [
        `/page/${token}/..%2f..%2fapi%2fsessions`, `/page/${token}/%2e%2e/%2e%2e/api/sessions`,
        `/page/${token}/..%252f..%252fapi%252fsessions`, `/page/${token}/a%5c..%5c..%5capi%5csessions`,
        `/page/${token}/a//..//..//api/sessions`, `/page/${token}/./%2e/api`,
    ];
    for (const base of [hub.shareBase, hub.base]) {
        for (const requestPath of hostile)
            assert.equal((await rawRequest(base, requestPath)).status, 404, `${base}${requestPath}`);
    }
    // The comment and form relays build the owner's URL from route params alone.
    await rawRequest(hub.base, `/api/page-forms/${token}/receipts/..%2f..%2f..%2fsessions`);
    await rawRequest(hub.base, `/api/page-comments/${token}/..%2f..%2fx/delete`, 'POST', {});
    await rawRequest(hub.base, `/api/page-forms/${token}/..%2f..%2fsessions`, 'POST', {});
    const allowed = [`/page/${token}`, `/api/page-forms/${token}`, `/api/page-comments/${token}`, '/api/host'];
    for (const seen of ownerSaw)
        assert.ok(allowed.some(prefix => seen.startsWith(prefix)), `the owner received ${seen}`);
    // An ordinary asset name still reaches the owner, encoded.
    const asset = await rawRequest(hub.shareBase, `/page/${token}/a%20b.png`);
    assert.equal(asset.status, 404, 'missing on the owner, but relayed');
    assert.ok(ownerSaw.includes(`/page/${token}/a%20b.png`));
});
test('the generic fleet proxy refuses every spelling of the form routes; an Origin-stripped browser write is refused', async () => {
    ownerSaw.length = 0;
    const body = { submissionId: 'generic-0001', fingerprint: 'x', expectedRevision: 3, answers: {} };
    for (const spelling of ['PAGE-FORMS', 'Page-Forms', 'page%2Dforms', 'page%252Dforms', '/page-forms', 'x/..%2fpage-forms']) {
        for (const method of ['GET', 'POST']) {
            const response = await rawRequest(hub.base, `/hosts/owner/api/${spelling}/${token}`, method, method === 'POST' ? body : null);
            assert.equal(response.status, 403, `${method} ${spelling}`);
        }
    }
    assert.equal(ownerSaw.some(seen => /page-forms/i.test(decodeURIComponent(seen))), false, 'nothing reached the owner');
    // An older hub's generic relay forwards Fetch Metadata but drops Origin: a browser write without Origin is refused.
    const stripped = await post(`${owner.base}/api/page-forms/${token}`, body, { 'Sec-Fetch-Site': 'same-origin' });
    assert.equal(stripped.status, 403);
});
test('form routes stay out of the general API CORS allowlist', async () => {
    const corsHome = (0, test_env_js_1.createTestTempDir)('pi-dish-forms-cors-');
    fs.mkdirSync(path.join(corsHome, '.pi', 'dish'), { recursive: true });
    fs.writeFileSync(path.join(corsHome, '.pi', 'dish', 'token'), 'cors-fixture-token');
    fs.writeFileSync(path.join(corsHome, '.pi', 'dish', 'settings.json'), JSON.stringify({ allowedOrigins: ['https://app.example'] }));
    const corsHost = await boot(corsHome, false);
    const preflight = (requestPath) => fetch(`${corsHost.base}${requestPath}`, {
        method: 'OPTIONS', headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    assert.equal((await preflight('/api/sessions')).headers.get('access-control-allow-origin'), 'https://app.example', 'the allowlist works elsewhere');
    for (const requestPath of ['/api/page-forms/someToken0000000000001', '/API/Page-Forms/someToken0000000000001']) {
        assert.equal((await preflight(requestPath)).headers.get('access-control-allow-origin'), null, requestPath);
    }
});
test('any recipient change rotates a form page\'s token, whatever its HTML or renderer now; reads check the stored recipient', async () => {
    const site = path.join(home, 'project', 'rebind-any');
    fs.mkdirSync(site, { recursive: true });
    const index = path.join(site, 'index.html');
    fs.writeFileSync(index, formPage({ fields: [{ id: 'ok', type: 'yesno', default: true }] }));
    const first = await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: SESSION_ID }));
    assert.equal((await submitted(owner.base, String(first.token), 'anyhtml-0001', { ok: false })).state, 'delivered');
    // The form is gone from the HTML, but the page is still bound to its recipient.
    fs.writeFileSync(index, '<!doctype html><p>no form any more</p>');
    const rebound = await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: IDLE_ID }));
    assert.equal(rebound.replacedToken, first.token);
    assert.equal((await formFetch(`${owner.base}/api/page-forms/${String(first.token)}?submission=anyhtml-0001`)).status, 404);
    const single = path.join(home, 'project', 'rebind-file.html');
    fs.writeFileSync(single, formPage({ fields: [{ id: 'ok', type: 'yesno', default: true }] }));
    const page = await json(await post(`${owner.base}/api/pages`, { path: single, sessionId: SESSION_ID }));
    // The file renderer shows source, never a form; the binding still rotates.
    const viewed = await json(await post(`${owner.base}/api/pages`, { path: single, sessionId: IDLE_ID, renderer: 'file' }));
    assert.equal(viewed.replacedToken, page.token);
    // A record made for another recipient never shows or answers under this binding.
    const storeFile = path.join(home, '.pi', 'dish', 'page-forms.json');
    const stored = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    const foreign = { id: 'foreign-0001', state: 'uncertain', revision: 9, acceptedAt: Date.now(), finishedAt: Date.now(), error: null,
        sessionId: 'someone-else', fingerprint: 'f', answers: { ok: true }, changed: [] };
    stored[token].submissions.push(foreign);
    stored[token].receipts.push({ ...foreign, answers: undefined });
    fs.writeFileSync(storeFile, JSON.stringify(stored));
    assert.equal((await formFetch(`${owner.base}/api/page-forms/${token}?submission=foreign-0001`)).status, 404);
    assert.equal((await formFetch(`${owner.base}/api/page-forms/${token}/receipts/foreign-0001`)).status, 404);
    const retry = await post(`${owner.base}/api/page-forms/${token}`, { submissionId: 'foreign-0001', fingerprint: 'f', expectedRevision: 3, answers: {} });
    assert.equal(retry.status, 409);
});
test('a receipt outlives its answers: an evicted id is never sent again, and the delivered answers stay current', async () => {
    const before = prompts.length;
    const storeFile = path.join(home, '.pi', 'dish', 'page-forms.json');
    const stored = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    stored[token].receipts.push({ id: 'evicted-0001', state: 'uncertain', revision: 4, acceptedAt: 1, finishedAt: 2, error: 'cut off', sessionId: SESSION_ID });
    stored[token].submissions = [];
    fs.writeFileSync(storeFile, JSON.stringify(stored));
    const state = await formState(owner.base, token);
    assert.equal(state.revision, 3);
    assert.ok((0, test_types_js_1.record)(state.latest).answers, 'the current answers do not depend on the bounded history');
    const current = String((0, test_types_js_1.record)(state.latest).id);
    const exact = await formFetch(`${owner.base}/api/page-forms/${token}?submission=${current}`);
    assert.equal(exact.status, 200, 'the exact-submission URL finds the current answers outside the history');
    assert.equal((0, test_types_js_1.record)((await json(exact)).submission).id, current);
    const retry = await post(`${owner.base}/api/page-forms/${token}`, {
        submissionId: 'evicted-0001', fingerprint: state.fingerprint, expectedRevision: 3, answers: { '4.1': 'A', '4.2': 'A', '12.2': 'C', rule6: true, tags: ['warm'] },
    });
    assert.equal(retry.status, 200);
    assert.equal((0, test_types_js_1.record)((await json(retry)).receipt).state, 'uncertain');
    assert.equal(prompts.length, before, 'the uncertain id was not dispatched again');
});
test('an owner body cut off mid-relay is a 502, a pre-feature peer is refused clearly, and a bare /forms link is resolved', async () => {
    const cut = await formFetch(`${hub.base}/api/page-forms/${FAULTY_TOKEN}`);
    assert.equal(cut.status, 502);
    assert.match(String((await json(cut)).error), /incomplete response/);
    const old = await formFetch(`${hub.base}/api/page-forms/${OLD_PEER_TOKEN}`);
    assert.equal(old.status, 404);
    assert.match(String((await json(old)).error), /cannot take form answers/);
    // A page this hub has never served: the form API finds its host on its own.
    const site = path.join(home, 'project', 'bare-link');
    fs.mkdirSync(site, { recursive: true });
    fs.writeFileSync(path.join(site, 'index.html'), formPage({ fields: [{ id: 'ok', type: 'yesno', default: true }] }));
    const page = await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: SESSION_ID }));
    const bare = await formFetch(`${hub.base}/api/page-forms/${String(page.token)}`);
    assert.equal(bare.status, 200);
    assert.equal(typeof (await json(bare)).fingerprint, 'string');
});
test('an outcome that cannot be recorded locks the page against submissions at the stale revision', async () => {
    const dish = path.join(home, '.pi', 'dish');
    const mode = fs.statSync(dish).mode & 0o777;
    const state = await formState(owner.base, token);
    const answers = { '4.1': 'B', '4.2': 'B', '12.2': 'C', rule6: true, tags: ['warm'] };
    beforeAnswer = () => { fs.chmodSync(dish, 0o500); };
    try {
        const accepted = await post(`${owner.base}/api/page-forms/${token}`, { submissionId: 'locked-00001', fingerprint: state.fingerprint, expectedRevision: 3, answers });
        assert.equal(accepted.status, 202);
        let receipt = {};
        for (let i = 0; i < 100 && receipt.state !== 'delivered'; i++) {
            await pause(50);
            receipt = (0, test_types_js_1.record)((await formReceipt(owner.base, token, 'locked-00001')).receipt);
        }
        assert.equal(receipt.state, 'delivered', 'the agent has it');
        assert.equal((await formState(owner.base, token)).revision, 3, 'the store has not recorded it');
        const second = await post(`${owner.base}/api/page-forms/${token}`, { submissionId: 'locked-00002', fingerprint: state.fingerprint, expectedRevision: 3, answers });
        assert.equal(second.status, 409, 'no submission is admitted against the stale revision');
        assert.equal((await json(second)).code, 'busy');
    }
    finally {
        beforeAnswer = null;
        fs.chmodSync(dish, mode);
    }
    const recovered = await formState(owner.base, token);
    assert.equal(recovered.revision, 4, 'the next request records it');
    assert.equal((0, test_types_js_1.record)(recovered.latest).id, 'locked-00001');
});
test('a pi recipient gets ^foo$, /cmd and !cmd as written (the message never starts with them); a host refusal fails the receipt', async () => {
    const site = path.join(home, 'project', 'literal');
    fs.mkdirSync(site, { recursive: true });
    fs.writeFileSync(path.join(site, 'index.html'), formPage({ fields: [{ id: 'q', type: 'text' }, { id: 'notes', type: 'longtext' }] }));
    const literalToken = String((await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: SESSION_ID }))).token);
    const receipt = await submitted(owner.base, literalToken, 'literal-0001', { q: '^foo$ @notes.md +500k ultrathink', notes: '/compact\n!rm -rf ~' });
    assert.equal(receipt.state, 'delivered');
    const message = String(prompts.at(-1)?.message);
    assert.ok(message.startsWith('[form response: '));
    assert.match(message, /\nq: \^foo\$ @notes\.md \+500k ultrathink\nnotes: \|\n {2}\/compact\n {2}!rm -rf ~\n/, 'OMP escaping is for OMP sessions only');
    // The host answers the prompt command with a refusal: nothing reached the agent.
    refusePrompts = 'unknown model "^foo$"';
    try {
        const refused = await submitted(owner.base, literalToken, 'literal-0002', { q: 'again' });
        assert.equal(refused.state, 'failed');
        assert.match(String(refused.error), /unknown model/);
    }
    finally {
        refusePrompts = null;
    }
    assert.equal((await formState(owner.base, literalToken)).revision, 1, 'a refusal consumes no revision');
});
test('asset names the owner serves itself also arrive through both hub listeners', async () => {
    assert.ok(hub.shareBase && owner.shareBase);
    const site = path.join(home, 'project', 'gallery');
    const names = {
        'img//plain.txt': 'img/plain.txt', 'back%5Cslash.txt': 'back\\slash.txt', '100%25%20done.txt': '100% done.txt',
        'a%2541.txt': 'a%41.txt', 'pct%25.txt': 'pct%.txt',
    };
    fs.mkdirSync(path.join(site, 'img'), { recursive: true });
    for (const file of Object.values(names))
        fs.writeFileSync(path.join(site, file), `content of ${file}`);
    for (const base of [owner.base, owner.shareBase, hub.base, hub.shareBase]) {
        for (const [requested, file] of Object.entries(names)) {
            const response = await rawRequest(base, `/page/${token}/${requested}`);
            assert.deepEqual([response.status, response.text], [200, `content of ${file}`], `${base} ${requested}`);
        }
    }
});
test('an unreadable answers store fails closed: no state, no receipt, no replay of a delivered id', async () => {
    const storeFile = path.join(home, '.pi', 'dish', 'page-forms.json');
    const saved = fs.readFileSync(storeFile);
    const state = await formState(owner.base, token);
    const url = `${owner.base}/api/page-forms/${token}`;
    const answers = { '4.1': 'A', '4.2': 'B', '12.2': 'A', rule6: true, names: true, tags: ['warm'], notes: 'Looks good' };
    const before = prompts.length;
    try {
        for (const damage of [() => fs.writeFileSync(storeFile, '{"half": '), () => fs.chmodSync(storeFile, 0o000)]) {
            fs.chmodSync(storeFile, 0o600);
            fs.writeFileSync(storeFile, saved);
            damage();
            assert.equal((await formFetch(url)).status, 500);
            assert.equal((await formFetch(`${url}/receipts/first-000001`)).status, 500);
            for (const submissionId of ['first-000001', 'unread-00001']) {
                const response = await post(url, { submissionId, fingerprint: state.fingerprint, expectedRevision: state.revision, answers });
                assert.equal(response.status, 500, submissionId);
            }
        }
    }
    finally {
        fs.chmodSync(storeFile, 0o600);
        fs.writeFileSync(storeFile, saved);
    }
    assert.equal(prompts.length, before, 'nothing was sent, the delivered id least of all');
});
test('a form added after publishing binds its recipient at the first answer', async () => {
    const site = path.join(home, 'project', 'late-form');
    fs.mkdirSync(site, { recursive: true });
    const index = path.join(site, 'index.html');
    fs.writeFileSync(index, '<!doctype html><p>no form yet</p>');
    const first = await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: SESSION_ID }));
    assert.equal(first.form, null);
    fs.writeFileSync(index, formPage({ fields: [{ id: 'ok', type: 'yesno', default: true }] }));
    assert.equal((await submitted(owner.base, String(first.token), 'late-0000001', { ok: false })).state, 'delivered');
    fs.writeFileSync(index, '<!doctype html><p>no form any more</p>');
    const rebound = await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: IDLE_ID }));
    assert.equal(rebound.replacedToken, first.token);
});
test('a form body over the relay budget is a short 413 on the owner and through the hub', async () => {
    const storeFile = path.join(home, '.pi', 'dish', 'page-forms.json');
    const saved = fs.readFileSync(storeFile);
    const stored = JSON.parse(saved.toString());
    // A live edit can grow the form past its budget; a stored answer set stands in for it here.
    // The current answer set, also the newest history entry, grown past the budget.
    const huge = { notes: 'x'.repeat(1024 * 1024) };
    const currentId = String(stored[token].current.id);
    stored[token].current.answers = huge;
    for (const item of stored[token].submissions)
        if (item.id === currentId)
            item.answers = huge;
    fs.writeFileSync(storeFile, JSON.stringify(stored));
    try {
        for (const url of [`${owner.base}/api/page-forms/${token}`, `${hub.base}/api/page-forms/${token}`, `${owner.base}/api/page-forms/${token}?submission=${currentId}`]) {
            const response = await formFetch(url);
            const text = await response.text();
            assert.equal(response.status, 413, url);
            assert.ok(text.length < 512, `a short refusal: ${text.length} bytes`);
            assert.match(text, /KiB \(limit 960 KiB\); ask the agent to shorten the form/);
        }
    }
    finally {
        fs.writeFileSync(storeFile, saved);
    }
});
test('HEAD relays without a body; malformed ids are refused before relaying; receipts survive the file renderer', async () => {
    const head = await formFetch(`${hub.base}/api/page-forms/${token}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    const full = Buffer.byteLength(await (await formFetch(`${owner.base}/api/page-forms/${token}`)).text());
    assert.equal(head.headers.get('content-length'), String(full), 'the owner\'s metadata for the body it would send');
    assert.match(String(head.headers.get('content-type')), /application\/json/);
    ownerSaw.length = 0;
    for (const [requestPath, method] of [
        [`/api/page-forms/${token}/receipts/bad.id!`, 'GET'], [`/api/page-forms/${token}?submission=..%2Fbad`, 'GET'],
        [`/api/page-forms/${token}?submission=short`, 'GET'], [`/api/page-comments/${token}/bad.id/delete`, 'POST'],
    ]) {
        assert.equal((await rawRequest(hub.base, requestPath, method, method === 'POST' ? {} : null, CLI)).status, 404, requestPath);
    }
    assert.deepEqual(ownerSaw.filter(seen => seen !== '/api/host'), [], 'nothing malformed reached the owner');
    const single = path.join(home, 'project', 'renderer-switch.html');
    fs.writeFileSync(single, formPage({ fields: [{ id: 'ok', type: 'yesno', default: true }] }));
    const page = await json(await post(`${owner.base}/api/pages`, { path: single, sessionId: SESSION_ID }));
    assert.equal((await submitted(owner.base, String(page.token), 'switch-00001', { ok: false })).state, 'delivered');
    const viewed = await json(await post(`${owner.base}/api/pages`, { path: single, sessionId: SESSION_ID, renderer: 'file' }));
    assert.equal(viewed.token, page.token, 'the same recipient keeps its link');
    assert.equal((0, test_types_js_1.record)((await formReceipt(owner.base, String(page.token), 'switch-00001')).receipt).state, 'delivered');
    assert.equal((await formFetch(`${owner.base}/api/page-forms/${String(page.token)}?submission=switch-00001`)).status, 200);
});
test('the bridge decides prompt or follow-up at admission; only a message it saw admitted is delivered', async () => {
    const site = path.join(home, 'project', 'turns');
    fs.mkdirSync(site, { recursive: true });
    fs.writeFileSync(path.join(site, 'index.html'), formPage({ fields: [{ id: 'ok', type: 'yesno', default: true }] }));
    const turnsToken = String((await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: SESSION_ID }))).token);
    // The event and a later command answer share the bridge socket, so once the
    // server has its command answer it has processed the event before it.
    const turn = async (event) => {
        bridgeEvent(event);
        const commands = await fetch(`${owner.base}/api/commands?sessionId=${SESSION_ID}`);
        assert.equal(commands.status, 200, await commands.text());
    };
    await turn('agent_start');
    try {
        assert.equal((await submitted(owner.base, turnsToken, 'busy-turn-001', { ok: true })).state, 'delivered');
        assert.equal(prompts.at(-1)?.deliverAs, 'followUpIfBusy', 'pi-dish does not choose from its own view of the turn');
    }
    finally {
        await turn('agent_end');
    }
    const cases = [
        [{ queued: true, admitted: false }, /compacting; the message waits in its queue/],
        [{ queued: false, admitted: false }, /did not confirm it took the message in time/],
    ];
    for (const [index, [answer, reason]] of cases.entries()) {
        promptAnswer = answer;
        try {
            const receipt = await submitted(owner.base, turnsToken, `unconfirmed-${index}0`, { ok: false });
            assert.equal(receipt.state, 'uncertain');
            assert.match(String(receipt.error), reason);
        }
        finally {
            promptAnswer = ADMITTED;
        }
    }
    assert.equal((await formState(owner.base, turnsToken)).revision, 1, 'an unconfirmed message advances nothing');
});
test('a relayed comment keeps its own reply limit: a long CJK quote and comment are saved once and reported saved', async () => {
    const quote = '漢'.repeat(12000);
    const body = '字'.repeat(10000);
    const created = await fetch(`${hub.base}/api/page-comments/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'null' },
        body: JSON.stringify({ body, anchor: { type: 'text', quote } }),
    });
    const text = await created.text();
    assert.ok(Buffer.byteLength(text) > 64 * 1024, 'the reply is past 64 KiB in bytes');
    assert.equal(created.status, 201, text.slice(0, 200));
    const stored = (0, test_types_js_1.record)(JSON.parse(fs.readFileSync(path.join(home, '.pi', 'dish', 'comments.json'), 'utf8')));
    assert.equal(Object.values(stored).map(item => (0, test_types_js_1.record)(item)).filter(comment => comment.body === body).length, 1);
});
test('a malformed or inconsistent form record fails closed, unlike a missing one', async () => {
    const storeFile = path.join(home, '.pi', 'dish', 'page-forms.json');
    const saved = fs.readFileSync(storeFile);
    const state = await formState(owner.base, token);
    const url = `${owner.base}/api/page-forms/${token}`;
    const answers = { '4.1': 'A', '4.2': 'B', '12.2': 'A', rule6: true, names: true, tags: ['warm'], notes: 'Looks good' };
    const before = prompts.length;
    const damaged = [
        ['emptied', () => ({})],
        ['receipt history dropped', entry => ({ ...entry, receipts: [] })],
        ['revision moved back', entry => ({ ...entry, revision: 0 })],
        ['a receipt without its state', entry => ({ ...entry, receipts: entry.receipts.map(({ state: _state, ...rest }) => rest) })],
    ];
    try {
        for (const [what, damage] of damaged) {
            const stored = JSON.parse(saved.toString());
            stored[token] = damage(stored[token]);
            fs.writeFileSync(storeFile, JSON.stringify(stored));
            assert.equal((await formFetch(url)).status, 500, what);
            assert.equal((await formFetch(`${url}/receipts/first-000001`)).status, 500, what);
            const replay = await post(url, { submissionId: 'first-000001', fingerprint: state.fingerprint, expectedRevision: 0, answers });
            assert.equal(replay.status, 500, `${what}: the delivered id is not replayed`);
        }
    }
    finally {
        fs.writeFileSync(storeFile, saved);
    }
    assert.equal(prompts.length, before);
    // No record for the token at all is an empty form, as for a page that never took answers.
    const stored = JSON.parse(saved.toString());
    const site = path.join(home, 'project', 'never-answered');
    fs.mkdirSync(site, { recursive: true });
    fs.writeFileSync(path.join(site, 'index.html'), formPage({ fields: [{ id: 'ok', type: 'yesno', default: true }] }));
    const fresh = String((await json(await post(`${owner.base}/api/pages`, { path: site, sessionId: SESSION_ID }))).token);
    assert.equal(Object.hasOwn(stored, fresh), false);
    assert.equal((await formState(owner.base, fresh)).revision, 0);
});
test('pi-dish-pages answers takes the token before options: one starting with "-" or after "--"', () => {
    const cli = path.join(__dirname, '..', 'skills', 'pi-dish-pages', 'scripts', 'pi-dish-pages.js');
    const run = (...args) => {
        try {
            return { ok: true, out: (0, node_child_process_1.execFileSync)(process.execPath, [cli, ...args], { env: (0, test_env_js_1.sanitizeTestEnv)(), encoding: 'utf8', stdio: 'pipe' }) };
        }
        catch (error) {
            return { ok: false, out: String((0, test_types_js_1.record)(error).stderr) };
        }
    };
    const dashed = run('answers', '-sample-token', '--url', owner.base);
    assert.equal(dashed.ok, false);
    assert.match(dashed.out, /could not read the answers for -sample-token: page not found/, 'the token is a token, not an option');
    const separated = run('answers', '--', token, '--url', owner.base);
    assert.equal(separated.ok, true, separated.out);
    assert.equal(typeof (0, test_types_js_1.record)(JSON.parse(separated.out)).fingerprint, 'string');
});
test('unpublishing removes the recorded answers', async () => {
    const revoked = await json(await fetch(`${owner.base}/api/pages/${token}`, { method: 'DELETE' }));
    assert.equal(revoked.revoked, true);
    assert.equal((await formFetch(`${owner.base}/api/page-forms/${token}`)).status, 404);
    const store = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'dish', 'page-forms.json'), 'utf8'));
    assert.equal(Object.hasOwn(store, token), false);
});
