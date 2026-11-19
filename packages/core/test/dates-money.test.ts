import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  fulfilmentInstantMs,
  isValidLocalDate,
  istDateOf,
  percentOf,
  sumPaise,
  weekdayOf,
} from "../src/index.js";

describe("IST calendar math (fixed +05:30, no DST)", () => {
  it("istDateOf rolls the date at 18:30 UTC", () => {
    expect(istDateOf(Date.parse("2026-11-19T18:29:59Z"))).toBe("2026-11-19");
    expect(istDateOf(Date.parse("2026-11-19T18:30:00Z"))).toBe("2026-11-20");
  });
  it("fulfilment instant is 10:00 IST = 04:30 UTC", () => {
    expect(fulfilmentInstantMs("2026-11-21")).toBe(
      Date.parse("2026-11-21T04:30:00Z"),
    );
  });
  it("weekday and day arithmetic across month and year ends", () => {
    expect(weekdayOf("2026-11-23")).toBe(1);
    expect(weekdayOf("2026-11-22")).toBe(0);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-19", "2026-12-19")).toBe(30);
  });
  it("validates real calendar dates", () => {
    expect(isValidLocalDate("2028-02-29")).toBe(true);
    expect(isValidLocalDate("2026-02-29")).toBe(false);
    expect(isValidLocalDate("2026-13-01")).toBe(false);
    expect(isValidLocalDate("nope")).toBe(false);
  });
});

describe("money", () => {
  it("percentOf rounds half-up on basis points", () => {
    expect(percentOf(5000, 1)).toBe(1);
    expect(percentOf(4999, 1)).toBe(0);
    expect(percentOf(35000, 333)).toBe(1166);
    expect(percentOf(2_000_000_000_000, 100_000)).toBe(20_000_000_000_000); // beyond 2^53 intermediate
  });
  it("sumPaise adds ints", () => expect(sumPaise([1, 2, 3])).toBe(6));
});
