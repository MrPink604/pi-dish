// Generated test/tool from test/browser-transcript-tree.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { decodeTranscriptTree, projectTranscriptTree, transcriptTreeDescend, transcriptTreePath } = context.PiDishBrowser;
test('tree decoding narrows ids, roles, timestamps and tool summaries', () => {
    const tree = decodeTranscriptTree({ nodes: [null, { id: 7 }, { id: 'entry', timestamp: '2026-10-28T12:00:00.000Z', role: {}, toolCalls: [null, { id: 'call', name: 'bash', args: 'pwd' }] }, { id: 'bad-time', timestamp: 'soon' }], activePathIds: ['entry', 3], leafId: false });
    assert.equal(tree.nodes.length, 2);
    assert.equal(tree.nodes[0].role, '');
    assert.equal(tree.nodes[0].time, Date.parse('2026-10-28T12:00:00.000Z'));
    assert.equal(tree.nodes[1].time, 0);
    assert.equal(tree.nodes[0].toolCalls[0].args, 'pwd');
    assert.equal(tree.activePathIds.length, 1);
    assert.equal(tree.leafId, null);
    assert.throws(() => decodeTranscriptTree({ error: 'bad' }), /Invalid session tree/);
});
// The fork happened at a tool result: the alternatives are children of a row
// the conversation view hides, so they must re-attach to the visible prompt.
const forkedAtHiddenRow = decodeTranscriptTree({ nodes: [
        { id: 'u1', type: 'message', role: 'user', text: 'Scope it' },
        { id: 'a1', parentId: 'u1', type: 'message', role: 'assistant', text: 'Scoped' },
        { id: 'u2', parentId: 'a1', type: 'message', role: 'user', text: 'Build it' },
        { id: 'call', parentId: 'u2', type: 'message', role: 'assistant', toolCalls: [{ id: 't', name: 'bash', args: 'make' }] },
        { id: 'res', parentId: 'call', type: 'message', role: 'toolResult', toolCallId: 't' },
        { id: 'x1', parentId: 'res', type: 'message', role: 'assistant', text: 'Tried FMOD' },
        { id: 'x2', parentId: 'res', type: 'message', role: 'assistant', text: 'Tried native' },
        { id: 'leaf', parentId: 'x2', type: 'message', role: 'assistant', text: 'Done', isLeaf: true },
    ], activePathIds: ['leaf', 'x2', 'res', 'call', 'u2', 'a1', 'u1'], leafId: 'leaf' });
test('hiding the entry a fork happened at keeps the fork on its nearest visible ancestor', () => {
    const view = projectTranscriptTree(forkedAtHiddenRow, 'conversation');
    assert.deepEqual([...view.childrenOf.get('u2') ?? []], ['x1', 'x2']);
    assert.equal(view.forkCount, 1);
    assert.deepEqual([...view.rootBranchIds], ['u1']);
    assert.deepEqual([...view.branches.get('u1')?.nodeIds ?? []], ['u1', 'a1', 'u2']);
    assert.deepEqual([...view.branches.get('u1')?.childIds ?? []], ['x1', 'x2']);
    assert.equal(view.branches.get('x1')?.onActivePath, false);
    assert.equal(view.branches.get('x2')?.hasLeaf, true);
    assert.deepEqual([...transcriptTreePath(view, 'leaf')], ['u1', 'a1', 'u2', 'x2', 'leaf']);
    // With tool traffic shown, the fork sits on the tool result itself.
    const tools = projectTranscriptTree(forkedAtHiddenRow, 'tools');
    assert.equal(tools.parentOf.get('x1'), 'res');
    assert.deepEqual([...tools.branches.get('u1')?.childIds ?? []], ['x1', 'x2']);
});
test('descending a branch follows the active path to the leaf, else the newest alternative', () => {
    const view = projectTranscriptTree(forkedAtHiddenRow, 'conversation');
    assert.equal(transcriptTreeDescend(view, forkedAtHiddenRow, 'u1'), 'leaf');
    assert.equal(transcriptTreeDescend(view, forkedAtHiddenRow, 'x1'), 'x1');
    const offPath = decodeTranscriptTree({ ...forkedAtHiddenRow, activePathIds: ['u1'], leafId: 'u1',
        nodes: forkedAtHiddenRow.nodes.map((node) => ({ ...node, isLeaf: node.id === 'u1' })) });
    assert.equal(transcriptTreeDescend(projectTranscriptTree(offPath, 'conversation'), offPath, 'a1'), 'leaf');
});
