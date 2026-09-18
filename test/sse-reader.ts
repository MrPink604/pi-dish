/**
 * Minimal SSE client for tests: collects parsed events, lets tests await one
 * matching a predicate. close() aborts the fetch (the server sees the
 * connection drop). Not a test file — shared by the *.test.js suites.
 */
export interface TestSseEvent {
  event: string | null;
  data: unknown;
}

function sseReader(url: string) {
  const ctrl = new AbortController();
  const events: TestSseEvent[] = [];
  let notify = (): void => {};
  void (async () => {
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.body) throw new Error('SSE response has no body');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev: TestSseEvent = { event: null, data: null };
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) ev.event = line.slice(7);
            else if (line.startsWith('data: ')) {
              try { ev.data = JSON.parse(line.slice(6)); } catch {}
            }
          }
          if (ev.event) { events.push(ev); notify(); }
        }
      }
    } catch {} // aborted on close()
  })();
  const waitFor = async (pred: (event: TestSseEvent) => boolean, timeout = 5000): Promise<TestSseEvent> => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const hit = events.find(pred);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error('timed out waiting for SSE event');
      await new Promise<void>(resolve => { notify = resolve; setTimeout(resolve, 100); });
    }
  };
  return { events, waitFor, close: () => ctrl.abort() };
}

export { sseReader };
