/** Stable reason codes (04 §2). UI text is keyed by these. */
export const REASON_CODES = [
  "UNKNOWN_ITEM",
  "QTY_BELOW_MIN",
  "QTY_ABOVE_MAX",
  "TOO_MANY_LINES",
  "CLOSED_DAY",
  "TOO_FAR_AHEAD",
  "LEAD_TIME_NOT_MET",
  "RUSH_APPLIED",
  "RUSH_NOT_OFFERED",
  "RUSH_CAP_REACHED",
  "AREA_NOT_SERVED",
  "AREA_NEEDS_OWNER",
  "DELIVERY_NOT_OFFERED",
  "BELOW_MIN_ORDER",
  "CUSTOM_REQUEST_NEEDS_OWNER",
  "CAPACITY_FULL",
  "QUOTE_EXPIRED",
  "QUOTE_INVALID",
  "QUOTE_STALE_POLICY",
  "QUOTE_ALREADY_USED",
  "IDEMPOTENCY_CONFLICT",
  "SHOP_NOT_LAUNCHED",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
  "RETRY_LATER",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export interface Reason {
  code: ReasonCode;
  params: Record<string, string | number>;
  /** Dotted path of the policy rule that produced the reason. */
  ruleRef: string;
}

export interface PricedLine {
  itemId: string;
  qty: number;
  unitPricePaise: number;
  optionsPaise: number;
  lineTotalPaise: number;
}

export type EngineOutcome = "QUOTED" | "REFUSED" | "NEEDS_OWNER";

export type EngineResult =
  | {
      outcome: "QUOTED";
      lines: PricedLine[];
      deliveryFeePaise: number;
      rushSurchargePaise: number;
      totalPaise: number;
      capacityUnits: number;
      isRush: boolean;
      reasons: Reason[];
    }
  | { outcome: "REFUSED"; reasons: Reason[] }
  | { outcome: "NEEDS_OWNER"; reasons: Reason[] };
