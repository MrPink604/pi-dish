// Generated test/tool from test/sse-reader.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sseReader = sseReader;
function sseReader(url) {
    const ctrl = new AbortController();
    const events = [];
    let notify = () => { };
    void (async () => {
        try {
            const res = await fetch(url, { signal: ctrl.signal });
            if (!res.body)
                throw new Error('SSE response has no body');
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buf += dec.decode(value, { stream: true });
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                    const chunk = buf.slice(0, i);
                    buf = buf.slice(i + 2);
                    const ev = { event: null, data: null };
                    for (const line of chunk.split('\n')) {
                        if (line.startsWith('event: '))
                            ev.event = line.slice(7);
                        else if (line.startsWith('data: ')) {
                            try {
                                ev.data = JSON.parse(line.slice(6));
                            }
                            catch { }
                        }
                    }
                    if (ev.event) {
                        events.push(ev);
                        notify();
                    }
                }
            }
        }
        catch { } // aborted on close()
    })();
    const waitFor = async (pred, timeout = 5000) => {
        const deadline = Date.now() + timeout;
        for (;;) {
            const hit = events.find(pred);
            if (hit)
                return hit;
            if (Date.now() > deadline)
                throw new Error('timed out waiting for SSE event');
            await new Promise(resolve => { notify = resolve; setTimeout(resolve, 100); });
        }
    };
    return { events, waitFor, close: () => ctrl.abort() };
}
