// Boot status events let theme-prepaint.js (which runs before the application
// bundle) notice a failed start without sharing a global application object.
const STARTED_EVENT = 'pi-dish-boot-started';
const READY_EVENT = 'pi-dish-boot-ready';
const FAILURE_ID = 'piDishBootFailure';

/** Announce that the bundle parsed far enough to construct the application. */
export function signalBootStarted(document: Document): void {
  document.dispatchEvent(new Event(STARTED_EVENT));
}

/** Announce that asynchronous startup finished and the page is interactive. */
export function signalBootReady(document: Document): void {
  document.getElementById(FAILURE_ID)?.remove();
  document.dispatchEvent(new Event(READY_EVENT));
}

/** Does not depend on CSS, app bindings or a matching pre-paint script. */
export function signalBootFailed(document: Document): void {
  if (document.getElementById(FAILURE_ID)) return;
  const dialog = document.createElement('dialog');
  dialog.id = FAILURE_ID;
  dialog.className = 'startup-failure';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-labelledby', `${FAILURE_ID}Title`);
  const title = document.createElement('h2');
  title.id = `${FAILURE_ID}Title`;
  title.textContent = 'pi-dish failed to start';
  const reload = document.createElement('button');
  reload.className = 'btn btn-primary';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => document.location.reload());
  dialog.append(title, reload);
  (document.body || document.documentElement).append(dialog);
  dialog.showModal();
}

function isAppBundleScript(target: EventTarget | null, view: Window): boolean {
  if (!(target instanceof HTMLScriptElement) || !target.src) return false;
  try {
    const url = new URL(target.src, view.location.href);
    return url.origin === view.location.origin && url.pathname.endsWith('/app.js');
  } catch {
    return false;
  }
}

function isBootErrorEvent(event: ErrorEvent, view: Window): boolean {
  // ResizeObserver loop warnings are benign layout notifications, not boot failures.
  if (/^ResizeObserver loop\b/i.test(event.message || '')) return false;
  // Ignore errors thrown by browser extensions or cross-origin scripts.
  if (event.filename) {
    try {
      if (new URL(event.filename, view.location.href).origin !== view.location.origin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Show a self-contained failure surface with a real reload control. It is
 * installed by theme-prepaint.ts, before the deferred application bundle, so
 * a script that never loads or throws cannot leave a blank, silent shell.
 */
export function installStartupGuard(document: Document): void {
  const view = document.defaultView;
  if (!view) return;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let started = false;
  document.addEventListener(STARTED_EVENT, () => { started = true; }, { signal });
  document.addEventListener(READY_EVENT, () => lifetime.abort(), { signal });
  view.addEventListener('error', (event: Event) => {
    if (event instanceof ErrorEvent) {
      if (isBootErrorEvent(event, view)) signalBootFailed(document);
      return;
    }
    if (isAppBundleScript(event.target, view)) signalBootFailed(document);
  }, { capture: true, signal });
  // Once the bundle signals STARTED_EVENT, runApp() catches startApp() rejections
  // directly; don't let unrelated extension or background promise rejections brick boot.
  view.addEventListener('unhandledrejection', () => {
    if (!started) signalBootFailed(document);
  }, { signal });
  // A pre-upgrade bundle doesn't announce readiness. Catch its deferred startup
  // exceptions, but don't turn later runtime errors into startup failures.
  view.addEventListener('load', () => {
    if (!started) view.setTimeout(() => { if (!started) lifetime.abort(); }, 0);
  }, { once: true, signal });
}
