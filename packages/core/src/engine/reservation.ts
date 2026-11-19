import type { BusinessPolicy } from "../schema/policy.js";
import { capacityOn } from "./evaluate.js";

/** What one date has booked so far: the two counters the live shop keeps per date. */
export interface LedgerRow {
  reservedUnits: number;
  rushUnits: number;
}

/** The two ceilings for one date, taken from the policy. */
export interface ReservationCaps {
  unitsCap: number;
  rushCap: number;
}

export interface Reservation {
  units: number;
  rushUnits: number;
}

export type ReservationRefusal = "CAPACITY_FULL" | "RUSH_CAP_REACHED";

export type ReservationResult = { ok: true; row: LedgerRow } | { ok: false; code: ReservationRefusal };

export const emptyLedgerRow = (): LedgerRow => ({ reservedUnits: 0, rushUnits: 0 });

/** What a quoted order asks the ledger for: its units, and the same units again when it is a rush order. */
export const reservationOf = (units: number, isRush: boolean): Reservation => ({ units, rushUnits: isRush ? units : 0 });

/** The ceilings that apply on `date`: the day's limit (or its override) and the rush limit. */
export const capsFor = (policy: BusinessPolicy, date: string): ReservationCaps => ({
  unitsCap: capacityOn(policy, date),
  rushCap: policy.rush?.maxRushUnitsPerDay ?? 0,
});

/**
 * The booking rule, in one place. The shop's SQL `UPDATE ... WHERE reserved_units + ? <= ? AND
 * rush_units + ? <= ?` states the same condition and takes its parameters from `reservationOf` and
 * `capsFor`; a test runs both on one sequence so they cannot drift.
 */
export const fitsCaps = (row: LedgerRow, r: Reservation, caps: ReservationCaps): boolean =>
  row.reservedUnits + r.units <= caps.unitsCap && row.rushUnits + r.rushUnits <= caps.rushCap;

/** Which limit stopped a booking: the day's limit is reported first, as the shop does. */
export const refusalCode = (row: LedgerRow, r: Reservation, caps: ReservationCaps): ReservationRefusal =>
  row.reservedUnits + r.units > caps.unitsCap ? "CAPACITY_FULL" : "RUSH_CAP_REACHED";

/** Books one order against a date's counters, or says which limit refuses it. Never mutates `row`. */
export function reserve(row: LedgerRow, r: Reservation, caps: ReservationCaps): ReservationResult {
  if (!fitsCaps(row, r, caps)) return { ok: false, code: refusalCode(row, r, caps) };
  return { ok: true, row: { reservedUnits: row.reservedUnits + r.units, rushUnits: row.rushUnits + r.rushUnits } };
}
