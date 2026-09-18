// Generated test/tool from test/browser-skills.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { decodeSkillDirectory, decodeSkillCoverage } = context.PiDishBrowser;
test('skills directory owns decoded rows, counters and refine settings', () => {
    const wire = { skills: [null, { skill: '/one/SKILL.md', name: {}, usage: { weeks12: [2, '3', Infinity] } }], refine: { mode: 'constructor' } };
    const result = decodeSkillDirectory(wire);
    const sourceSkill = wire.skills[1];
    assert.ok(sourceSkill);
    sourceSkill.usage.weeks12[0] = 99;
    assert.equal(result.skills.length, 1);
    assert.equal(result.skills[0].name, '');
    assert.deepEqual(Array.from(result.skills[0].usage.weeks12), [2, 0, 0]);
    assert.equal(result.refine.mode, 'default');
    assert.throws(() => decodeSkillDirectory(null), /Invalid skills directory/);
});
test('skill coverage narrows sections, fractions and activation identities', () => {
    const result = decodeSkillCoverage({ skill: '/one/SKILL.md', latest: { sessionId: 4 }, sections: [null, { fraction: 7, lines: [false, { text: '<literal>', hits: Infinity }] }] });
    assert.equal(result.latest, null);
    assert.equal(result.sections.length, 1);
    assert.equal(result.sections[0].fraction, 1);
    assert.equal(result.sections[0].lines[0].text, '<literal>');
    assert.equal(result.sections[0].lines[0].hits, 0);
    assert.throws(() => decodeSkillCoverage({}), /Invalid skill coverage/);
});
