import { finite, record } from '../core/helper-values';
import { escapeHtml } from '../core/helper-format';
import { stripAnsi } from './helper-format';

/*
 * OMP's ask tool (18.18.3+) asks with one agent-written HTML form. The bridge
 * sends the model OMP's own parser (@oh-my-pi/pi-tui html-form/parse.ts,
 * verified 18.18.6) reduced it to, never the markup; this module renders that
 * model with native controls and submits the data shape OMP's TUI dialog
 * submits (html-form/data.ts: choiceValue, textValue, fieldError).
 */
export type FormSpanStyle = 'code' | 'strong' | 'em';
export interface FormSpan { readonly text: string; readonly style: FormSpanStyle | null }
export interface FormChoiceOption { readonly value: string; readonly label: readonly FormSpan[]; readonly checked: boolean; readonly disabled: boolean }
export interface FormChoiceField {
  readonly kind: 'choice'; readonly name: string; readonly multi: boolean; readonly select: boolean; readonly other: boolean;
  readonly label: readonly FormSpan[]; readonly options: readonly FormChoiceOption[]; readonly required: boolean;
}
export interface FormTextField {
  readonly kind: 'text'; readonly name: string; readonly type: string; readonly multiline: boolean; readonly label: readonly FormSpan[];
  readonly value: string; readonly placeholder: string; readonly required: boolean; readonly rows: number;
  readonly min: number | null; readonly max: number | null; readonly pattern: string; readonly minLength: number | null; readonly maxLength: number | null;
}
export type FormField = FormChoiceField | FormTextField;
export type FormBlock =
  | { readonly kind: 'text'; readonly spans: readonly FormSpan[]; readonly heading: boolean }
  | { readonly kind: 'list'; readonly items: readonly (readonly FormSpan[])[]; readonly ordered: boolean }
  | { readonly kind: 'pre'; readonly text: string }
  | { readonly kind: 'table'; readonly rows: readonly (readonly (readonly FormSpan[])[])[]; readonly headerRows: number }
  | { readonly kind: 'image'; readonly src: string; readonly alt: string }
  | { readonly kind: 'field'; readonly field: FormField };
export interface FormSection { readonly title: readonly FormSpan[]; readonly blocks: readonly FormBlock[] }
/** `fields` holds every field block's field in document order; a field's index is its control id. */
export interface ExtensionForm { readonly sections: readonly FormSection[]; readonly fields: readonly FormField[]; readonly hidden: readonly (readonly [string, string])[] }
export type HtmlFormValue = string | number | string[];
export type HtmlFormData = Record<string, HtmlFormValue>;

const STYLES: Readonly<Record<string, FormSpanStyle>> = { code: 'code', strong: 'strong', em: 'em' };
const INPUT_TYPES: Readonly<Record<string, true>> = {
  text: true, number: true, email: true, url: true, tel: true, search: true, password: true,
  date: true, time: true, 'datetime-local': true, month: true, week: true, color: true, range: true,
};
const text = (value: unknown) => typeof value === 'string' ? stripAnsi(value) : '';
const optionalNumber = (value: unknown) => finite(value) ? value : null;

function spans(value: unknown): FormSpan[] {
  return Array.isArray(value) ? value.flatMap((row: unknown) => record(row)
    ? [{ text: text(row.text), style: typeof row.style === 'string' ? STYLES[row.style] ?? null : null }] : []) : [];
}

