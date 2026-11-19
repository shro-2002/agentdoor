import { raw, type SafeHtml } from "./html.js";

const ICON_SIZE = 20;

const PATHS = {
  door: '<path d="M6 21V4.5a1 1 0 0 1 .8-1l8-1.5a1 1 0 0 1 1.2 1V21"/><path d="M3 21h18"/><circle cx="13" cy="12.5" r=".6" fill="currentColor"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-1.9"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".6" fill="currentColor"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  truck: '<path d="M2 6h11v10H2zM13 9h4l3 3v4h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
  rupee: '<path d="M7 5h10M7 9h10M7 5c6 0 6 8 0 8h-.5l7.5 7"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  spinner: '<path d="M12 3a9 9 0 1 0 9 9"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Inline 20px SVG, decorative: every use sits next to a text label. */
export function icon(name: IconName, extraClass = ""): SafeHtml {
  const cls = `icon icon--${name}${extraClass ? ` ${extraClass}` : ""}`;
  return raw(
    `<svg class="${cls}" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`,
  );
}
