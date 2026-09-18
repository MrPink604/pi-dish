// Generated test/tool from test/browser/live-transcript.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('a coalesced frame keeps its selection owner even when callers do not explicitly cancel it', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(({ id, host }) => {
        fixtureApp.features.streamingRenderer.queue({ role: 'assistant', content: 'first frame' });
        fixtureApp.features.streamingRenderer.queue({ role: 'assistant', content: 'old pending frame' });
        fixtureApp.features.sessionState.advanceSelection();
        fixtureApp.features.sessionState.setCurrentSession(id, host);
        fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").textContent = 'new host transcript';
    }, { id: fixtures_js_1.ROOT, host: fleet.peer.hostId });
    await page.waitForTimeout(120);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toHaveText('new host transcript');
});
(0, fixtures_js_1.test)('streamed block updates preserve open details and update renamed tools with identical arguments', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const result = await page.evaluate(() => {
        const root = fixtureElement(document.getElementById('messages'), '#messages');
        root.replaceChildren();
        fixtureApp.features.streamingRenderer.render({ role: 'assistant', content: [{ type: 'thinking', thinking: 'first' }, { type: 'toolCall', name: 'first-tool', arguments: { path: 'a' } }] });
        const thinking = fixtureDetails(root.querySelector('.thinking-block'), '.thinking-block');
        const tool = fixtureDetails(root.querySelector('.tool-call'), '.tool-call');
        thinking.open = true;
        tool.open = true;
        fixtureApp.features.streamingRenderer.render({ role: 'assistant', content: [{ type: 'thinking', thinking: 'second' }, { type: 'toolCall', name: 'renamed-tool', arguments: { path: 'a' } }] });
        return { sameThinking: thinking === root.querySelector('.thinking-block'), sameTool: tool === root.querySelector('.tool-call'), openThinking: thinking.open, openTool: tool.open,
            thinking: fixtureElement(thinking.querySelector('.thinking-text'), '.thinking-text').textContent, name: fixtureElement(tool.querySelector('.tool-call-name'), '.tool-call-name').textContent };
    });
    (0, fixtures_js_1.expect)(result).toEqual({ sameThinking: true, sameTool: true, openThinking: true, openTool: true, thinking: 'second', name: 'renamed-tool' });
});
(0, fixtures_js_1.test)('cumulative tool starts and updates reuse the panel and replace its image row', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const result = await page.evaluate(() => {
        fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").replaceChildren();
        const first = fixtureApp.features.liveToolsController.append({ toolCallId: 'same-tool', toolName: 'read', args: { path: 'file' } });
        const repeated = fixtureApp.features.liveToolsController.append({ toolCallId: 'same-tool', toolName: 'read', args: { path: 'file' } });
        for (let n = 0; n < 2; n++)
            fixtureApp.features.liveToolsController.update({ toolCallId: 'same-tool', partialResult: { content: [{ type: 'text', text: '<literal>' }, { type: 'image', data: 'a', mimeType: 'image/png' }] } });
        return { same: first === repeated, count: document.querySelectorAll('.live-tool-panel').length, images: document.querySelectorAll('.live-tool-panel .msg-images').length, text: fixtureElement(document.querySelector('.live-tool-output'), "document.querySelector('.live-tool-output')").textContent };
    });
    (0, fixtures_js_1.expect)(result).toEqual({ same: true, count: 1, images: 1, text: '<literal>' });
});
(0, fixtures_js_1.test)('completion-only tools render results without inventing a duration and set mood safely', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => {
        fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").replaceChildren();
        fixtureApp.features.liveToolsController.finish({ toolCallId: 'background', toolName: 'set_mood', args: { description: 'FOCUSED extra', kaomoji: '<literal>\nface' }, result: { content: [{ type: 'text', text: 'done' }] } });
    });
    await (0, fixtures_js_1.expect)(page.locator('.live-tool-panel.complete')).toContainText('done');
    await (0, fixtures_js_1.expect)(page.locator('.live-tool-status.duration')).toHaveCount(0);
    await (0, fixtures_js_1.expect)(page.locator('#moodIndicator')).toHaveText('focused <literal> face');
    await (0, fixtures_js_1.expect)(page.locator('#moodIndicator literal')).toHaveCount(0);
});
(0, fixtures_js_1.test)('same-id tool completion on a newer host cannot replace the older retained panel', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const result = await page.evaluate(({ id, host }) => {
        const root = fixtureElement(document.getElementById('messages'), '#messages');
        root.replaceChildren();
        const old = fixtureElement(fixtureApp.features.liveToolsController.append({ toolCallId: 'collision', toolName: 'old' }), 'old live tool');
        root.replaceChildren();
        fixtureApp.features.sessionState.advanceSelection();
        fixtureApp.features.sessionState.setCurrentSession(id, host);
        fixtureApp.features.liveToolsController.finish({ toolCallId: 'collision', toolName: 'new', result: { content: [{ type: 'text', text: 'new result' }] } });
        return { oldName: fixtureElement(old.el.querySelector('.live-tool-name'), '.live-tool-name').textContent, oldRunning: old.el.classList.contains('running'), connected: old.el.isConnected, newName: fixtureElement(root.querySelector('.live-tool-name'), '.live-tool-name').textContent };
    }, { id: fixtures_js_1.ROOT, host: fleet.peer.hostId });
    (0, fixtures_js_1.expect)(result).toEqual({ oldName: 'old', oldRunning: true, connected: false, newName: 'new' });
});
(0, fixtures_js_1.test)('stream coalescing renders only the latest pending frame and disposal retires its timer', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => {
        fixtureApp.features.streamingRenderer.cancel();
        fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").replaceChildren();
        window.frameTexts = [];
        window.frameRenderer = PiDishBrowser.createStreamingRenderer({ document, sessionState: fixtureApp.features.sessionState, markdown: text => { window.frameTexts.push(text); return text; }, pinned: () => false, scroll() { }, jump() { } });
        window.frameRenderer.queue({ role: 'assistant', content: 'first' });
        window.frameRenderer.queue({ role: 'assistant', content: 'middle' });
        window.frameRenderer.queue({ role: 'assistant', content: 'last' });
    });
    await fixtures_js_1.expect.poll(() => page.evaluate(() => window.frameTexts)).toEqual(['first', 'last']);
    await page.evaluate(() => { window.frameRenderer.queue({ role: 'assistant', content: 'retired' }); window.frameRenderer.dispose(); });
    await page.waitForTimeout(120);
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.frameTexts)).toEqual(['first', 'last']);
});
(0, fixtures_js_1.test)('live-tool disposal rejects subsequent mutations and malformed ids', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const result = await page.evaluate(() => {
        const root = fixtureElement(document.getElementById('messages'), '#messages');
        root.replaceChildren();
        fixtureApp.features.liveToolsController.append({ toolCallId: {} });
        const malformedCount = fixtureApp.features.liveToolsController.count;
        fixtureApp.features.liveToolsController.append({ toolCallId: 'old', toolName: 'read' });
        const before = root.innerHTML;
        fixtureApp.features.liveToolsController.dispose();
        fixtureApp.features.liveToolsController.update({ toolCallId: 'old', partialResult: { content: [{ type: 'text', text: 'late' }] } });
        fixtureApp.features.liveToolsController.finish({ toolCallId: 'new', result: { content: [] } });
        return { malformedCount, unchanged: before === root.innerHTML, count: fixtureApp.features.liveToolsController.count };
    });
    (0, fixtures_js_1.expect)(result).toEqual({ malformedCount: 0, unchanged: true, count: 0 });
});
