import { raw, type SafeHtml } from "@agentdoor/ui";

/**
 * Small original SVG ornaments, drawn by hand with loose, slightly uneven strokes. They only decorate
 * (aria-hidden) and take their colour from the surrounding text colour, so CSS themes them.
 */
const svg = (cls: string, viewBox: string, size: [number, number], body: string): SafeHtml =>
  raw(
    `<svg class="${cls}" viewBox="${viewBox}" width="${size[0]}" height="${size[1]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`,
  );

/** A swirl of piped frosting inside a soft badge. */
export const brandMark = (): SafeHtml =>
  svg("brand__mark", "0 0 40 40", [40, 40], '<circle cx="20" cy="20" r="19" class="orn-fill" stroke="none"/><path d="M11 26c0-6 4-11 10-11 4 0 7 2.6 7 6 0 3-2.2 5-4.8 5-2.2 0-4-1.6-4-3.6 0-1.6 1.2-2.8 2.8-2.8"/><path d="M12 30h16"/>');

/** A wobbly hand-drawn line to end a section heading. */
export const wave = (): SafeHtml =>
  svg("orn orn--wave", "0 0 200 14", [200, 14], '<path d="M2 8c9-7 17 5 27 0s17 6 27 0 18 5 28-1 17 6 27 1 18 5 28-1 17 5 26 0"/>');

/** A little sprig of leaves, for corners and between short phrases. */
export const sprig = (): SafeHtml =>
  svg("orn orn--sprig", "0 0 48 48", [48, 48], '<path d="M8 40C16 30 24 20 40 8"/><path d="M17 31c-1-6 1-10 6-12M24 23c0-6 3-9 8-10M13 36c-5-1-8-4-9-9"/>');
