import type { SessionState } from './session-state';
import type { RenderMessage, MessageUsage } from './message-data';
import { decodeRenderMessage } from './message-data';
import type { ResponseMode } from './display-preferences';
import { sessionRefKey } from './helper-identity';
import { escapeHtml, formatResponseMetadata, formatDuration, formatTokSpeed, formatTokens, formatEstimatedCost } from './helper-format';
interface Detail { key: string | null; selectedModel: string; usage?: MessageUsage; durationMs?: number; outputTokens?: number; provider?: string; model?: string; responseModel?: string; stopReason?: string; pricingKnown: boolean }
export function createResponseDetails(options: { document: Document; sessionState: SessionState; mode: () => ResponseMode }) {
  const { document, sessionState } = options;
  const responseDetails = new Map<string, Detail>(); let responseDetailSeq = 0, disposed = false;
  const lifetime = new AbortController();
  const key = () => sessionState.currentSession ? sessionRefKey(sessionState.currentSession) : null;
  const model = () => sessionState.currentSession?.model ?? '';
  const current = (detail: Detail) => !disposed && detail.key === key();
  function button(value: unknown) {
    if (disposed) return ''; const message = decodeRenderMessage(value), detail = responseDetailProjection(message), id = `response-${++responseDetailSeq}`;
    responseDetails.set(id, detail); if (responseDetails.size > 2000) { const first = responseDetails.keys().next().value; if (first) responseDetails.delete(first); }
    const metadata = formatResponseMetadata(detail, options.mode());
    return `<button type="button" class="message-speed message-metadata-btn" data-detail-id="${id}" title="Response details. Response time is request start to JSONL append; effective speed includes time to first token."${metadata ? '' : ' style="display:none"'}>${escapeHtml(metadata || '')}</button>`;
  }
function updateRenderedResponseMetadata() {
  if (disposed) return;
  document.querySelectorAll<HTMLElement>('.message-metadata-btn').forEach(btn => {
    const text = formatResponseMetadata(responseDetails.get(btn.dataset.detailId || ''), options.mode());
    btn.textContent = text || '';
    btn.style.display = text ? '' : 'none';
  });
}

function responsePricingKnown(msg: Detail | RenderMessage | null) {
  return Number.isFinite(msg?.usage?.cost?.total);
}

function responseDetailProjection(msg: RenderMessage): Detail {
  return {
    key: key(), selectedModel: model(), usage: msg.usage,
    durationMs: msg.durationMs,
    outputTokens: msg.outputTokens,
    provider: msg.provider,
    model: msg.model,
    responseModel: msg.responseModel,
    stopReason: msg.stopReason,
    pricingKnown: responsePricingKnown(msg),
  };
}

function refreshResponsePricingState() {
  if (disposed) return;
  for (const detail of responseDetails.values()) detail.pricingKnown = responsePricingKnown(detail);
  updateRenderedResponseMetadata();
}

function openResponseDetails(id: string) {
  const m = responseDetails.get(id); if (!m || !current(m)) return;
  const u = m.usage || {}, c = u.cost || {};
  const selected = m.model || m.selectedModel || '—';
  const model = m.responseModel || selected;
  const prompt = (u.input||0)+(u.cacheRead||0)+(u.cacheWrite||0);
  const modelRows = m.responseModel && m.responseModel !== selected
    ? [['Selected model', selected], ['Response model', model]]
    : [['Model', model]];
  const rows = [
    ...modelRows, ['Provider', m.provider || '—'],
    ['Response time', m.durationMs ? formatDuration(m.durationMs) : '—'],
    ['Effective speed', formatTokSpeed(m.outputTokens || u.output, m.durationMs) || '—'],
    ['Tokens', `${formatTokens(u.input)} input · ${formatTokens(u.output)} output${u.reasoning ? ` · ${formatTokens(u.reasoning)} reasoning` : ''}`],
    ['Cache', `${formatTokens(u.cacheRead)} read · ${formatTokens(u.cacheWrite)} write${prompt ? ` · ${Math.round((u.cacheRead||0)/prompt*100)}% hit` : ''}`],
    ['Estimated input', formatEstimatedCost(c.input)],
    ['Estimated output', formatEstimatedCost(c.output)],
    ['Estimated cache read / write', `${formatEstimatedCost(c.cacheRead)} / ${formatEstimatedCost(c.cacheWrite)}`],
    ['Estimated total', formatEstimatedCost(c.total)], ['Stop reason', m.stopReason || '—'],
  ];
  document.getElementById('responseDetailsBody')!.innerHTML = '<div class="telemetry-note">Pi catalog estimates, not provider-billed amounts. Response time is request start → JSONL append; effective speed includes TTFT.</div><table class="stats-table">' + rows.map(([k,v]) => `<tr><td class="stats-key">${escapeHtml(k)}</td><td class="stats-val">${escapeHtml(v)}</td></tr>`).join('') + '</table>';
  document.getElementById('responseDetailsModal')!.style.display = 'flex';
}
function closeResponseDetails() { document.getElementById('responseDetailsModal')!.style.display = 'none'; }

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return; const button = event.target.closest<HTMLElement>('.message-metadata-btn');
    if (button?.isConnected && button.dataset.detailId) openResponseDetails(button.dataset.detailId);
  }, { signal: lifetime.signal });
  return { button, update: updateRenderedResponseMetadata, refreshPricing: refreshResponsePricingState, open: openResponseDetails, close: closeResponseDetails,
    get size() { return responseDetails.size; }, dispose() { if (disposed) return; closeResponseDetails(); disposed = true; lifetime.abort(); responseDetails.clear(); } };
}
