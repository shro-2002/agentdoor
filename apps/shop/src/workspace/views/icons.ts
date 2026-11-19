import { raw, type SafeHtml } from "@agentdoor/ui";

/** One icon set for the whole workspace: 24px grid, round caps, a single 1.5px stroke (kept at any size by CSS). */
const PATHS = {
  overview: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  setup: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  products: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  rules: '<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6l7-3z"/><path d="M9 12l2.2 2.2L15 10.4"/>',
  rehearse: '<path d="M9.5 3h5M10 3v6L5.2 17.5A2 2 0 0 0 7 20.5h10a2 2 0 0 0 1.8-3L14 9V3"/><path d="M8 14h8"/>',
  storefront: '<path d="M4 9.5L5.2 4h13.6L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20"/>',
  build: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  launch: '<path d="M21 3L10 14"/><path d="M21 3l-6.5 18-4.5-7-7-4.5L21 3z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  sparkle: '<path d="M11 3.5l1.9 5.6 5.6 1.9-5.6 1.9L11 18.5l-1.9-5.6L3.5 11l5.6-1.9L11 3.5z"/><path d="M19 15v5M16.5 17.5h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  retry: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4 4v4.5h4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  desktop: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16v.01"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  pencil: '<path d="M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19l-4 1z"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  message: '<path d="M4 5.5h16V16H9.5L5 19.5V16H4V5.5z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Decorative: always aria-hidden, so the text next to it carries the meaning. */
export const icon = (name: IconName, className = ""): SafeHtml =>
  raw(`<svg class="icon${className ? ` ${className}` : ""}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`);

/** The AgentDoor mark: a rounded tile with a doorway. */
export const brandMark = (): SafeHtml =>
  raw('<svg class="brand__mark" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><rect width="24" height="24" rx="7" fill="currentColor"/><path d="M8 18.5V11a4 4 0 0 1 8 0v7.5" fill="none" stroke="#0B0B0F" stroke-width="1.5" stroke-linecap="round"/><circle cx="13.6" cy="14.4" r="0.9" fill="#0B0B0F"/></svg>');
