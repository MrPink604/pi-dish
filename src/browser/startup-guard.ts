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
  view.addEventListener('error', event => {
    const target = event.target;
    if (event instanceof ErrorEvent || (target instanceof HTMLScriptElement && new URL(target.src).pathname.endsWith('/app.js'))) {
      signalBootFailed(document);
    }
  }, { capture: true, signal });
  view.addEventListener('unhandledrejection', () => signalBootFailed(document), { signal });
  // A pre-upgrade bundle doesn't announce readiness. Catch its deferred startup
  // exceptions, but don't turn later runtime errors into startup failures.
  view.addEventListener('load', () => {
    if (!started) view.setTimeout(() => { if (!started) lifetime.abort(); }, 0);
  }, { once: true, signal });
}
