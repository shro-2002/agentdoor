/** 03 §5.3. Terminal states are immutable. */
export type OrderStatus = "PENDING_OWNER" | "CONFIRMED" | "DECLINED" | "CANCELLED";
export type OrderEvent = "confirm" | "decline" | "cancel";

interface Edge {
  to: OrderStatus;
  /** Declined and cancelled orders give their capacity units back in the same txn. */
  releasesCapacity: boolean;
}

const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderEvent, Edge>>> = {
  PENDING_OWNER: {
    confirm: { to: "CONFIRMED", releasesCapacity: false },
    decline: { to: "DECLINED", releasesCapacity: true },
  },
  CONFIRMED: { cancel: { to: "CANCELLED", releasesCapacity: true } },
  DECLINED: {},
  CANCELLED: {},
};

export type TransitionResult =
  | { ok: true; from: OrderStatus; to: OrderStatus; releasesCapacity: boolean }
  | { ok: false; code: "INVALID_TRANSITION"; from: OrderStatus; event: OrderEvent };

export function transition(from: OrderStatus, event: OrderEvent): TransitionResult {
  const edge = TRANSITIONS[from][event];
  return edge
    ? { ok: true, from, ...edge }
    : { ok: false, code: "INVALID_TRANSITION", from, event };
}

export const isTerminal = (s: OrderStatus): boolean =>
  Object.keys(TRANSITIONS[s]).length === 0;
