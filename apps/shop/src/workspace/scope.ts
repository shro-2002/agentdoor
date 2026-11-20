/**
 * Early access covers home bakeries: the storefront, its photos and its copy are bakery-specific
 * ("baked to order", "fresh from the oven"). A description that names no baked goods is turned away
 * before any draft or Claude call, so a tailor never receives a cake shop. Deterministic on purpose.
 */
const BAKED_GOODS_LATIN =
  /\b(bak(e|es|ed|er|ers|ery|eries|ing)|ovens?|(cup|cheese|pan)?cakes?|cookies?|biscuits?|brownies?|breads?|buns?|pastr(y|ies)|muffins?|pies?|tarts?|croissants?|doughnuts?|donuts?|macarons?|rusks?|loa(f|ves)|pizzas?|khari|nankhatai)\b/iu;
const BAKED_GOODS_DEVANAGARI = ["केक", "कुकी", "कुकीज़", "बिस्कुट", "ब्राउनी", "ब्रेड", "पेस्ट्री", "मफिन", "बेकिंग", "बेकरी", "ओवन", "नानखटाई"];

export const OUT_OF_SCOPE_MESSAGE =
  "AgentDoor's early access is for home bakeries. Tell me what you bake (cakes, cookies, brownies, breads), where you sell, and how you take orders.";

export function mentionsBakedGoods(description: string): boolean {
  const text = description.normalize("NFC");
  return BAKED_GOODS_LATIN.test(text) || BAKED_GOODS_DEVANAGARI.some((word) => text.includes(word));
}