/** http(s) and inline image data only: local paths and `file:` URLs belong to the harness machine. */
function imageSource(value: string): string {
  if (/^data:image\//i.test(value)) return value;
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}

function decodeField(value: unknown): FormField | null {
  if (!record(value) || typeof value.name !== 'string') return null;
  if (value.kind === 'choice') {
    const options = Array.isArray(value.options) ? value.options.flatMap((row: unknown) => record(row) && typeof row.value === 'string'
      ? [{ value: row.value, label: spans(row.label), checked: row.checked === true, disabled: row.disabled === true }] : []) : [];
    return { kind: 'choice', name: value.name, multi: value.multi === true, select: value.select === true, other: value.other === true,
      label: spans(value.label), options, required: value.required === true };
  }
  if (value.kind !== 'text') return null;
  return { kind: 'text', name: value.name, type: text(value.type) || 'text', multiline: value.multiline === true, label: spans(value.label),
    value: text(value.value), placeholder: text(value.placeholder), required: value.required === true,
    rows: finite(value.rows) ? Math.min(Math.max(Math.round(value.rows), 1), 12) : 4,
    min: optionalNumber(value.min), max: optionalNumber(value.max), pattern: text(value.pattern),
    minLength: optionalNumber(value.minLength), maxLength: optionalNumber(value.maxLength) };
}

function decodeBlock(value: unknown): FormBlock | null {
  if (!record(value)) return null;
  switch (value.kind) {
    case 'text': return { kind: 'text', spans: spans(value.spans), heading: value.heading === true };
    case 'list': return { kind: 'list', items: Array.isArray(value.items) ? value.items.map(spans) : [], ordered: value.ordered === true };
    case 'pre': return { kind: 'pre', text: text(value.text) };
    case 'table': return { kind: 'table', rows: Array.isArray(value.rows) ? value.rows.map((row: unknown) => Array.isArray(row) ? row.map(spans) : []) : [],
      headerRows: finite(value.headerRows) ? value.headerRows : 0 };
    case 'image': return { kind: 'image', src: imageSource(text(value.src)), alt: text(value.alt) };
    // An <img> never runs an SVG's scripts.
    case 'svg': return { kind: 'image', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text(value.markup))}`, alt: text(value.alt) };
    case 'field': { const field = decodeField(value.field); return field ? { kind: 'field', field } : null; }
    default: return null;
  }
}

/** The `form` request's model, or null when it carries no sections. */
export function decodeExtensionForm(sections: unknown, hidden: unknown): ExtensionForm | null {
  if (!Array.isArray(sections)) return null;
  const decoded = sections.flatMap((row: unknown) => record(row)
    ? [{ title: spans(row.title), blocks: Array.isArray(row.blocks) ? row.blocks.flatMap((block: unknown) => decodeBlock(block) ?? []) : [] }] : []);
  return {
    sections: decoded,
    fields: decoded.flatMap(section => section.blocks.flatMap(block => block.kind === 'field' ? [block.field] : [])),
    hidden: Array.isArray(hidden) ? hidden.flatMap((pair: unknown) =>
      Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string' ? [[pair[0], pair[1]] as const] : []) : [],
  };
}

export function spansText(value: readonly FormSpan[]): string {
  return value.map(span => span.text).join('');
}

function spansHtml(value: readonly FormSpan[]): string {
  return value.map(span => {
    const html = escapeHtml(span.text).replace(/\n/g, '<br>');
    return span.style ? `<${span.style}>${html}</${span.style}>` : html;
  }).join('');
}

function fieldHtml(field: FormField, index: number): string {
  const label = field.label.length
    ? `<div class="ext-ui-form-label">${spansHtml(field.label)}${field.required ? ' <span class="ext-ui-form-required">*</span>' : ''}</div>` : '';
  let control: string;
  if (field.kind === 'text') {
    const common = `class="${field.multiline ? 'ext-ui-dialog-editor' : 'ext-ui-dialog-input'} ext-ui-form-control" data-field-index="${index}" placeholder="${escapeHtml(field.placeholder)}"`;
    control = field.multiline
      ? `<textarea ${common} rows="${field.rows}">${escapeHtml(field.value)}</textarea>`
      : `<input ${common} type="${Object.hasOwn(INPUT_TYPES, field.type) ? field.type : 'text'}" value="${escapeHtml(field.value)}"${field.min === null ? '' : ` min="${field.min}"`}${field.max === null ? '' : ` max="${field.max}"`}>`;
  } else if (field.select && !field.multi) {
    control = `<select class="ext-ui-dialog-input ext-ui-form-control" data-field-index="${index}">${field.options.map((option, optionIndex) =>
      `<option value="${optionIndex}"${option.checked ? ' selected' : ''}${option.disabled ? ' disabled' : ''}>${escapeHtml(spansText(option.label) || option.value)}</option>`).join('')}</select>`;
  } else {
    // Radio names group per card: each card is its own <form>.
    const type = field.multi ? 'checkbox' : 'radio';
    control = `<div class="ext-ui-form-choices">${field.options.map((option, optionIndex) =>
      `<label class="ext-ui-form-choice"><input type="${type}" name="f${index}" value="${optionIndex}"${option.checked ? ' checked' : ''}${option.disabled ? ' disabled' : ''}>
        <span>${spansHtml(option.label) || escapeHtml(option.value)}</span></label>`).join('')}${field.other
      ? `<label class="ext-ui-form-choice"><input type="${type}" name="f${index}" value="other"> <span>Other</span></label>
        <input class="ext-ui-dialog-input ext-ui-form-other" data-field-index="${index}" type="text" placeholder="Other (type your own)">` : ''}</div>`;
  }
  return `<div class="ext-ui-form-field">${label}${control}<div class="ext-ui-ask-error" data-field-error="${index}" hidden></div></div>`;
}

function blockHtml(block: FormBlock, form: ExtensionForm): string {
  switch (block.kind) {
    case 'text': return `<div class="${block.heading ? 'ext-ui-ask-prompt' : 'ext-ui-form-text'}">${spansHtml(block.spans)}</div>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag} class="ext-ui-form-text">${block.items.map(item => `<li>${spansHtml(item)}</li>`).join('')}</${tag}>`;
    }
    case 'pre': return `<pre class="ext-ui-ask-option-preview">${escapeHtml(block.text)}</pre>`;
    case 'table': return `<div class="ext-ui-form-table-wrap"><table class="ext-ui-form-table">${block.rows.map((row, rowIndex) => {
      const cell = rowIndex < block.headerRows ? 'th' : 'td';
      return `<tr>${row.map(content => `<${cell}>${spansHtml(content)}</${cell}>`).join('')}</tr>`;
    }).join('')}</table></div>`;
    case 'image': return block.src
      ? `<img class="ext-ui-form-image" src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}">`
      : `<div class="ext-ui-form-text">[image${block.alt ? `: ${escapeHtml(block.alt)}` : ''}]</div>`;
    case 'field': return fieldHtml(block.field, form.fields.indexOf(block.field));
  }
}

