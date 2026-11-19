import { z } from "zod";
import { LONG_TEXT_MAX, LocalDateSchema } from "../schema/common.js";
import { isValidLocalDate } from "./dates.js";

const MAX_LINES = 20;
const MAX_QTY = 1000;
const MAX_ID = 60;
const MAX_AREA = 80;

const LineSchema = z.strictObject({
  itemId: z.string().min(1).max(MAX_ID),
  qty: z.number().int().min(1).max(MAX_QTY),
  optionIds: z
    .array(z.string().min(1).max(MAX_ID))
    .max(MAX_LINES)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "duplicate option",
    }),
});

const FulfilmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pickup") }),
  z.strictObject({
    kind: z.literal("delivery"),
    area: z.string().max(MAX_AREA),
  }),
]);

export const QuoteRequestSchema = z.strictObject({
  lines: z.array(LineSchema).min(1).max(MAX_LINES),
  fulfilment: FulfilmentSchema,
  date: LocalDateSchema.refine(isValidLocalDate, {
    message: "not a calendar date",
  }),
  /** Accepted and size-limited but NEVER interpreted by the engine. */
  notes: z.string().max(LONG_TEXT_MAX).optional(),
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;
