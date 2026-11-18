import { z } from "zod";
import {
  ConfidenceSchema,
  HHMMSchema,
  LangSchema,
  LocalDateSchema,
  LocalizedSchema,
  PaiseSchema,
  LONG_TEXT_MAX,
  SHORT_TEXT_MAX,
  text,
} from "./common.js";

const MAX_CATALOG = 30;
const MAX_AREAS = 50;
const MAX_PROVENANCE = 200;
const MAX_QTY = 1000;
const MAX_PREP_HOURS = 720;
const ID_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const idText = () => z.string().regex(ID_RE).max(60);
const hours = (max: number) => z.number().int().min(0).max(max);

export const OptionSchema = z.strictObject({
  id: idText(),
  label: LocalizedSchema,
  surchargePaise: PaiseSchema,
});

export const CatalogItemSchema = z
  .strictObject({
    id: idText(),
    name: LocalizedSchema,
    unit: z.enum(["piece", "kg", "box", "dozen"]),
    unitPricePaise: PaiseSchema.min(1),
    minQty: z.number().int().min(1).max(MAX_QTY),
    maxQtyPerOrder: z.number().int().min(1).max(MAX_QTY),
    prepHours: hours(MAX_PREP_HOURS),
    capacityUnitsPerQty: z.number().int().min(1).max(MAX_QTY),
    options: z.array(OptionSchema).max(20),
    dietary: z
      .array(z.enum(["eggless", "vegan", "contains_nuts", "gluten_free"]))
      .max(4),
  })
  .refine((i) => i.maxQtyPerOrder >= i.minQty, {
    message: "maxQtyPerOrder < minQty",
  });

export const DeliveryAreaSchema = z.strictObject({
  id: idText(),
  name: text(80),
  aliases: z.array(text(80)).max(10),
  feePaise: PaiseSchema,
});

const RushSchema = z.strictObject({
  withinHours: hours(336),
  surcharge: z.union([
    z.strictObject({ kind: z.literal("flat"), paise: PaiseSchema }),
    z.strictObject({
      kind: z.literal("percent"),
      bp: z.number().int().min(0).max(100_000),
    }),
  ]),
  maxRushUnitsPerDay: z.number().int().min(0).max(500),
});

export const RuleProvenanceSchema = z.strictObject({
  source: z.union([
    z.strictObject({
      kind: z.literal("transcript"),
      quote: text(LONG_TEXT_MAX),
      turn: z.number().int().min(0).max(1000),
    }),
    z.strictObject({
      kind: z.literal("owner_edit"),
      note: text(LONG_TEXT_MAX),
    }),
    z.strictObject({
      kind: z.literal("gap_fix"),
      gapId: text(80),
      note: text(LONG_TEXT_MAX),
    }),
  ]),
  readback: z.strictObject({ lang: LangSchema, text: text(LONG_TEXT_MAX) }),
  confidence: ConfidenceSchema,
  status: z.enum(["proposed", "approved"]),
  approvedAt: z.string().max(40).nullable(),
});
export type RuleProvenance = z.infer<typeof RuleProvenanceSchema>;

const policyShape = {
  schemaVersion: z.literal(1),
  business: z.strictObject({
    name: text(),
    slug: z.string().regex(SLUG_RE),
    ownerFirstName: text(80),
    city: text(80),
    languages: z.array(LangSchema).min(1).max(3),
    timezone: z.literal("Asia/Kolkata"),
    currency: z.literal("INR"),
  }),
  catalog: z.array(CatalogItemSchema).min(1).max(MAX_CATALOG),
  capacity: z.strictObject({
    unitsPerDay: z.number().int().min(1).max(500),
    overrides: z
      .array(
        z.strictObject({
          date: LocalDateSchema,
          units: z.number().int().min(0).max(500),
        }),
      )
      .max(100),
  }),
  schedule: z.strictObject({
    closedWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
    closedDates: z.array(LocalDateSchema).max(200),
    minLeadHours: hours(336),
    dailyCutoff: HHMMSchema.nullable(),
    maxAdvanceDays: z.number().int().min(1).max(90),
  }),
  rush: RushSchema.nullable(),
  fulfilment: z.strictObject({
    pickup: z.strictObject({
      enabled: z.boolean(),
      areaLabel: text(80).nullable(),
    }),
    delivery: z.strictObject({
      enabled: z.boolean(),
      areas: z.array(DeliveryAreaSchema).max(MAX_AREAS),
      unlistedArea: z.enum(["REFUSE", "ASK_OWNER"]),
    }),
  }),
  orderRules: z.strictObject({
    minOrderPaise: PaiseSchema,
    maxLinesPerOrder: z.number().int().min(1).max(20),
    customRequests: z.enum(["REFUSE", "ASK_OWNER"]),
    quoteValidityMinutes: z.number().int().min(5).max(1440),
    negotiation: z.literal("NEVER"), // a discount is not expressible by design
  }),
  cancellation: z.strictObject({
    freeCancelHours: hours(720),
    note: LocalizedSchema,
  }),
};

const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

export const BusinessPolicySchema = z
  .strictObject({
    ...policyShape,
    provenance: z.record(z.string().max(SHORT_TEXT_MAX), RuleProvenanceSchema),
  })
  .refine((p) => uniqueIds(p.catalog.map((c) => c.id)), {
    message: "duplicate catalog id",
  })
  .refine((p) => uniqueIds(p.fulfilment.delivery.areas.map((a) => a.id)), {
    message: "duplicate area id",
  })
  .refine((p) => Object.keys(p.provenance).length <= MAX_PROVENANCE, {
    message: "too many provenance entries",
  });

export type BusinessPolicy = z.infer<typeof BusinessPolicySchema>;
