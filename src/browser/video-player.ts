/**
 * Lightweight first-party video enhancement layered directly over native HTML5
 * `<video controls playsinline preload="metadata">`.
 *
 * Playback stays in the DOM; the controller remembers collapsed previews
 * across rebuilds of the same session's transcript and file views.
 */
import { escapeHtml } from '../core/helper-format';
import { mediaFileName, renderVideoSummary, videoMimeForPath } from '../core/helper-media';
import { findPathTokens } from './helper-markdown';
import { sessionRefKey } from './helper-identity';
import type { SessionState } from './session-state';

export const VIDEO_PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** Standard 30fps step (~33.3ms) used by frame-stepping controls. */
export const VIDEO_FRAME_STEP_SECONDS = 1 / 30;
const MAX_INLINE_VIDEOS_PER_BLOCK = 8;
const MAX_TOOL_OUTPUT_VIDEOS = 4;

export interface VideoPlayerRenderOptions {
  readonly src: string;
  readonly name?: string;
  readonly mimeType?: string | null;
  readonly variant: 'viewer' | 'inline';
  readonly filePath?: string | null;
  readonly inferred?: boolean;
  readonly title?: string | null;
  readonly sizeLabel?: string;
}

export interface VideoEnhanceContext {
  readonly host?: string | null;
  readonly sessionId?: string | null;
  readonly baseFilePath?: string | null;
}

export type RenderVideoPreview = (player: VideoPlayerRenderOptions, context?: VideoEnhanceContext) => string;

function sanitizeMediaSrc(raw: string): string {
  const trimmed = String(raw || '').trim();
  const scheme = trimmed.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (/^(javascript|vbscript):/.test(scheme)) return '#';
  if (scheme.startsWith('data:') && !/^data:video\/[a-z0-9.+-]+;base64,/i.test(scheme)) return '#';
  return trimmed;
}

