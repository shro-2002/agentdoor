import { addDays, evaluate, istDateOf, type BusinessPolicy, type QuoteRequest } from "@agentdoor/core";

const SEARCH_DAYS = 30;

/**
 * A request the engine itself says is QUOTED: first catalog item that works, pickup, the nearest
 * open date. Derived from the bundled policy so the smoke test never hard-codes a bakery.
 */
export function findSmokeRequest(policy: BusinessPolicy, nowMs: number): QuoteRequest | null {
  const today = istDateOf(nowMs);
  for (const item of policy.catalog) {
    for (let d = 1; d <= SEARCH_DAYS; d++) {
      const request: QuoteRequest = {
        lines: [{ itemId: item.id, qty: item.minQty, optionIds: [] }],
        fulfilment: { kind: "pickup" },
        date: addDays(today, d),
      };
      if (evaluate(policy, request, nowMs).outcome === "QUOTED") return request;
    }
  }
  return null;
}
