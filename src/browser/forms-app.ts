import { record } from '../core/helper-values';
import { errorMessage, readJson, responseError } from './api-client';

/* pi-dish's own view for answering a published page's form (`/forms/:token`).
 * It runs on the app origin, cannot be framed, and reads and submits through
 * the same-origin form API; the agent's sandboxed page only links here. Every
 * agent-authored string reaches the DOM as text. A submit carries the form's
 * fingerprint, the revision it was based on and a submission id that a retry
 * reuses, so a retry never sends twice and a stale view is refused. */

type Answer = string | string[] | boolean;
type Answers = Record<string, Answer | null>;
type Kind = 'choice' | 'multi' | 'bool' | 'text' | 'longtext';

interface Option { readonly value: string; readonly label: string; readonly image: string | null; readonly help: string | null }
interface Question {
  readonly id: string; readonly kind: Kind; readonly label: string; readonly help: string | null; readonly required: boolean;
  readonly default: Answer | null; readonly yes: string; readonly no: string; readonly placeholder: string | null;
  readonly options: readonly Option[];
}
type Section = { kind: 'question'; question: Question } | { kind: 'grid'; label: string; help: string | null; questions: readonly Question[] };
interface FormData { title: string | null; intro: string | null; submitLabel: string | null; sections: readonly Section[] }
interface Receipt { id: string; state: 'delivering' | 'delivered' | 'failed' | 'uncertain'; revision: number; acceptedAt: number; error: string | null }
interface FormState {
  title: string | null; pagePath: string; form: FormData | null; formErrors: readonly string[];
  fingerprint: string | null; revision: number;
  latest: { at: number; revision: number; fingerprint: string | null; answers: Answers } | null;
  /** Submissions after the latest delivered one that are still delivering or uncertain. */
  unresolved: readonly Receipt[];
}
/** A submit in flight, kept across reloads until it settles: a retry reuses its id. */
interface Pending { fingerprint: string; submissionId: string; expectedRevision: number; answers: Answers }

const KINDS: readonly string[] = ['choice', 'multi', 'bool', 'text', 'longtext'];
const RECEIPT_STATES: readonly string[] = ['delivering', 'delivered', 'failed', 'uncertain'];
const POLL_MS = 1000;
const POLL_LIMIT_MS = 90_000;

const text = (value: unknown): string | null => typeof value === 'string' ? value : null;

function answerValue(value: unknown): Answer | null {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : null;
}

function decodeAnswers(value: unknown): Answers | null {
  if (!record(value)) return null;
  return Object.fromEntries(Object.entries(value).map(([id, answer]) => [id, answerValue(answer)]));
}

function decodeOptions(value: unknown): Option[] | null {
  return Array.isArray(value) ? value.flatMap((option: unknown): Option[] =>
    record(option) && typeof option.value === 'string'
      ? [{ value: option.value, label: text(option.label) ?? option.value, image: text(option.image), help: text(option.help) }]
      : []) : null;
}

// A grid row without options of its own uses the grid's shared ones.
function decodeQuestion(value: unknown, shared: readonly Option[] = []): Question | null {
  if (!record(value) || typeof value.id !== 'string' || typeof value.kind !== 'string' || !KINDS.includes(value.kind)) return null;
  return {
    id: value.id, kind: value.kind as Kind, label: text(value.label) ?? value.id, help: text(value.help),
    required: value.required === true, default: answerValue(value.default),
    yes: text(value.yes) ?? 'yes', no: text(value.no) ?? 'no', placeholder: text(value.placeholder),
    options: decodeOptions(value.options) ?? shared,
  };
}

function decodeForm(value: unknown): FormData | null {
  if (!record(value) || !Array.isArray(value.sections)) return null;
  const sections = value.sections.flatMap((section: unknown): Section[] => {
    if (!record(section)) return [];
    if (section.kind === 'question') {
      const question = decodeQuestion(section.question);
      return question ? [{ kind: 'question', question }] : [];
    }
    const shared = decodeOptions(section.options) ?? [];
    const questions = Array.isArray(section.questions)
      ? section.questions.map(item => decodeQuestion(item, shared)).filter((item): item is Question => !!item) : [];
    return section.kind === 'grid' ? [{ kind: 'grid', label: text(section.label) ?? '', help: text(section.help), questions }] : [];
  });
  return { title: text(value.title), intro: text(value.intro), submitLabel: text(value.submitLabel), sections };
}