function resolveRelativePosixPath(baseFilePath: string, rel: string): string {
  const dir = baseFilePath.includes('/') ? baseFilePath.slice(0, baseFilePath.lastIndexOf('/')) : '';
  const combined = rel.startsWith('/') ? rel : `${dir}/${rel}`;
  const out: string[] = [];
  for (const part of combined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

function formatVideoDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

function fallbackReason(code: number | undefined): string {
  if (code === 2) return 'Network error while loading this video.';
  if (code === 3) return 'This browser could not decode this video.';
  if (code === 4) return 'This browser cannot play this video format or codec.';
  return 'Unable to play this video in this browser.';
}

export function renderVideoPlayerHtml(options: VideoPlayerRenderOptions, state?: {
  scope: string; collapsed: boolean; detail: string;
}): string {
  const src = sanitizeMediaSrc(options.src);
  const name = (options.name || '').trim() || mediaFileName(options.filePath || src, 'video');
  const fileName = options.filePath || videoMimeForPath(src) ? mediaFileName(options.filePath || src, name) : name;
  const mime = (options.mimeType || videoMimeForPath(options.filePath || src) || '').trim();
  const isViewer = options.variant === 'viewer';
  const figureClass = isViewer ? 'video-player file-view-video-player' : 'video-player msg-video-player';
  const videoClass = isViewer ? 'video-el file-view-video' : 'video-el msg-video';
  const speedOptions = VIDEO_PLAYBACK_RATES.map(rate =>
    `<option value="${rate}"${rate === 1 ? ' selected' : ''}>${rate}×</option>`).join('');
  const openViewerBtn = !isViewer && options.filePath
    ? `<button type="button" class="video-btn video-open-viewer file-link" data-file-path="${escapeHtml(options.filePath)}" title="Open in file viewer" aria-label="Open in file viewer">⤢</button>`
    : '';
  const titleAttr = options.title ? ` title="${escapeHtml(options.title)}"` : '';
  const fileAttr = options.filePath ? ` data-video-file-path="${escapeHtml(options.filePath)}"` : '';
  const scopeAttr = state?.scope ? ` data-video-scope="${escapeHtml(state.scope)}"` : '';
  const inferredAttr = options.inferred ? ' data-video-inferred="1"' : '';
  const mimeDetail = mime ? `${name} (${mime})` : name;

  return `<figure class="${figureClass}" data-video-src="${escapeHtml(src)}" data-video-mime="${escapeHtml(mime)}" data-video-name="${escapeHtml(name)}"${fileAttr}${scopeAttr}${inferredAttr}>`
    + `<details class="video-disclosure"${state?.collapsed ? '' : ' open'}>`
    + renderVideoSummary(fileName, state?.detail || options.sizeLabel)
    + `<div class="video-stage">`
    + `<video class="${videoClass}" controls playsinline preload="metadata" src="${escapeHtml(src)}"${titleAttr}>`
    + `<a href="${escapeHtml(src)}" target="_blank" rel="noopener">Open ${escapeHtml(name)}</a>`
    + `</video>`
    + `<div class="video-fallback" hidden>`
    + `<div class="video-fallback-title">Video cannot be played here</div>`
    + `<div class="video-fallback-detail">${escapeHtml(mimeDetail)} — format or codec may not be supported by this browser.</div>`
    + `<div class="video-fallback-actions">`
    + `<a class="btn-small video-fallback-open" href="${escapeHtml(src)}" target="_blank" rel="noopener">Open</a>`
    + `<a class="btn-small video-fallback-download" href="${escapeHtml(src)}" download="${escapeHtml(name)}">Download</a>`
    + `</div></div></div>`
    + `<div class="video-toolbar">`
    + `<div class="video-controls">`
    + `<button type="button" class="video-btn video-step-back" title="Previous frame (,)" aria-label="Previous frame">-1f</button>`
    + `<button type="button" class="video-btn video-step-fwd" title="Next frame (.)" aria-label="Next frame">+1f</button>`
    + `<select class="video-speed" title="Playback speed" aria-label="Playback speed">${speedOptions}</select>`
    + openViewerBtn
    + `<a class="video-btn video-download" href="${escapeHtml(src)}" download="${escapeHtml(name)}" title="Download video" aria-label="Download video">↓</a>`
    + `</div></div></details></figure>`;
}

/** Pause active playback (and optionally abort/unload streams when closing a viewer). */
export function pauseAndUnloadVideos(root: ParentNode | null | undefined, { unload = false } = {}): void {
  if (!root) return;
  root.querySelectorAll<HTMLVideoElement>('video').forEach(video => {
    try { if (!video.paused) video.pause(); } catch {}
    if (unload) {
      video.removeAttribute('src');
      try { video.load(); } catch {}
    }
  });
}

function stepVideoFrame(video: HTMLVideoElement, direction: -1 | 1): void {
  try { if (!video.paused) video.pause(); } catch {}
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
  const next = Math.max(0, Math.min(duration, (Number.isFinite(video.currentTime) ? video.currentTime : 0) + direction * VIDEO_FRAME_STEP_SECONDS));
  try { video.currentTime = next; } catch {}
}

function showVideoFallback(player: HTMLElement, video: HTMLVideoElement): void {
  player.dataset.videoState = 'error';
  video.hidden = true;
  const fallback = player.querySelector<HTMLElement>('.video-fallback');
  if (fallback) {
    const detail = fallback.querySelector<HTMLElement>('.video-fallback-detail');
    const name = player.dataset.videoName || 'video';
    const mime = player.dataset.videoMime || '';
    const label = mime ? `${name} (${mime})` : name;
    if (detail) detail.textContent = `${label} — ${fallbackReason(video.error?.code)}`;
    fallback.hidden = false;
  }
  player.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('.video-step-back, .video-step-fwd, .video-speed')
    .forEach(control => { control.disabled = true; });
}

export function createVideoControls(options: {
  document: Document;
  sessionState?: SessionState;
  assetUrl?: (host: string | null | undefined, path: string) => string;
}) {
  const { document } = options;
  const events = new AbortController();
  const { signal } = events;
  let disposed = false;
  // Only explicitly collapsed previews need state. Paths survive cache-busting
  // changes in file-viewer URLs; external URLs are scoped to the owning host/session.
  const collapsed = new Map<string, string>();
  const identity = (scope: string, source: string) => JSON.stringify([scope, source]);
  function playerKey(player: HTMLElement): string {
    return identity(player.dataset.videoScope || '', player.dataset.videoFilePath || player.dataset.videoSrc || '');
  }
  function render(player: VideoPlayerRenderOptions, context?: VideoEnhanceContext): string {
    const scope = sessionRefKey(context?.sessionId
      ? { id: context.sessionId, host: context.host ?? null }
      : options.sessionState?.currentSession);
    const detail = collapsed.get(identity(scope, player.filePath || sanitizeMediaSrc(player.src)));
    return renderVideoPlayerHtml(player, { scope, collapsed: detail !== undefined, detail: detail || '' });
  }
  function buildPlayer(player: VideoPlayerRenderOptions, context?: VideoEnhanceContext): HTMLElement {
    const template = document.createElement('template');
    template.innerHTML = render(player, context);
    return template.content.firstElementChild as HTMLElement;
  }

  function sessionContentUrl(targetPath: string, context?: VideoEnhanceContext): string | null {
    const sessionId = context?.sessionId ?? options.sessionState?.currentSession?.id ?? null;
    if (!sessionId) return null;
    const host = context?.host !== undefined ? context.host : (options.sessionState?.currentSession?.host ?? null);
    const cleaned = targetPath.split(/[?#]/)[0].replace(/:\d+(?::\d+)?$/, '');
    const resolved = context?.baseFilePath ? resolveRelativePosixPath(context.baseFilePath, cleaned) : cleaned;
    const apiPath = `/api/sessions/${encodeURIComponent(sessionId)}/file/content?path=${encodeURIComponent(resolved)}`;
    return options.assetUrl ? options.assetUrl(host, apiPath) : apiPath;
  }

  function resolveSource(rawTarget: string, context?: VideoEnhanceContext): { src: string; filePath: string | null } | null {
    const trimmed = rawTarget.trim();
    if (!trimmed) return null;
    if (/^(?:https?:|blob:|\/\/|\/api\/|\/hosts\/)/i.test(trimmed)) {
      return { src: trimmed, filePath: null };
    }
    let localPath = trimmed;
    if (/^file:\/\//i.test(localPath)) {
      localPath = localPath.replace(/^file:\/\//i, '');
      try { localPath = decodeURIComponent(localPath); } catch {}
    }
    const cleanPath = localPath.split(/[?#]/)[0].replace(/:\d+(?::\d+)?$/, '');
    const src = sessionContentUrl(cleanPath, context);
    if (!src) return null;
    const filePath = context?.baseFilePath ? resolveRelativePosixPath(context.baseFilePath, cleanPath) : cleanPath;
    return { src, filePath };
  }

  function appendStrip(container: HTMLElement, cards: readonly HTMLElement[]): void {
    if (!cards.length) return;
    let strip = container.querySelector<HTMLElement>(':scope > .msg-videos');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'msg-videos';
      container.append(strip);
    }
    for (const card of cards) strip.append(card);
  }

  function enhanceToolPre(pre: HTMLElement, context?: VideoEnhanceContext): void {
    if (pre.dataset.videosEnhanced) return;
    const details = pre.closest<HTMLDetailsElement>('details.tool-result-details');
    if (details && !details.open) return;
    pre.dataset.videosEnhanced = '1';
    const text = pre.textContent || '';
    if (!/\.(?:mp4|m4v|webm|mov|ogv|mkv)\b/i.test(text)) return;
    const parent = pre.parentElement;
    if (!parent) return;
    const seen = new Set<string>();
    const cards: HTMLElement[] = [];
    for (const token of findPathTokens(text)) {
      if (token.artifact || cards.length >= MAX_TOOL_OUTPUT_VIDEOS) continue;
      const mimeType = videoMimeForPath(token.token);
      if (!mimeType) continue;
      const resolved = resolveSource(token.token, context);
      if (!resolved || seen.has(resolved.src)) continue;
      seen.add(resolved.src);
      cards.push(buildPlayer({
        src: resolved.src,
        name: mediaFileName(token.token),
        mimeType,
        variant: 'inline',
        filePath: resolved.filePath,
        inferred: true,
      }, context));
    }
    appendStrip(parent, cards);
  }

  function enhance(root: ParentNode, context?: VideoEnhanceContext): void {
    if (disposed) return;
    root.querySelectorAll<HTMLElement>('.markdown-body:not([data-videos-enhanced])').forEach(body => {
      body.dataset.videosEnhanced = '1';
      const seen = new Set<string>();

      // 1. Upgrade markdown image syntax pointing to video files (`![Demo](clip.mp4)`).
      for (const img of Array.from(body.querySelectorAll<HTMLImageElement>('img[src]'))) {
        const rawSrc = (img.getAttribute('src') || '').trim();
        const fileHint = img.dataset.filePath || rawSrc;
        const mimeType = videoMimeForPath(fileHint) || videoMimeForPath(rawSrc);
        if (!mimeType) continue;
        const resolved = img.dataset.filePath && /^(?:\/api\/|\/hosts\/|https?:)/i.test(rawSrc)
          ? { src: rawSrc, filePath: img.dataset.filePath }
          : resolveSource(fileHint, context);
        if (!resolved) continue;
        seen.add(resolved.src);
        const player = buildPlayer({
          src: resolved.src,
          name: img.alt.trim() || mediaFileName(resolved.filePath || rawSrc),
          mimeType,
          variant: 'inline',
          filePath: resolved.filePath,
          inferred: false,
          title: img.title || null,
        }, context);
        img.replaceWith(player);
      }

      // 2. Attach inline players for video links and video file paths in prose.
      const cards: HTMLElement[] = [];
      const addTarget = (rawTarget: string, label: string, inferred: boolean) => {
        if (cards.length >= MAX_INLINE_VIDEOS_PER_BLOCK) return;
        const mimeType = videoMimeForPath(rawTarget);
        if (!mimeType) return;
        const resolved = resolveSource(rawTarget, context);
        if (!resolved || seen.has(resolved.src)) return;
        seen.add(resolved.src);
        cards.push(buildPlayer({
          src: resolved.src,
          name: label || mediaFileName(rawTarget),
          mimeType,
          variant: 'inline',
          filePath: resolved.filePath,
          inferred,
        }, context));
      };

      body.querySelectorAll<HTMLElement>('.file-link').forEach(link => {
        if (link.closest('.video-player, pre')) return;
        const target = (link.dataset.filePath || link.textContent || '').trim();
        if (!videoMimeForPath(target)) return;
        link.title = 'Open video';
        const isExplicitAnchor = link.tagName === 'A';
        const label = isExplicitAnchor && link.textContent?.trim()
          ? link.textContent.trim()
          : mediaFileName(target);
        addTarget(target, label, !isExplicitAnchor);
      });

      body.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(link => {
        if (link.closest('.video-player, pre') || link.classList.contains('file-link') || link.classList.contains('published-link')) return;
        const href = (link.getAttribute('href') || '').trim();
        if (!/^(?:https?:|\/api\/|\/hosts\/)/i.test(href)) return;
        if (!videoMimeForPath(href)) return;
        const text = (link.textContent || '').trim();
        const label = text && text !== href ? text : mediaFileName(href);
        addTarget(href, label, false);
      });

      appendStrip(body, cards);
    });

    // 3. Tool output `<pre>` paths (only when the tool result is open, so collapsed tools don't fetch metadata).
    root.querySelectorAll<HTMLElement>('.tool-result-content > pre:not([data-videos-enhanced])').forEach(pre => {
      enhanceToolPre(pre, context);
    });
  }

  // Lazy enhancement when a collapsed tool result containing a video path is opened.
  document.addEventListener('toggle', event => {
    if (disposed || !(event.target instanceof HTMLDetailsElement)) return;
    if (!event.target.open || !event.target.classList.contains('tool-result-details')) return;
    const pre = event.target.querySelector<HTMLElement>('.tool-result-content > pre:not([data-videos-enhanced])');
    if (pre) enhanceToolPre(pre);
  }, { capture: true, signal });

  document.addEventListener('click', event => {
    if (disposed || !(event.target instanceof Element)) return;
    const summary = event.target.closest('.video-summary');
    const disclosure = summary?.parentElement;
    const player = disclosure?.parentElement;
    if (disclosure instanceof HTMLDetailsElement && player?.classList.contains('video-player')) {
      // Commit the preference in the same event as the interaction, before a
      // streaming update can replace the disclosure and lose its toggle event.
      event.preventDefault();
      disclosure.open = !disclosure.open;
      const key = playerKey(player);
      if (disclosure.open) collapsed.delete(key);
      else {
        const video = disclosure.querySelector('video');
        if (video && !video.paused) video.pause();
        collapsed.set(key, video ? formatVideoDuration(video.duration) : '');
      }
      return;
    }
    const back = event.target.closest<HTMLButtonElement>('.video-step-back');
    const fwd = back ? null : event.target.closest<HTMLButtonElement>('.video-step-fwd');
    if (back || fwd) {
      const video = (back || fwd)!.closest('.video-player')?.querySelector<HTMLVideoElement>('video.video-el');
      if (video) stepVideoFrame(video, back ? -1 : 1);
      return;
    }
    const openViewer = event.target.closest<HTMLElement>('.video-open-viewer');
    if (openViewer) {
      const video = openViewer.closest('.video-player')?.querySelector<HTMLVideoElement>('video.video-el');
      try { if (video && !video.paused) video.pause(); } catch {}
    }
  }, { signal });

  document.addEventListener('change', event => {
    if (disposed || !(event.target instanceof HTMLSelectElement) || !event.target.classList.contains('video-speed')) return;
    const video = event.target.closest('.video-player')?.querySelector<HTMLVideoElement>('video.video-el');
    const rate = Number(event.target.value);
    if (video && Number.isFinite(rate) && rate > 0) video.playbackRate = rate;
  }, { signal });

  document.addEventListener('keydown', event => {
    if (disposed || (event.key !== ',' && event.key !== '.')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('input, textarea, select')) return;
    const player = target.closest('.video-player');
    if (!player) return;
    const video = player.querySelector<HTMLVideoElement>('video.video-el');
    if (!video || video.hidden || !video.closest<HTMLDetailsElement>('.video-disclosure')?.open) return;
    event.preventDefault();
    stepVideoFrame(video, event.key === ',' ? -1 : 1);
  }, { signal });

  document.addEventListener('loadedmetadata', event => {
    if (disposed || !(event.target instanceof HTMLVideoElement) || !event.target.classList.contains('video-el')) return;
    const video = event.target;
    const player = video.closest<HTMLElement>('.video-player');
    if (!player) return;
    player.dataset.videoState = 'ready';
    video.hidden = false;
    const fallback = player.querySelector<HTMLElement>('.video-fallback');
    if (fallback) fallback.hidden = true;
    player.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('.video-step-back, .video-step-fwd, .video-speed')
      .forEach(control => { control.disabled = false; });
    const duration = formatVideoDuration(video.duration);
    const detail = player.querySelector('.video-detail');
    if (detail && duration) {
      detail.textContent = duration;
      if (!video.closest<HTMLDetailsElement>('.video-disclosure')?.open) {
        const key = playerKey(player);
        if (collapsed.has(key)) collapsed.set(key, duration);
      }
    }
    const resolution = player.querySelector('.video-resolution');
    if (resolution && video.videoWidth > 0 && video.videoHeight > 0) {
      resolution.textContent = `${video.videoWidth}×${video.videoHeight}`;
    }
  }, { capture: true, signal });

  document.addEventListener('ratechange', event => {
    if (disposed || !(event.target instanceof HTMLVideoElement) || !event.target.classList.contains('video-el')) return;
    const select = event.target.closest('.video-player')?.querySelector<HTMLSelectElement>('.video-speed');
    if (!select) return;
    const value = String(event.target.playbackRate);
    if ([...select.options].some(opt => opt.value === value)) select.value = value;
  }, { capture: true, signal });

  document.addEventListener('error', event => {
    if (disposed || !(event.target instanceof HTMLVideoElement) || !event.target.classList.contains('video-el')) return;
    const video = event.target;
    const src = (video.getAttribute('src') || '').trim();
    if (!src) return; // Unloaded intentionally (e.g. closing the file viewer).
    const player = video.closest<HTMLElement>('.video-player');
    if (!player) return;
    // Inferred prose/tool-output paths that don't actually exist on disk (404)
    // collapse quietly so example filenames in text never leave broken cards.
    if (player.dataset.videoInferred === '1' && /\/file\/content\?/.test(src)) {
      void fetch(src, { method: 'HEAD', credentials: 'same-origin', signal }).then(response => {
        if (disposed || !player.isConnected || video.getAttribute('src') !== src) return;
        if (response.status === 404) {
          const strip = player.parentElement;
          player.remove();
          if (strip?.classList.contains('msg-videos') && !strip.children.length) strip.remove();
          return;
        }
        showVideoFallback(player, video);
      }, () => {
        if (!disposed && player.isConnected && video.getAttribute('src') === src) {
          showVideoFallback(player, video);
        }
      });
      return;
    }
    showVideoFallback(player, video);
  }, { capture: true, signal });

  return {
    enhance,
    render,
    dispose() {
      disposed = true;
      events.abort();
      collapsed.clear();
    },
  };
}
