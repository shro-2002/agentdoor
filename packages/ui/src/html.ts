/** A string that is already safe to put in HTML. Only `html` and `raw` create one. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for element content and for quoted attribute values. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Marks trusted markup (our own SVG, already-built fragments). Never pass user text. */
export const raw = (markup: string): SafeHtml => new SafeHtml(markup);

function render(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  if (value === null || value === undefined || value === false || value === true) return "";
  return esc(value);
}

/**
 * Tagged template that escapes every interpolation unless it is a SafeHtml (or an array of them).
 * Always interpolate into quoted attributes: `class="${x}"`, never `class=${x}`.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? "";
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? "");
  });
  return new SafeHtml(out);
}

/** A DOM-id-safe slug of any string (gap ids contain `:`, rule paths contain `[]`). */
export function domId(text: string): string {
  return text.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}
