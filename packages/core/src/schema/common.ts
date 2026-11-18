import { z } from "zod";

export const MAX_PAISE = 100_000_000; // ₹10 lakh: far above any home-bakery price, blocks overflow games
export const SHORT_TEXT_MAX = 200;
export const LONG_TEXT_MAX = 500;
const LOCAL_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const text = (max: number = SHORT_TEXT_MAX) =>
  z.string().min(1).max(max);

export const LangSchema = z.enum(["en", "hi", "hinglish"]);
export type Lang = z.infer<typeof LangSchema>;

export const PaiseSchema = z.number().int().min(0).max(MAX_PAISE);
export const LocalDateSchema = z.string().regex(LOCAL_DATE_RE);
export const HHMMSchema = z.string().regex(HHMM_RE);

export const LocalizedSchema = z.strictObject({
  en: text(),
  hi: text().optional(),
});
export type Localized = z.infer<typeof LocalizedSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
