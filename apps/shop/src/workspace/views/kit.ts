import { html, raw, type SafeHtml } from "@agentdoor/ui";
import { brandMark } from "./icons.js";
import { assetUrl } from "../../views/asset-url.js";

export const FONT_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap";

export interface DocumentOptions {
  title: string;
  body: SafeHtml;
  bodyClass?: string;
  noindex?: boolean;
}

/** The workspace shell: its own stylesheet and one script, no inline code (strict CSP). */
export function pageDocument(o: DocumentOptions): string {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0B0B0F">
${o.noindex === false ? "" : raw('<meta name="robots" content="noindex">')}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_URL}">
<link rel="stylesheet" href="${assetUrl("workspace.css")}">
</head>
<body class="${o.bodyClass ?? ""}">
<a class="skip" href="#main">Skip to the content</a>
${o.body}
<script src="${assetUrl("workspace.js")}" defer></script>
</body>
</html>`.value;
}

export const brand = (href: string): SafeHtml => html`<a class="brand" href="${href}">${brandMark()}<span class="brand__word">AgentDoor</span></a>`;

export type Tone = "ok" | "warn" | "bad" | "info" | "mute";

export const badge = (tone: Tone, text: string): SafeHtml => html`<span class="badge badge--${tone}">${text}</span>`;

/** A POST form. There is no token: the server requires a same-origin Origin header on every POST. */
export const postForm = (action: string, inner: SafeHtml, className = ""): SafeHtml =>
  html`<form method="post" action="${action}" class="${className}">${inner}</form>`;

export const notice = (tone: Tone, text: string): SafeHtml => html`<p class="notice notice--${tone}" role="${tone === "bad" ? "alert" : "status"}">${text}</p>`;
