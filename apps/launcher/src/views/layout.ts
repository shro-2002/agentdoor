import { html, type SafeHtml } from "@agentdoor/ui";

export type PageName = "describe" | "rules" | "rehearsal" | "launch";

/**
 * The page shell. All visible text is drawn by the page script (it owns the EN / Hinglish / Hindi
 * string table), so this stays free of inline script and inline style for the strict CSP.
 */
export function pageShell(page: PageName): SafeHtml {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentDoor</title>
<meta name="color-scheme" content="light">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/tokens.css">
<link rel="stylesheet" href="/assets/ui.css">
<link rel="stylesheet" href="/assets/launcher.css">
</head>
<body class="page page--${page}">
<header class="topbar" id="chrome"></header>
<main id="main" tabindex="-1">
  <div id="live" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>
  <div id="app" class="container"></div>
</main>
<footer class="footer"><div class="container"><p id="footer-note"></p></div></footer>
<script type="module" src="/assets/${page}.js"></script>
</body>
</html>
`;
}
