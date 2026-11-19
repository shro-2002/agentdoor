/**
 * Shop views use the same escaping `html` tag as packages/ui, so a component from the shared
 * package can be interpolated into a shop page without being escaped twice (SEC-5).
 */
export { SafeHtml as Safe, esc, html, raw } from "@agentdoor/ui";
export { layout, type LayoutOptions } from "./layout.js";
