import { z } from "zod";
import { QuoteRequestSchema } from "@agentdoor/core";

const NAME_MAX = 60;
const ADDRESS_MAX = 200;
const NOTES_MAX = 500;
/** A signed token for 20 lines is a few KB; the 16 KB body limit bounds it anyway. */
const TOKEN_MAX = 8000;
/** E.164 (+ and 8-15 digits) or a 10-digit Indian mobile number. */
const PHONE_RE = /^(\+[1-9]\d{7,14}|[6-9]\d{9})$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

const phone = z.string().regex(PHONE_RE);
const noControlChars = (max: number) =>
  z.string().min(1).max(max).refine((s) => !CONTROL_CHARS_RE.test(s), { message: "control characters" });

const quoteToken = z.string().min(1).max(TOKEN_MAX);
const idempotencyKey = z.uuid();

/** REST body of `POST /api/orders` (04 §4). */
export const RestOrderSchema = z.strictObject({
  quoteToken,
  customer: z.strictObject({
    name: noControlChars(NAME_MAX),
    phone,
    address: z.string().max(ADDRESS_MAX).optional(),
  }),
  notes: z.string().max(NOTES_MAX).optional(),
  idempotencyKey,
});

/** MCP `place_order` input (04 §5). */
export const McpPlaceOrderSchema = z.strictObject({
  quoteToken,
  customerName: noControlChars(NAME_MAX),
  customerPhone: phone,
  deliveryAddress: z.string().max(ADDRESS_MAX).optional(),
  notes: z.string().max(NOTES_MAX).optional(),
  idempotencyKey,
});

export const ContactSchema = z.strictObject({
  name: noControlChars(NAME_MAX),
  email: z.email().max(120).refine((s) => !CONTROL_CHARS_RE.test(s)),
  message: z.string().min(1).max(2000),
  /** Honeypot: humans never see it, bots fill it. */
  website: z.string().max(200).optional(),
});

export const TransitionSchema = z.strictObject({ to: z.enum(["CONFIRMED", "DECLINED", "CANCELLED"]) });

/** Catalog and option ids are `^[a-z0-9-]+$` (04 §1): anything else is malformed, not "unknown item". */
const ID_RE = /^[a-z0-9-]+$/;

/** The engine's request schema plus the id charset, applied at every shop entry point. */
export const QuoteInputSchema = QuoteRequestSchema.refine((r) =>
  r.lines.every((l) => ID_RE.test(l.itemId) && l.optionIds.every((o) => ID_RE.test(o))),
);