export function formBodyHtml(form: ExtensionForm): string {
  return `<form class="ext-ui-form" novalidate>${form.sections.map(section => `<section class="ext-ui-form-section">${section.title.length
    ? `<div class="ext-ui-ask-header">${spansHtml(section.title)}</div>` : ''}${section.blocks.map(block => blockHtml(block, form)).join('')}</section>`).join('')}</form>`;
}

/** First readable line of the form, for the minimized card. */
export function formSummary(form: ExtensionForm): string {
  for (const section of form.sections) {
    if (section.title.length) return spansText(section.title);
    for (const block of section.blocks) if (block.kind === 'text' && block.spans.length) return spansText(block.spans);
  }
  return '';
}

function isArrayChoice(field: FormChoiceField): boolean {
  return field.multi && field.options.length > 1;
}

function choiceValue(field: FormChoiceField, checked: ReadonlySet<number>, other?: string): HtmlFormValue | undefined {
  const typed = field.other ? other?.trim() : undefined;
  const values = field.options.flatMap((option, index) => checked.has(index) && !option.disabled ? [option.value] : []);
  if (isArrayChoice(field)) return typed ? [...values, typed] : values;
  return typed || values[0];
}

function textValue(field: FormTextField, value: string): HtmlFormValue {
  if ((field.type === 'number' || field.type === 'range') && value.trim() !== '') {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
}

function patternMatches(pattern: string, value: string): boolean {
  try { return new RegExp(`^(?:${pattern})$`, 'v').test(value); } catch { return true; }
}

function fieldError(field: FormField, value: HtmlFormValue | undefined): string | undefined {
  if (field.kind === 'choice') {
    const empty = value === undefined || (Array.isArray(value) && value.length === 0);
    if (!field.required || !empty) return undefined;
    return isArrayChoice(field) ? 'Select at least one' : 'Required';
  }
  const answer = value === undefined ? '' : String(value);
  if (answer.trim() === '') return field.required ? 'Required' : undefined;
  if (field.type === 'number' || field.type === 'range') {
    const number = Number(answer);
    if (!Number.isFinite(number)) return 'Enter a number';
    if (field.min !== null && number < field.min) return `Must be at least ${field.min}`;
    if (field.max !== null && number > field.max) return `Must be at most ${field.max}`;
  }
  if (field.minLength !== null && answer.length < field.minLength) return `Needs at least ${field.minLength} characters`;
  if (field.maxLength !== null && answer.length > field.maxLength) return `At most ${field.maxLength} characters`;
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+$/.test(answer)) return 'Enter an email address';
  if (field.type === 'url') { try { new URL(answer); } catch { return 'Enter a full URL'; } }
  if (field.pattern && !patternMatches(field.pattern, answer)) {
    return `Must match ${field.pattern.length > 40 ? `${field.pattern.slice(0, 39)}…` : field.pattern}`;
  }
  return undefined;
}

/** Submitted data and per-field errors (by field index) read from a rendered form. */
export function collectFormData(root: ParentNode, form: ExtensionForm): { data: HtmlFormData; errors: Map<number, string> } {
  const data: HtmlFormData = Object.fromEntries(form.hidden);
  const errors = new Map<number, string>();
  form.fields.forEach((field, index) => {
    if (!field.name) return;
    let value: HtmlFormValue | undefined;
    if (field.kind === 'text') {
      const control = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`.ext-ui-form-control[data-field-index="${index}"]`);
      value = textValue(field, control ? control.value : field.value);
    } else if (field.select && !field.multi) {
      const selected = Number(root.querySelector<HTMLSelectElement>(`.ext-ui-form-control[data-field-index="${index}"]`)?.value);
      value = choiceValue(field, new Set(Number.isInteger(selected) ? [selected] : []));
    } else {
      const checked = new Set<number>();
      let other: string | undefined;
      root.querySelectorAll<HTMLInputElement>(`input[name="f${index}"]:checked`).forEach(input => {
        if (input.value === 'other') other = root.querySelector<HTMLInputElement>(`.ext-ui-form-other[data-field-index="${index}"]`)?.value ?? '';
        else checked.add(Number(input.value));
      });
      value = choiceValue(field, checked, other);
    }
    const error = fieldError(field, value);
    if (error) errors.set(index, error);
    if (value !== undefined) data[field.name] = value;
  });
  return { data, errors };
}
