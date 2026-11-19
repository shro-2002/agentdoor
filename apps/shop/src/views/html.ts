/** Marks a string as already-safe HTML. Only this module and view code may create one. */
export class Safe {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]!);

type Interpolation = Safe | string | number | boolean | null | undefined | Interpolation[];

function render(value: Interpolation): string {
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return esc(value);
}

/**
 * Auto-escaping template tag (SEC-5). Every interpolation is escaped unless it is a `Safe`
 * produced by another `html` call, so customer-controlled text can never become markup.
 */
export function html(strings: TemplateStringsArray, ...values: Interpolation[]): Safe {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return new Safe(out);
}

export interface LayoutOptions {
  title: string;
  body: Safe;
  banner?: string;
}

/** Bare shell; T11 replaces it with the styled version. No inline script or style (CSP). */
export function layout({ title, body, banner }: LayoutOptions): string {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body>
${banner ? html`<p role="alert"><strong>${banner}</strong></p>` : ""}
<main>
${body}
</main>
</body>
</html>`.value;
}
