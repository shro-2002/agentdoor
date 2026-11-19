import { describe, expect, it } from "vitest";
import type { BusinessPolicy } from "@agentdoor/core";
import { menuWords, ownerName, sellsCakes } from "../src/views/storefront/words.js";

const policyWith = (ownerFirstName: string, names: string[]): BusinessPolicy =>
  ({ business: { ownerFirstName }, catalog: names.map((en) => ({ name: { en } })) }) as unknown as BusinessPolicy;

describe("storefront wording comes from the policy", () => {
  it("uses the owner's name, or 'the baker' for an empty or placeholder name", () => {
    expect(ownerName(policyWith("Meera", []))).toBe("Meera");
    expect(ownerName(policyWith("Owner", []))).toBe("the baker");
    expect(ownerName(policyWith(" ", []), true)).toBe("The baker");
  });

  it("describes the menu by family, in catalog order, without repeats", () => {
    const meera = policyWith("Meera", ["Chocolate cake", "Eggless vanilla cake", "Cookie box", "Brownies"]);
    expect(menuWords(meera)).toBe("cakes, cookies and brownies");
    expect(sellsCakes(meera)).toBe(true);
    const gifts = policyWith("Owner", ["Fudge brownie box", "Cookie hamper"]);
    expect(menuWords(gifts)).toBe("brownies and cookies");
    expect(sellsCakes(gifts)).toBe(false);
  });
});
