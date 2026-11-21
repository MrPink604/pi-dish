// Generated from src/core/github-ci.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CI_RUN_WINDOW = void 0;
exports.createGitHubCi = createGitHubCi;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const helper_values_1 = require("./helper-values");
exports.CI_RUN_WINDOW = 100;
const gh = (0, node_util_1.promisify)(node_child_process_1.execFile);
const API_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const FAILED = { failure: true, timed_out: true };
const BENIGN = { success: true, skipped: true, neutral: true };
const HOLD_TEST = 'a restart delivers each durable batch exactly once and empties the inbox';
async function ghRequest(path, headers, signal) {
    const args = ['api', '--hostname', 'github.com', '--include'];
    headers.forEach((value, name) => args.push('-H', `${name}: ${value}`));
    args.push(path.slice(1));
    let stdout;
    try {
        ({ stdout } = await gh('gh', args, { signal, maxBuffer: 8 << 20, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }));
    }
    catch (error) {
        // gh exits nonzero even for 304, but still writes HTTP status and headers.
        signal.throwIfAborted();
        if ((0, helper_values_1.record)(error) && typeof error.stdout === 'string' && error.stdout.startsWith('HTTP/'))
            stdout = error.stdout;
        else
            throw new Error('No GitHub token configured and gh api unavailable; install and authenticate gh or set a token');
    }
    const separator = /\r?\n\r?\n/.exec(stdout);
    const lines = stdout.slice(0, separator?.index ?? stdout.length).split(/\r?\n/);
    const status = /^HTTP\/\S+ (\d{3})\b/.exec(lines.shift() ?? '');
    if (!status)
        throw new Error('gh api did not return HTTP headers');
    const reply = new Headers();
    for (const line of lines) {
        const colon = line.indexOf(':');
        if (colon > 0)
            reply.append(line.slice(0, colon), line.slice(colon + 1));
    }
    return { status: Number(status[1]), headers: reply, body: separator ? stdout.slice(separator.index + separator[0].length) : '' };
}
function records(data) {
    if (!Array.isArray(data))
        throw new Error('Unexpected GitHub API response');
    return data.filter(helper_values_1.record);
}
function parse(response) {
    if (response.status !== 200)
        throw new Error(`GitHub API returned HTTP ${response.status}`);
    try {
        return JSON.parse(response.body);
    }
    catch {
        throw new Error('GitHub API returned invalid JSON');
    }
}
function parseRuns(data, repo) {
    const runs = records((0, helper_values_1.record)(data) ? data.workflow_runs : null);
    return runs.flatMap(row => {
        const id = row.id;
        const number = row.run_number;
        const attempt = row.run_attempt;
        if (typeof id !== 'number' || typeof number !== 'number' || typeof attempt !== 'number')
            return [];
        const branch = (0, helper_values_1.text)(row.head_branch);
        const sha = (0, helper_values_1.text)(row.head_sha);
        if (!branch || !sha)
            return [];
        const title = (0, helper_values_1.record)(row.head_commit) ? (0, helper_values_1.text)(row.head_commit.message).split(/\r?\n/, 1)[0] : '';
        return [{
                id, number, attempt, branch, sha, title: (title || (0, helper_values_1.text)(row.display_title)).slice(0, 240),
                url: `https://github.com/${repo}/actions/runs/${id}${attempt > 1 ? `/attempts/${attempt}` : ''}`,
                conclusion: typeof row.conclusion === 'string' ? row.conclusion : null, status: (0, helper_values_1.text)(row.status),
            }];
    });
}
/** Actions jobs and test check annotations share an ID. Only extract short test names, not logs. */
function annotationTests(rows) {
    const names = new Set();
    let unknown = false;
    let knownHold = false;
    let knownRename = false;
    for (const row of rows) {
        if (row.annotation_level !== 'failure')
            continue;
        const lines = (0, helper_values_1.text)(row.message).replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/);
        let location = '';
        for (const [index, line] of lines.entries()) {
            const at = /^\s*test at (\S+:\d+:\d+)\s*$/.exec(line);
            if (at) {
                location = at[1];
                continue;
            }
            const failure = /^\s*[✘✖✕×]\s+(.+?)\s*$/.exec(line);
            if (!failure) {
                const tap = /^\s*not ok \d+ - (.+)/.exec(line);
                if (tap) {
                    names.add(tap[1].slice(0, 220));
                    unknown = true;
                }
                continue;
            }
            const name = failure[1].replace(/\s+\(\d+(?:\.\d+)?m?s\)$/, '');
            if (name === 'failing tests:')
                continue;
            if (name.startsWith('smoke test crashed:')) {
                const evidence = lines.slice(Math.max(0, index - 1), index + 8).join('\n');
                if (/Timeout\b/i.test(evidence) && /#sessionName(?:Input)?\b/.test(evidence) &&
                    /(?:rename:|(?:page|locator)\.(?:click|fill))/.test(evidence)) {
                    knownRename = true;
                    names.add('#sessionName rename timeout');
                }
                else {
                    unknown = true;
                    names.add(name.slice(0, 220));
                }
            }
            else {
                if (name === HOLD_TEST) {
                    const evidence = lines.slice(index + 1, index + 12).join('\n').split(/\n\s*(?:test at |[✘✖✕×]\s)/, 1)[0];
                    if (/(?:^|\/)test\/message-hold\.test\.[jt]s:\d+:\d+$/.test(location) &&
                        /(?:2 !== 1|actual:\s*2\b[\s\S]*expected:\s*1\b)/.test(evidence))
                        knownHold = true;
                    else if (location)
                        unknown = true;
                }
                else
                    unknown = true;
                names.add(name.replace(/^\d+\s+(?=\S+:\d+:\d+\s+›)/, '').slice(0, 220));
            }
            location = '';
        }
    }
    if (names.has(HOLD_TEST) && !knownHold)
        unknown = true;
    if (knownHold === knownRename)
        unknown = true;
    return { names, knownKind: unknown ? null : knownHold ? 'hold' : 'rename' };
}
function createGitHubCi(token, options = {}) {
    const workflows = new Map();
    let throttledUntil = 0;
    async function request(path, signal, etag) {
        if (Date.now() < throttledUntil)
            throw new Error('GitHub API rate-limit cooldown');
        const headers = new Headers(API_HEADERS);
        if (etag)
            headers.set('If-None-Match', etag);
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
        let response;
        if (token || options.fetch) {
            try {
                if (token)
                    headers.set('Authorization', `Bearer ${token}`);
                const reply = await (options.fetch ?? fetch)(`https://api.github.com${path}`, { headers, signal: deadline, redirect: 'manual' });
                response = { status: reply.status, headers: reply.headers, body: reply.status === 200 ? await reply.text() : '' };
                if (reply.status !== 200)
                    await reply.body?.cancel();
            }
            catch {
                deadline.throwIfAborted();
                throw new Error('GitHub REST request failed');
            }
        }
        else
            response = await ghRequest(path, headers, deadline);
        if (response.status === 429 || (response.status === 403 &&
            (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0'))) {
            const seconds = Number(response.headers.get('retry-after'));
            const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
            const now = Date.now();
            throttledUntil = Math.max(now + 60_000, Number.isFinite(seconds) ? now + seconds * 1000 : 0, Number.isFinite(reset) ? reset : 0);
            throw new Error('GitHub API rate limited the CI watcher');
        }
        return response;
    }
    async function pages(path, field, signal) {
        const rows = [];
        for (let page = 1; page <= 20; page++) {
            const result = await request(`${path}?per_page=100&page=${page}`, signal);
            const data = parse(result);
            rows.push(...records(field && (0, helper_values_1.record)(data) ? data[field] : data));
            if (!result.headers.get('link')?.includes('rel="next"'))
                return rows;
        }
        throw new Error('GitHub API pagination limit exceeded');
    }
    return {
        async listRuns(repo, workflow, etag, signal) {
            const key = `${repo}:${workflow}`;
            let id = workflows.get(key);
            if (id === undefined) {
                const list = await pages(`/repos/${repo}/actions/workflows`, 'workflows', signal);
                const match = list.find(row => row.name === workflow && row.state !== 'deleted');
                if (typeof match?.id !== 'number')
                    throw new Error(`GitHub workflow not found: ${workflow}`);
                id = match.id;
                workflows.set(key, id);
            }
            const result = await request(`/repos/${repo}/actions/workflows/${id}/runs?per_page=${exports.CI_RUN_WINDOW}`, signal, etag);
            if (result.status === 304)
                return { notModified: true };
            if (result.status === 404)
                workflows.delete(key);
            return { notModified: false, etag: result.headers.get('etag') ?? undefined, runs: parseRuns(parse(result), repo) };
        },
        async failureDetails(repo, run, signal) {
            const rows = await pages(`/repos/${repo}/actions/runs/${run.id}/attempts/${run.attempt}/jobs`, 'jobs', signal);
            const failed = rows.filter(row => Object.hasOwn(FAILED, (0, helper_values_1.text)(row.conclusion)));
            const tests = new Set();
            let likelyKnownFlake = repo.toLowerCase() === 'mrpink604/pi-dish' && run.conclusion === 'failure' &&
                failed.length > 0 && rows.every(row => Object.hasOwn(BENIGN, (0, helper_values_1.text)(row.conclusion)) || row.conclusion === 'failure');
            for (const job of failed) {
                try {
                    if (typeof job.id !== 'number') {
                        likelyKnownFlake = false;
                        continue;
                    }
                    const annotations = await pages(`/repos/${repo}/check-runs/${job.id}/annotations`, null, signal);
                    const evidence = annotationTests(annotations);
                    for (const name of evidence.names)
                        tests.add(name);
                    if (likelyKnownFlake) {
                        const steps = records(job.steps).filter(step => Object.hasOwn(FAILED, (0, helper_values_1.text)(step.conclusion)));
                        const expected = evidence.knownKind === 'hold' ? /^(?:Backend, bridge and lifecycle tests|Run npm test\b)/ :
                            evidence.knownKind === 'rename' ? /^(?:Run )?(?:npm run )?test:ui(?:\s|$)/ : null;
                        likelyKnownFlake = !!expected && steps.length === 1 && steps[0].conclusion === 'failure' && expected.test((0, helper_values_1.text)(steps[0].name));
                    }
                }
                catch {
                    signal.throwIfAborted();
                    // Checks may be unreadable even with Actions access; still report the failed job.
                    likelyKnownFlake = false;
                }
            }
            return { jobs: [...new Set(failed.map(job => (0, helper_values_1.text)(job.name) || `Job ${job.id}`))], tests: [...tests].slice(0, 10), likelyKnownFlake };
        },
    };
}
