// Generated from src/core/knowledge.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeError = exports.KNOWLEDGE_SETTING = void 0;
exports.knowledgePagePath = knowledgePagePath;
exports.searchPages = searchPages;
exports.stampEntry = stampEntry;
exports.openKnowledgeBase = openKnowledgeBase;
/**
 * The knowledge base: topic pages in a Git repository, kept as a working clone
 * at `~/.pi/dish/knowledge`. The remote comes from `knowledgeRemote` in this
 * machine's `~/.pi/dish/settings.json`; without one the feature is off.
 *
 * Pages are Markdown, one per topic, under `topics/`, and `index.md` holds one
 * line per page. pi-dish is the only committer: a write pulls, commits with the
 * writer's name in the message, and pushes. A push that fails leaves its commit
 * in the clone, and the next write pushes it with its own; the write succeeds
 * either way. Search is plain text search over the clone, with no index.
 */
const fs = require("fs");
const path = require("path");
const child_process_1 = require("child_process");
exports.KNOWLEDGE_SETTING = 'knowledgeRemote';
const INDEX = 'index.md';
const TOPICS = 'topics';
const PAGE_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SEARCH_PAGES = 20;
const SEARCH_LINES_PER_PAGE = 5;
const SEARCH_LINE_CHARS = 300;
const GIT_TIMEOUT_MS = 60_000;
/** A request the knowledge base refuses; `status` is the HTTP answer. */
class KnowledgeError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
exports.KnowledgeError = KnowledgeError;
/** The repository path a page name means; the index for an empty name. */
function knowledgePagePath(page) {
    const name = String(page ?? '').trim().replace(/^\/+/, '');
    if (!name || name === 'index' || name === INDEX)
        return INDEX;
    const slug = name.replace(/^topics\//, '').replace(/\.md$/, '');
    if (!PAGE_RE.test(slug)) {
        throw new KnowledgeError(`"${page}" is not a page name: use lowercase letters, digits and hyphens, such as "beelink" or "backups".`, 400);
    }
    return `${TOPICS}/${slug}.md`;
}
/** Pages that hold every term (case-insensitive), with the lines holding any of them. */
function searchPages(pages, query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length)
        throw new KnowledgeError('search needs at least one term', 400);
    const matched = pages.filter(page => {
        const text = page.text.toLowerCase();
        return terms.every(term => text.includes(term));
    });
    const results = matched.slice(0, SEARCH_PAGES).map(page => ({
        path: page.path,
        lines: page.text.split('\n').flatMap((text, index) => {
            const lower = text.toLowerCase();
            return terms.some(term => lower.includes(term)) ? [{ line: index + 1, text: text.slice(0, SEARCH_LINE_CHARS) }] : [];
        }).slice(0, SEARCH_LINES_PER_PAGE),
    }));
    return { results, total: matched.length };
}
function oneLine(value) {
    return value.replace(/\s+/g, ' ').trim();
}
/** An entry ends with its source, the day it was added and who added it. */
function stampEntry(text, source, author, day) {
    return `${text.trim()} (Source: ${oneLine(source).replace(/\.$/, '')}. Added ${day} by ${oneLine(author)}.)`;
}
function openKnowledgeBase({ remote, dir, today = () => new Date().toISOString().slice(0, 10) }) {
    // One git operation at a time: a write is pull, commit and push in order.
    let queue = Promise.resolve();
    const serial = (work) => {
        const next = queue.then(work, work);
        queue = next.catch(() => { });
        return next;
    };
    let cloned = false;
    function git(args, cwd = dir) {
        return new Promise((resolve, reject) => {
            (0, child_process_1.execFile)('git', args, {
                cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 << 20,
                // Never wait on a password or host-key prompt: an unreachable remote fails fast. pi-dish
                // commits (and rebases unpushed commits) as itself; each commit's author is its writer.
                env: {
                    ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_COMMITTER_NAME: 'pi-dish', GIT_COMMITTER_EMAIL: 'bots@pi-dish.invalid',
                    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o ConnectTimeout=15',
                },
            }, (error, stdout, stderr) => {
                if (!error)
                    return resolve(stdout);
                reject(new Error(`git ${args[0]}: ${String(stderr).trim() || error.message}`));
            });
        });
    }
    async function ensureClone() {
        if (cloned)
            return;
        if (!fs.existsSync(path.join(dir, '.git'))) {
            fs.mkdirSync(path.dirname(dir), { recursive: true });
            try {
                await git(['-c', 'init.defaultBranch=main', 'clone', '-q', remote, dir], path.dirname(dir));
            }
            catch (error) {
                throw new KnowledgeError(`The knowledge base has no clone yet and ${remote} could not be cloned: ${error instanceof Error ? error.message : String(error)}`, 503);
            }
        }
        else if ((await git(['remote', 'get-url', 'origin']).catch(() => '')).trim() !== remote) {
            await git(['remote', 'set-url', 'origin', remote]).catch(() => git(['remote', 'add', 'origin', remote]));
        }
        cloned = true;
    }
    function pages() {
        const found = [];
        const index = path.join(dir, INDEX);
        if (fs.existsSync(index))
            found.push({ path: INDEX, text: fs.readFileSync(index, 'utf8') });
        let names = [];
        try {
            names = fs.readdirSync(path.join(dir, TOPICS)).filter(name => name.endsWith('.md')).sort();
        }
        catch { }
        for (const name of names)
            found.push({ path: `${TOPICS}/${name}`, text: fs.readFileSync(path.join(dir, TOPICS, name), 'utf8') });
        return found;
    }
    /** Adds the page's line to the index, creating the index when the repository has none. */
    function indexPage(rel, title) {
        const file = path.join(dir, INDEX);
        const body = (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Knowledge\n\nOne line per topic page.').trimEnd();
        if (body.includes(`](${rel})`))
            return;
        const lastLine = body.slice(body.lastIndexOf('\n') + 1);
        fs.writeFileSync(file, `${body}\n${lastLine.startsWith('- ') ? '' : '\n'}- [${oneLine(title)}](${rel})\n`);
    }
    /** Pushes every commit the remote lacks; a failure is reported, never thrown. */
    async function push() {
        try {
            await git(['push', '-q', '-u', 'origin', 'HEAD']);
            return { pushed: true };
        }
        catch (error) {
            return { pushed: false, pushError: error instanceof Error ? error.message : String(error) };
        }
    }
    return {
        remote,
        dir,
        search: query => serial(async () => {
            await ensureClone();
            return searchPages(pages(), query);
        }),
        read: page => serial(async () => {
            const rel = knowledgePagePath(page);
            await ensureClone();
            const file = path.join(dir, rel);
            if (!fs.existsSync(file)) {
                // A repository nobody has written to yet is empty, not missing.
                if (rel === INDEX)
                    return { path: INDEX, text: 'The knowledge base has no pages yet.\n' };
                throw new KnowledgeError(`There is no page ${rel}.`, 404);
            }
            return { path: rel, text: fs.readFileSync(file, 'utf8') };
        }),
        write: entry => serial(async () => {
            const rel = knowledgePagePath(entry.page);
            if (rel === INDEX)
                throw new KnowledgeError('index.md is kept by pi-dish: write to a topic page and its line is added for you.', 400);
            const author = oneLine(entry.author ?? '');
            if (!author)
                throw new KnowledgeError('a write needs its author', 400);
            if (!entry.text?.trim())
                throw new KnowledgeError('a write needs text', 400);
            if (entry.mode !== 'append' && entry.mode !== 'replace')
                throw new KnowledgeError('mode is append or replace', 400);
            if (entry.mode === 'append' && !entry.source?.trim())
                throw new KnowledgeError('an entry needs its source: where the fact comes from', 400);
            await ensureClone();
            // Up to date first; an unreachable remote leaves the clone as it is.
            await git(['pull', '-q', '--rebase']).catch(() => git(['rebase', '--abort']).catch(() => { }));
            const file = path.join(dir, rel);
            const created = !fs.existsSync(file);
            const slug = path.basename(rel, '.md');
            const title = oneLine(entry.title ?? '') || slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            fs.mkdirSync(path.dirname(file), { recursive: true });
            if (entry.mode === 'replace') {
                fs.writeFileSync(file, `${entry.text.trim()}\n`);
            }
            else {
                const stamped = stampEntry(entry.text, entry.source, author, today());
                fs.writeFileSync(file, created ? `# ${title}\n\n${stamped}\n` : `${fs.readFileSync(file, 'utf8').replace(/\s*$/, '\n\n')}${stamped}\n`);
            }
            if (created)
                indexPage(rel, title);
            // The clone is pi-dish's own: whatever is in it is committed, with whatever a crash left behind.
            await git(['add', '-A']);
            let commit = null;
            if ((await git(['status', '--porcelain'])).trim()) {
                const verb = entry.mode === 'replace' ? 'rewrite' : created ? 'start' : 'add to';
                await git(['commit', '-q', '--author', `${author} <bots@pi-dish.invalid>`, '-m', `${author}: ${verb} ${rel}`]);
                commit = (await git(['rev-parse', 'HEAD'])).trim();
            }
            return { path: rel, created, commit, ...await push() };
        }),
    };
}
