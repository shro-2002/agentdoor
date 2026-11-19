import { html, raw, type SafeHtml } from "@agentdoor/ui";
import { rupeesInput } from "./describe.js";
import { icon } from "./icons.js";

export const checked = (on: boolean): SafeHtml => (on ? raw(" checked") : raw(""));
export const selected = (on: boolean): SafeHtml => (on ? raw(" selected") : raw(""));

export const toggle = (name: string, label: string, on: boolean): SafeHtml =>
  html`<label class="check"><input type="checkbox" name="${name}"${checked(on)}><span>${label}</span></label>`;

export const toggleValue = (name: string, value: string, label: string, on: boolean): SafeHtml =>
  html`<label class="check"><input type="checkbox" name="${name}" value="${value}"${checked(on)}><span>${label}</span></label>`;

export const field = (id: string, label: string, control: SafeHtml, hint = ""): SafeHtml =>
  html`<div class="field"><label for="${id}">${label}</label>${control}${hint ? html`<p class="hint">${hint}</p>` : ""}</div>`;

export const input = (id: string, name: string, value: string | number, attrs = ""): SafeHtml =>
  html`<input id="${id}" class="input" name="${name}" value="${value}" ${raw(attrs)}>`;

export const num = (id: string, name: string, value: number, min: number, max: number): SafeHtml =>
  input(id, name, value, `type="number" inputmode="numeric" min="${min}" max="${max}" step="1" required`);

export const money = (id: string, name: string, paise: number): SafeHtml => input(id, name, rupeesInput(paise), 'type="text" inputmode="decimal" required');

export const select = (id: string, name: string, options: [string, string, boolean][]): SafeHtml =>
  html`<select id="${id}" class="input" name="${name}">${options.map(([v, label, on]) => html`<option value="${v}"${selected(on)}>${label}</option>`)}</select>`;

export const saveRow = (label = "Save"): SafeHtml => html`<div class="row"><button class="btn btn--primary" type="submit">${label}</button></div>`;

/** A closed-by-default edit form: the summary is a quiet button, the form opens in place. */
export function editBox(summary: string, form: SafeHtml): SafeHtml {
  return html`<details class="edit"><summary class="btn btn--sm btn--ghost">${icon("pencil")}<span>${summary}</span></summary><div class="edit__body">${form}</div></details>`;
}