function decodeReceipt(value: unknown): Receipt | null {
  if (!record(value) || typeof value.id !== 'string' || typeof value.state !== 'string' || !RECEIPT_STATES.includes(value.state)
    || typeof value.revision !== 'number' || typeof value.acceptedAt !== 'number') return null;
  return { id: value.id, state: value.state as Receipt['state'], revision: value.revision, acceptedAt: value.acceptedAt, error: text(value.error) };
}

function decodeState(value: unknown): FormState | null {
  if (!record(value) || typeof value.pagePath !== 'string') return null;
  const latest = record(value.latest) && typeof value.latest.acceptedAt === 'number' && typeof value.latest.revision === 'number'
    ? { at: value.latest.acceptedAt, revision: value.latest.revision, fingerprint: text(value.latest.fingerprint),
      answers: decodeAnswers(value.latest.answers) ?? {} } : null;
  return {
    title: text(value.title), pagePath: value.pagePath, form: decodeForm(value.form),
    formErrors: Array.isArray(value.formErrors) ? value.formErrors.filter((item): item is string => typeof item === 'string') : [],
    fingerprint: text(value.fingerprint), revision: typeof value.revision === 'number' ? value.revision : 0,
    latest, unresolved: Array.isArray(value.unresolved) ? value.unresolved.map(decodeReceipt).filter((item): item is Receipt => !!item) : [],
  };
}

function sameAnswer(a: Answer | null, b: Answer | null): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? [...a].sort() : [];
    const right = Array.isArray(b) ? [...b].sort() : [];
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return (a ?? null) === (b ?? null);
}

function isEmpty(value: Answer | null): boolean {
  return value == null || (Array.isArray(value) && !value.length) || (typeof value === 'string' && !value.trim());
}

function display(question: Question, value: Answer | null): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? question.yes : question.no;
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  return value.length > 24 ? `${value.slice(0, 24)}…` : value;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', content: string | null = null): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== null) node.textContent = content;
  return node;
}

function storage(area: 'local' | 'session'): Storage | null {
  try { return area === 'local' ? localStorage : sessionStorage; } catch { return null; }
}

function readStored(key: string, area: 'local' | 'session' = 'local'): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(storage(area)?.getItem(key) || 'null');
    return record(value) ? value : null;
  } catch { return null; }
}

function store(key: string, value: unknown | null, area: 'local' | 'session' = 'local'): void {
  try {
    if (value === null) storage(area)?.removeItem(key);
    else storage(area)?.setItem(key, JSON.stringify(value));
  } catch { /* a full or disabled storage only costs the draft */ }
}

const delay = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

// randomUUID needs a secure context; plain-http LAN hosts have only getRandomValues.
const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');

// Review builds kept drafts (and once pending submits) in local storage, and a
// tab id in session storage; none of it is read any more.
function dropLegacyKeys(): void {
  try {
    const area = storage('local');
    for (let index = (area?.length ?? 0) - 1; index >= 0; index--) {
      const key = area?.key(index);
      if (key?.startsWith('pi-dish-form-')) area?.removeItem(key);
    }
    storage('session')?.removeItem('pi-dish-form-tab');
  } catch { /* nothing to clean in an unavailable storage */ }
}

