import { html, icon, raw, type SafeHtml } from "@agentdoor/ui";
import { EN, HI, HINGLISH, type Key } from "./strings.js";

/* ---------- storage (localStorage may be blocked: always try/catch) ---------- */
const LANG_KEY = "agentdoor.lang";
const SESSION_KEY = "agentdoor.session";

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the page still works for this visit */
  }
}

export type Lang = "en" | "hi" | "hinglish";
const LANGS: { id: Lang; label: string; htmlLang: string }[] = [
  { id: "en", label: "EN", htmlLang: "en" },
  { id: "hi", label: "हिंदी", htmlLang: "hi" },
  { id: "hinglish", label: "Hinglish", htmlLang: "en" },
];

let lang: Lang = ((): Lang => {
  const saved = readStore(LANG_KEY);
  return saved === "hi" || saved === "hinglish" ? saved : "en";
})();

export const getLang = (): Lang => lang;
/** Gap cards come from the server in English or Hinglish only. */
export const cardLang = (): "en" | "hinglish" => (lang === "en" ? "en" : "hinglish");
export const getSessionId = (): string | null => readStore(SESSION_KEY);
export const setSessionId = (id: string): void => writeStore(SESSION_KEY, id);

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const table = lang === "hi" ? (HI[key] ?? HINGLISH[key]) : lang === "hinglish" ? HINGLISH[key] : EN[key];
  return table.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name] ?? ""));
}

/* ---------- API ---------- */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  data: T | null;
  error: { code: string; message: string } | null;
  meta?: { requestId?: string };
}

export async function api<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let env: Envelope<T>;
  try {
    env = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError("BAD_RESPONSE", "The launcher sent something unreadable.", "", res.status);
  }
  if (env.error || env.data === null) {
    throw new ApiError(env.error?.code ?? "UNKNOWN", env.error?.message ?? "Unknown error", env.meta?.requestId ?? "", res.status);
  }
  return env.data;
}

export const errorText = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
export const errorId = (e: unknown): string => (e instanceof ApiError ? e.requestId : "");

/* ---------- live region ---------- */
export function announce(message: string): void {
  const el = document.getElementById("live");
  if (!el) return;
  el.textContent = "";
  // A tick between clearing and setting makes screen readers re-announce identical text.
  setTimeout(() => {
    el.textContent = message;
  }, 30);
}

/* ---------- formatting ---------- */
export const rupees = (paise: number): string => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/* ---------- view: state -> innerHTML with focus kept ---------- */
export interface View {
  update(): void;
}

/** Re-renders `root` from `render()` and puts focus back on the same control (matched by id or data-focus). */
export function createView(root: HTMLElement, render: () => SafeHtml, afterRender?: () => void): View {
  const update = (): void => {
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && root.contains(active) ? (active.id ? `#${active.id}` : active.dataset.focus ? `[data-focus="${active.dataset.focus}"]` : null) : null;
    const selection = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] : null;
    root.innerHTML = render().value;
    afterRender?.();
    if (focusKey) {
      const next = root.querySelector<HTMLElement>(focusKey);
      next?.focus({ preventScroll: true });
      if (next instanceof HTMLTextAreaElement && selection) next.setSelectionRange(selection[0] ?? null, selection[1] ?? null);
    }
  };
  return { update };
}

/** One delegated listener per event type; handlers look up `data-action`. */
export function onAction(root: HTMLElement, handler: (action: string, el: HTMLElement, ev: Event) => void): void {
  root.addEventListener("click", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (el && root.contains(el)) handler(el.dataset.action ?? "", el, ev);
  });
}

/* ---------- chrome: header, stepper, language switch, cost ---------- */
export type PageId = "describe" | "rules" | "rehearsal" | "launch";
const PAGES: { id: PageId; href: string; key: Key }[] = [
  { id: "describe", href: "/", key: "nav.describe" },
  { id: "rules", href: "/rules", key: "nav.rules" },
  { id: "rehearsal", href: "/rehearsal", key: "nav.rehearsal" },
  { id: "launch", href: "/launch", key: "nav.launch" },
];

const LOGO = raw(
  '<svg class="brand__logo" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false"><rect x="4" y="2" width="24" height="28" rx="3" class="brand__frame"/><path d="M9 6h10v20H9z" class="brand__leaf"/><circle cx="16.5" cy="16" r="1.6" class="brand__knob"/></svg>',
);

let costUsd: number | null = null;

