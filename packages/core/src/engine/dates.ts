/** IST is a fixed +05:30 with no DST, so plain integer arithmetic is exact. */
const IST_OFFSET_MIN = 330;
const FULFILMENT_HOUR_IST = 10;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const LOCAL_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export const HOUR_MS = MS_PER_HOUR;
export const MINUTE_MS = MS_PER_MINUTE;

const utcMidnight = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const toLocalDate = (utcMs: number): string =>
  new Date(utcMs).toISOString().slice(0, 10);

/** The IST calendar date that contains the instant `ms`. */
export const istDateOf = (ms: number): string =>
  toLocalDate(ms + IST_OFFSET_MIN * MS_PER_MINUTE);

/** Orders are fulfilled at 10:00 IST on their date (04:30 UTC). */
export const fulfilmentInstantMs = (date: string): number =>
  utcMidnight(date) +
  FULFILMENT_HOUR_IST * MS_PER_HOUR -
  IST_OFFSET_MIN * MS_PER_MINUTE;

/** 0 = Sunday .. 6 = Saturday. */
export const weekdayOf = (date: string): number =>
  new Date(utcMidnight(date)).getUTCDay();

export const addDays = (date: string, days: number): string =>
  toLocalDate(utcMidnight(date) + days * MS_PER_DAY);

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number =>
  Math.round((utcMidnight(to) - utcMidnight(from)) / MS_PER_DAY);

/** True only for real calendar dates ("2026-02-30" is rejected). */
export function isValidLocalDate(date: string): boolean {
  if (!LOCAL_DATE_SHAPE.test(date)) return false;
  const ms = utcMidnight(date);
  return !Number.isNaN(ms) && toLocalDate(ms) === date;
}