function start(root: HTMLElement, token: string): void {
  const api = `/api/page-forms/${encodeURIComponent(token)}`;
  // The form API refuses callers that do not name themselves (see FORM_CLIENT_HEADER).
  const headers = { accept: 'application/json', 'X-Pi-Dish-Form-Client': 'view' };
  // A draft lives in this tab's session storage: it survives a reload, not
  // the tab closing, and a duplicated tab starts from its own copy.
  const draftKey = `pi-dish-form-draft:${token}`;
  // A submit in flight belongs to the tab that made it, also in session storage.
  const pendingKey = `pi-dish-form-pending:${token}`;
  dropLegacyKeys();

  function clearPending(id: string): void {
    if (readStored(pendingKey, 'session')?.submissionId === id) store(pendingKey, null, 'session');
  }

  function notice(message: string, tone: 'error' | '' = ''): void {
    const paragraph = element('p', tone ? 'pdf-error' : 'pdf-notice', message);
    root.replaceChildren(paragraph);
  }

  async function load(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(api, { headers });
    } catch (error) {
      return notice(`pi-dish could not be reached: ${errorMessage(error)}`, 'error');
    }
    const data = await readJson(response);
    if (response.status === 404) {
      return notice('There is no form to answer here: the page was unpublished, has no form, or its host\'s pi-dish cannot take answers yet.', 'error');
    }
    if (!response.ok) return notice(`The form could not be loaded: ${responseError(response, data)}`, 'error');
    const state = decodeState(data);
    if (!state) return notice('The form could not be read; reload the page.', 'error');
    render(state);
  }

  function render(state: FormState): void {
    const nav = element('div', 'pdf-app-nav');
    nav.append(element('h1', '', state.title || state.form?.title || 'Form'));
    const view = element('a', 'pdf-button', 'View the page');
    view.href = state.pagePath;
    nav.append(view);
    root.replaceChildren(nav);
    if (state.formErrors.length) {
      const box = element('div', 'pdf-error');
      box.append(element('strong', '', 'This page\'s form is invalid:'));
      const list = element('ul');
      for (const error of state.formErrors) list.append(element('li', '', error));
      box.append(list);
      root.append(box);
      return;
    }
    if (!state.form || !state.fingerprint) {
      root.append(element('p', 'pdf-error', 'This form has no session to deliver answers to.'));
      return;
    }
    mount(state, state.form, state.fingerprint);
  }

  function mount(state: FormState, data: FormData, fingerprint: string): void {
    const form = element('form', 'pdf');
    form.noValidate = true;
    root.append(form);
    if (data.title || data.intro) {
      const head = element('header', 'pdf-head');
      if (data.title) head.append(element('h2', '', data.title));
      if (data.intro) head.append(element('p', '', data.intro));
      form.append(head);
    }
    // The conflict notice sits at the top of the form body, never in the
    // sticky footer where Submit is: no click aimed at Submit can land on it.
    const conflictNotice = element('div', 'pdf-conflict');
    conflictNotice.setAttribute('role', 'alert');
    conflictNotice.tabIndex = -1;
    form.append(conflictNotice);
    const questions: Question[] = [];
    const fieldsets = new Map<string, HTMLFieldSetElement>();

    function controls(question: Question, index: number): HTMLElement {
      if (question.kind === 'text' || question.kind === 'longtext') {
        const input = question.kind === 'text' ? element('input', 'pdf-text') : element('textarea', 'pdf-text');
        if (input instanceof HTMLInputElement) { input.type = 'text'; input.maxLength = 1000; } else input.maxLength = 10000;
        if (question.placeholder) input.placeholder = question.placeholder;
        input.value = typeof question.default === 'string' ? question.default : '';
        return input;
      }
      const options: readonly Option[] = question.kind === 'bool'
        ? [{ value: 'true', label: question.yes, image: null, help: null }, { value: 'false', label: question.no, image: null, help: null }]
        : question.options;
      const defaults = question.default == null ? [] : Array.isArray(question.default) ? question.default : [String(question.default)];
      const box = element('div', options.some(option => option.image) ? 'pdf-opts pdf-images' : 'pdf-opts');
      for (const option of options) {
        const label = element('label', 'pdf-opt');
        const input = element('input');
        input.type = question.kind === 'multi' ? 'checkbox' : 'radio';
        if (question.kind === 'multi') label.dataset.multi = '';
        input.name = `pdq-${index}`;
        input.value = option.value;
        input.checked = defaults.includes(option.value);
        label.append(input);
        if (option.image) {
          const image = element('img');
          image.src = option.image;
          image.alt = option.label;
          image.loading = 'lazy';
          label.append(image);
        }
        const caption = element('span', 'pdf-opt-label', option.label);
        if (defaults.includes(option.value)) caption.append(' ', element('span', 'pdf-default', 'default'));
        label.append(caption);
        if (option.help) label.append(element('span', 'pdf-opt-help', option.help));
        box.append(label);
      }
      return box;
    }

    function question(item: Question): HTMLFieldSetElement {
      const fieldset = element('fieldset', 'pdf-q');
      fieldset.dataset.q = item.id;
      fieldset.dataset.kind = item.kind;
      const legend = element('legend');
      legend.append(element('span', 'pdf-id', item.id), ` ${item.label}`);
      if (item.required) legend.append(' ', element('span', 'pdf-req', 'required'));
      legend.append(element('span', 'pdf-flag', item.default == null ? 'changed' : `changed (default ${display(item, item.default)})`));
      fieldset.append(legend);
      if (item.help) fieldset.append(element('p', 'pdf-help', item.help));
      fieldset.append(controls(item, questions.length));
      questions.push(item);
      fieldsets.set(item.id, fieldset);
      return fieldset;
    }

    for (const section of data.sections) {
      if (section.kind === 'question') {
        const wrap = element('div', 'pdf-section');
        wrap.append(question(section.question));
        form.append(wrap);
        continue;
      }
      const wrap = element('section', 'pdf-section');
      wrap.append(element('h3', '', section.label));
      if (section.help) wrap.append(element('p', 'pdf-help', section.help));
      for (const item of section.questions) wrap.append(question(item));
      form.append(wrap);
    }
    const bar = element('div', 'pdf-bar');
    const summary = element('span', 'pdf-summary');
    const submit = element('button', 'pdf-submit', data.submitLabel || 'Submit');
    submit.type = 'submit';
    const status = element('span', 'pdf-status');
    status.setAttribute('role', 'status');
    const actions = element('div', 'pdf-actions');
    bar.append(summary, submit, status, actions);
    form.append(bar);

    let revision = state.revision;
    let latest = state.latest;
    let pending: Pending | null = null;
    // What the controls' answers were made on: the form and the revision. A
    // submit carries it, so the server refuses one made on a stale base.
    let basis = { fingerprint, revision: state.revision };
    const changedNote = () => (basis.fingerprint !== fingerprint || basis.revision !== revision
      ? ' The form changed since you started editing; check your answers.' : '');
    // Set by a stale or revision 409: Submit stays disabled, and only the
    // override in the conflict notice (never the Submit button) sends again.
    let conflict = false;

    function read(item: Question): Answer | null {
      const fieldset = fieldsets.get(item.id)!;
      if (item.kind === 'text' || item.kind === 'longtext') {
        const input = fieldset.querySelector('.pdf-text');
        return (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value : '') || null;
      }
      const checked = [...fieldset.querySelectorAll('input:checked')].flatMap(input => input instanceof HTMLInputElement ? [input.value] : []);
      if (item.kind === 'multi') return checked;
      if (!checked.length) return null;
      return item.kind === 'bool' ? checked[0] === 'true' : checked[0];
    }

    function write(item: Question, value: Answer | null): void {
      const fieldset = fieldsets.get(item.id)!;
      if (item.kind === 'text' || item.kind === 'longtext') {
        const input = fieldset.querySelector('.pdf-text');
        if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.value = typeof value === 'string' ? value : '';
        return;
      }
      const selected = Array.isArray(value) ? value : value == null ? [] : [String(value)];
      for (const input of fieldset.querySelectorAll('input')) input.checked = selected.includes(input.value);
    }

    const answers = (): Answers => Object.fromEntries(questions.map(item => [item.id, read(item)]));
    const differs = (a: Answers, b: Answers) => questions.some(item => !sameAnswer(a[item.id] ?? null, b[item.id] ?? null));

    function apply(values: Answers): void {
      for (const item of questions) if (Object.hasOwn(values, item.id)) write(item, values[item.id] ?? null);
    }

    function setStatus(message: string, tone: 'ok' | 'error' | 'warn' | '' = ''): void {
      status.textContent = message;
      if (tone) status.dataset.tone = tone; else delete status.dataset.tone;
    }

    function action(label: string, run: () => void): void {
      const button = element('button', 'pdf-button', label);
      button.type = 'button';
      button.addEventListener('click', () => { actions.replaceChildren(); run(); });
      actions.append(button);
    }

    function refresh(): Answers {
      const current = answers();
      const changed = questions.filter(item => item.default != null && !sameAnswer(current[item.id] ?? null, item.default));
      for (const item of questions) fieldsets.get(item.id)!.toggleAttribute('data-changed', changed.includes(item));
      const missing = questions.filter(item => item.required && isEmpty(current[item.id] ?? null));
      const parts = [changed.length
        ? `${changed.length} changed from default: ${changed.slice(0, 4).map(item => `${item.id} → ${display(item, current[item.id] ?? null)}`).join(', ')}${changed.length > 4 ? `, +${changed.length - 4} more` : ''}`
        : 'No changes from the defaults'];
      if (missing.length) parts.push(`${missing.length} required unanswered`);
      if (latest && differs(current, latest.answers)) parts.push('edited since submitting');
      summary.textContent = parts.join(' · ');
      submit.textContent = latest ? 'Submit revision' : data.submitLabel || 'Submit';
      submit.disabled = pending !== null || conflict;
      return current;
    }

    function submitted(at: number, number: number): string {
      const when = new Date(at).toLocaleString();
      return number > 1 ? `Submitted ${when} (revision ${number})` : `Submitted ${when}`;
    }

    // A receipt older than the revision this view loaded never moves the form
    // back. On this tab's own delivered receipt, a draft equal to what was sent
    // is done with; any other stays, with the controls, as it is (edits made
    // while that submit was pending move onto it; nothing else moves a base).
    function settle(sent: Pending, receipt: Receipt): void {
      pending = null;
      clearPending(sent.submissionId);
      if (receipt.state === 'delivered') {
        form.dataset.submitted = String(Math.max(revision, receipt.revision));
        if (receipt.revision < revision) {
          setStatus(`${submitted(receipt.acceptedAt, receipt.revision)} — delivered; revision ${revision} from another view is the current one.${changedNote()}`, 'ok');
        } else {
          // Equal: the view loaded after this very submission landed.
          if (receipt.revision > revision) {
            revision = receipt.revision;
            latest = { at: receipt.acceptedAt, revision: receipt.revision, fingerprint, answers: sent.answers };
          }
          const draft = readStored(draftKey, 'session');
          const values = draft ? decodeAnswers(draft.answers) : null;
          if (!draft || !values || !differs(values, sent.answers)) {
            apply(sent.answers);
            store(draftKey, null, 'session');
            basis = { fingerprint, revision };
          } else if (draft.fingerprint === sent.fingerprint && draft.revision === sent.expectedRevision) {
            basis = { fingerprint, revision };
            saveDraft();
          }
          setStatus(`${submitted(receipt.acceptedAt, receipt.revision)} — delivered to the agent`, 'ok');
        }
      } else if (receipt.state === 'failed') {
        setStatus(`Not sent: ${receipt.error || 'the agent did not take it'}`, 'error');
      } else {
        setStatus(`Delivery uncertain: ${receipt.error || 'no answer from the agent'}. It may already have these answers; check the session before sending again.`, 'warn');
        action('Send again anyway', () => { void begin(); });
      }
      refresh();
    }

    async function follow(sent: Pending, first: Receipt): Promise<void> {
      let receipt = first;
      const until = Date.now() + POLL_LIMIT_MS;
      while (receipt.state === 'delivering' && Date.now() < until) {
        setStatus('Delivering to the agent…');
        await delay(POLL_MS);
        const found = await lookup(sent.submissionId);
        if (found && found !== 'missing') receipt = found;
      }
      if (receipt.state === 'delivering') {
        setStatus('Still delivering; the agent has not taken it yet.', 'warn');
        action('Check again', () => { void follow(sent, receipt); });
        return;
      }
      settle(sent, receipt);
    }

    // A submission id's receipt; 'missing' only when the form API says it never
    // took that id; null when the answer is unknown (never read as a miss).
    async function lookup(id: string): Promise<Receipt | 'missing' | null> {
      try {
        const response = await fetch(`${api}/receipts/${encodeURIComponent(id)}`, { headers });
        const body = await readJson(response);
        if (response.ok && record(body)) return decodeReceipt(body.receipt);
        return response.status === 404 && record(body) && body.error === 'no such submission' ? 'missing' : null;
      } catch { return null; }
    }

    async function send(sent: Pending): Promise<void> {
      pending = sent;
      store(pendingKey, sent, 'session');
      refresh();
      setStatus('Sending…');
      // Until the server confirms or refuses this id, every retry reuses it:
      // the server answers a known id with its receipt, so it is never sent twice.
      const unconfirmed = (why: string) => {
        setStatus(`${why}. Retrying sends this same submission, never a second copy.`, 'error');
        action('Retry', () => { void send(sent); });
      };
      let response: Response;
      try {
        response = await fetch(api, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ submissionId: sent.submissionId, fingerprint: sent.fingerprint, expectedRevision: sent.expectedRevision, answers: sent.answers }),
        });
      } catch (error) {
        return unconfirmed(`pi-dish could not be reached (${errorMessage(error)})`);
      }
      const body = await readJson(response);
      const receipt = record(body) ? decodeReceipt(body.receipt) : null;
      if (receipt?.id === sent.submissionId && (response.status === 200 || response.status === 202)) return follow(sent, receipt);
      // Only the form API's own refusal ends this id: nothing was taken.
      const refused = [400, 401, 403, 404, 409, 413, 415].includes(response.status) && record(body) && typeof body.error === 'string';
      if (!refused) {
        // A success without a receipt, a proxy's page or a server error: ask whether this id was taken.
        const known = await lookup(sent.submissionId);
        if (known && known !== 'missing') return follow(sent, known);
        return unconfirmed(`Not confirmed: ${responseError(response, body)}`);
      }
      pending = null;
      clearPending(sent.submissionId);
      const code = record(body) ? body.code : null;
      if (code === 'stale' || code === 'revision') {
        // The answers stay on their stale base and Submit is disabled: going
        // over the newer answers takes the separate control in the notice.
        const current = code === 'revision' && record(body) && typeof body.revision === 'number' ? body.revision : revision;
        revision = current;
        conflict = true;
        const message = `Not sent: ${responseError(response, body)}. Your answers are still here; check them against the newer ones.`;
        setStatus(message, 'error');
        showConflict(message, code === 'stale', () => {
          conflict = false;
          basis = { fingerprint, revision: current };
          saveDraft();
          void begin();
        });
      } else {
        setStatus(`Not sent: ${responseError(response, body)}`, 'error');
      }
      refresh();
    }

    // The override starts disabled and only takes clicks a second after it
    // appears, so nothing from a click burst on Submit can reach it.
    const OVERRIDE_ARM_MS = 1000;
    function showConflict(message: string, reload: boolean, override: () => void): void {
      const button = element('button', 'pdf-button', 'Submit my answers over the newer ones');
      button.type = 'button';
      button.disabled = true;
      setTimeout(() => { button.disabled = false; }, OVERRIDE_ARM_MS);
      button.addEventListener('click', () => { conflictNotice.replaceChildren(); override(); });
      conflictNotice.replaceChildren(element('p', '', message), button);
      if (reload) {
        const again = element('button', 'pdf-button', 'Reload the form');
        again.type = 'button';
        again.addEventListener('click', () => { location.reload(); });
        conflictNotice.append(again);
      }
      conflictNotice.scrollIntoView({ block: 'start', behavior: 'smooth' });
      conflictNotice.focus({ preventScroll: true });
    }

    // This tab's submit from before a reload, reconciled under its own id; an
    // unknown answer leaves it pending, to be checked again.
    async function resume(sent: Pending): Promise<void> {
      const found = await lookup(sent.submissionId);
      if (found === null) {
        setStatus('The last submission could not be checked yet; it is kept and will never be sent twice.', 'warn');
        action('Check again', () => { void resume(sent); });
      } else if (found === 'missing') {
        await send(sent);
      } else {
        await follow(sent, found);
      }
    }

    async function begin(): Promise<void> {
      if (pending || conflict) return;
      const current = refresh();
      const missing = questions.filter(item => item.required && isEmpty(current[item.id] ?? null));
      if (missing.length) {
        setStatus(`Answer the required ${missing.length === 1 ? 'field' : 'fields'}: ${missing.map(item => item.id).join(', ')}`, 'error');
        fieldsets.get(missing[0].id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      actions.replaceChildren();
      const submissionId = randomId();
      await send({ fingerprint: basis.fingerprint, submissionId, expectedRevision: basis.revision, answers: current });
    }

    // The draft records what it was made on; it is never moved onto another
    // view's answers.
    function saveDraft(): void {
      store(draftKey, { fingerprint: basis.fingerprint, revision: basis.revision, answers: refresh() }, 'session');
    }
    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);
    form.addEventListener('submit', (event) => { event.preventDefault(); void begin(); });

    // Seed: defaults (rendered), then the last delivered answers if they were
    // given to this same form and recipient.
    if (latest && latest.fingerprint === fingerprint) {
      apply(latest.answers);
      form.dataset.submitted = String(latest.revision);
      setStatus(submitted(latest.at, latest.revision), 'ok');
    } else if (latest) {
      form.dataset.submitted = String(latest.revision);
      setStatus(`The form changed after the last submission (revision ${latest.revision}); its answers are not filled in.`, 'warn');
    }
    // Then this tab's draft, as it is, when the view mounts (after the form's
    // state is fetched, before any receipt lookup). Made on another revision
    // or form version, it keeps that base: the next submit carries it, and
    // the server's conflict check refuses it.
    const draft = readStored(draftKey, 'session');
    const draftValues = draft ? decodeAnswers(draft.answers) : null;
    if (draft && draftValues && typeof draft.fingerprint === 'string' && typeof draft.revision === 'number') {
      apply(draftValues);
      basis = { fingerprint: draft.fingerprint, revision: draft.revision };
    }
    refresh();

    // This tab's submit still unsettled from before a reload is reconciled
    // under its own id.
    const stored = readStored(pendingKey, 'session');
    const resumed = stored && stored.fingerprint === fingerprint && typeof stored.submissionId === 'string'
      && typeof stored.expectedRevision === 'number' ? decodeAnswers(stored.answers) : null;
    if (stored && resumed) {
      pending = { fingerprint, submissionId: String(stored.submissionId), expectedRevision: Number(stored.expectedRevision), answers: resumed };
      refresh();
      void resume(pending);
      return;
    }
    // This tab's submit from a view of an earlier version of this form: its
    // receipt is the whole answer. Once settled, or never taken, it goes; an
    // unknown answer leaves it.
    if (stored && typeof stored.submissionId === 'string') {
      const id = stored.submissionId;
      void lookup(id).then((found) => { if (found === 'missing' || (found && found.state !== 'delivering')) clearPending(id); });
    }
    if (draftValues) {
      const note = changedNote();
      if (note) setStatus(note.trim(), 'warn');
      else setStatus(latest ? `Draft restored · last ${submitted(latest.at, latest.revision).toLowerCase()}` : 'Draft restored');
    }
    // Any view, a fresh tab included, learns of a submission that has not settled.
    const unresolved = state.unresolved.at(-1);
    if (unresolved?.state === 'delivering') {
      setStatus(`A submission from ${new Date(unresolved.acceptedAt).toLocaleString()} is still being delivered…`, 'warn');
      void watch(unresolved);
    } else if (unresolved) {
      setStatus(`The submission from ${new Date(unresolved.acceptedAt).toLocaleString()} may not have reached the agent: `
        + `${unresolved.error || 'delivery was cut off'}. Check the session before sending again.`, 'warn');
      action('Send again anyway', () => { void begin(); });
    }

    // Another view's submission: when it settles, show the form as it then
    // stands; this tab's draft keeps its own base (see above).
    async function watch(receipt: Receipt): Promise<void> {
      let current = receipt;
      const until = Date.now() + POLL_LIMIT_MS;
      while (current.state === 'delivering' && Date.now() < until) {
        await delay(POLL_MS);
        const found = await lookup(current.id);
        if (found && found !== 'missing') current = found;
      }
      if (current.state !== 'delivering') void load();
    }
  }

  void load().catch((error: unknown) => { notice(`The form could not be shown: ${errorMessage(error)}`, 'error'); });
}

const root = document.getElementById('pdfApp');
const token = root?.dataset.token;
if (root && token) start(root, token);