function renderChrome(active: PageId): SafeHtml {
  return html`<a class="skip" href="#main">${t("nav.skip")}</a>
    <div class="topbar__in">
      <a class="brand" href="/">${LOGO}<span class="brand__name">AgentDoor</span></a>
      <nav aria-label="${t("nav.progress")}" class="stepper">
        <ol>
          ${PAGES.map(
            (p, i) => html`<li><a href="${p.href}" ${p.id === active ? raw('aria-current="step"') : ""}><span class="stepper__n">${i + 1}</span><span class="stepper__t">${t(p.key)}</span></a></li>`,
          )}
        </ol>
      </nav>
      <div class="topbar__tools">
        <p class="cost" id="cost">${t("cost.label", { usd: costUsd === null ? "$–" : `$${costUsd.toFixed(2)}` })}</p>
        <div class="langswitch" role="radiogroup" aria-label="${t("lang.label")}">
          ${LANGS.map(
            (l) => html`<button type="button" role="radio" class="langswitch__opt" aria-checked="${String(l.id === lang)}" tabindex="${l.id === lang ? 0 : -1}" data-lang="${l.id}" lang="${l.htmlLang}">${l.label}</button>`,
          )}
        </div>
      </div>
    </div>`;
}

export function mountChrome(active: PageId, onLangChange: () => void): void {
  const header = document.getElementById("chrome");
  if (!header) return;
  const draw = (): void => {
    document.documentElement.lang = LANGS.find((l) => l.id === lang)?.htmlLang ?? "en";
    header.innerHTML = renderChrome(active).value;
    const footer = document.getElementById("footer-note");
    if (footer) footer.textContent = t("footer.note");
  };
  const choose = (id: Lang): void => {
    lang = id;
    writeStore(LANG_KEY, id);
    draw();
    header.querySelector<HTMLElement>(`[data-lang="${id}"]`)?.focus();
    onLangChange();
  };
  header.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-lang]");
    if (btn) choose(btn.dataset.lang as Lang);
  });
  header.addEventListener("keydown", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-lang]");
    if (!btn || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(ev.key)) return;
    ev.preventDefault();
    const dir = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : -1;
    const idx = LANGS.findIndex((l) => l.id === btn.dataset.lang);
    choose(LANGS[(idx + dir + LANGS.length) % LANGS.length]!.id);
  });
  draw();
  void refreshCost(draw);
  window.addEventListener("agentdoor:cost", () => void refreshCost(draw));
}

export async function refreshCost(draw?: () => void): Promise<void> {
  try {
    const id = getSessionId();
    const usage = await api<{ totalUsd: number; sessionUsd: number | null }>("GET", `/api/usage${id ? `?sessionId=${encodeURIComponent(id)}` : ""}`);
    costUsd = usage.sessionUsd ?? usage.totalUsd;
    const el = document.getElementById("cost");
    if (el) el.textContent = t("cost.label", { usd: `$${costUsd.toFixed(2)}` });
    else draw?.();
  } catch {
    /* the meter is decoration: never block a page on it */
  }
}

export const pokeCost = (): void => void window.dispatchEvent(new Event("agentdoor:cost"));

/* ---------- shared fragments ---------- */
export function errorPanel(e: unknown, retryAction?: string): SafeHtml {
  const id = errorId(e);
  return html`<div class="alert alert--error" role="alert">
    ${icon("alert")}
    <div>
      <p class="alert__title">${t("common.error")}</p>
      <p>${errorText(e)}</p>
      ${id ? html`<p class="alert__code">${t("common.code", { id })}</p>` : ""}
      ${retryAction ? html`<p><button type="button" class="btn btn--secondary" data-action="${retryAction}">${t("common.retry")}</button></p>` : ""}
    </div>
  </div>`;
}

export const demoBanner = (): SafeHtml =>
  html`<p class="alert alert--note">${icon("alert")}<span>${t("banner.demo")}</span></p>`;

export async function isReplayMode(): Promise<boolean> {
  try {
    return (await api<{ mode: string }>("GET", "/api/status")).mode === "replay";
  } catch {
    return false;
  }
}

export function copyText(text: string): void {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => announce(t("common.copied")))
    .catch(() => announce(text));
}

export const pageTitle = (title: string, sub?: string): SafeHtml =>
  html`<div class="pagehead"><h1>${title}</h1>${sub ? html`<p class="pagehead__sub">${sub}</p>` : ""}</div>`;
