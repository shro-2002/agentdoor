import { html, icon, type SafeHtml } from "@agentdoor/ui";

/** What the visitor typed in step 1, kept as plain strings so a refused quote re-fills the form. */
export interface OrderFormValues {
  qty: Record<string, string>;
  options: string[];
  date: string;
  fulfilment: "pickup" | "delivery";
  area: string;
  otherArea: string;
  notes: string;
}

export const OTHER_AREA = "__other";
export const DEMO_NOTE = "Demo shop — please don't enter real phone numbers.";

export const emptyValues = (): OrderFormValues => ({ qty: {}, options: [], date: "", fulfilment: "pickup", area: "", otherArea: "", notes: "" });

export type CheckoutStep = 1 | 2;

const STEP_LABELS = ["Choose", "Check the quote", "Request"];

/** The three-step progress line. Step 3 is the button on the quote page, so only 1 and 2 are ever current. */
export function stepper(current: CheckoutStep): SafeHtml {
  return html`<ol class="stepper" aria-label="Steps">${STEP_LABELS.map((label, i) => {
    const n = i + 1;
    const state = n < current ? "is-done" : "";
    const cur = n === current ? html`aria-current="step"` : html``;
    return html`<li class="${state}" ${cur}><span>${n < current ? "✓" : n}</span>${label}</li>`;
  })}</ol>`;
}

export const demoNote = (): SafeHtml => html`<p class="demo-note">${icon("alert")}<span>${DEMO_NOTE}</span></p>`;
