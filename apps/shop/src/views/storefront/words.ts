import type { BusinessPolicy } from "@agentdoor/core";
import { listWords } from "../format.js";

/** The compiler fills ownerFirstName with this placeholder when the owner gave no name. */
const PLACEHOLDER_OWNER = "owner";

/** Item words that read better as a family than as product names ("cakes", not "chocolate cake"). */
const FAMILIES: readonly [RegExp, string][] = [
  [/cupcake/i, "cupcakes"],
  [/cake|loaf/i, "cakes"],
  [/brownie/i, "brownies"],
  [/cookie|biscuit/i, "cookies"],
  [/laddoo|ladoo|barfi|sweet|mithai/i, "sweets"],
  [/bread/i, "breads"],
];

/** Who quotes and confirms: the owner's name, or "the baker" when the owner gave none. */
export function ownerName(policy: BusinessPolicy, capital = false): string {
  const raw = policy.business.ownerFirstName.trim();
  if (raw !== "" && raw.toLowerCase() !== PLACEHOLDER_OWNER) return raw;
  return capital ? "The baker" : "the baker";
}

/** "cakes, cookies and brownies": the menu in a few words, in catalog order, without repeats. */
export function menuWords(policy: BusinessPolicy): string {
  const words: string[] = [];
  for (const item of policy.catalog) {
    const name = item.name.en;
    const family = FAMILIES.find(([re]) => re.test(name))?.[1] ?? name.toLowerCase();
    if (!words.includes(family)) words.push(family);
  }
  return listWords(words);
}

/** Cake shops keep cake wording; others get neutral wording. */
export const sellsCakes = (policy: BusinessPolicy): boolean => policy.catalog.some((i) => /cake/i.test(i.name.en));
