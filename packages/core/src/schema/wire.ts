// Wire schemas for Claude structured output (04 §1, R0-4). Deliberately UNBOUNDED:
// structured outputs reject min/max/pattern and dynamic-key maps. Bounds are enforced afterwards
// by the domain schemas. Optional fields become `T | null` because every key must be present.
import { z } from "zod";

const o = z.strictObject;
const lang = z.enum(["en", "hi", "hinglish"]);
const confidence = z.enum(["high", "medium", "low"]);
const localized = o({ en: z.string(), hi: z.string().nullable() });
const paise = z.number();

const catalogItem = o({
  id: z.string(),
  name: localized,
  unit: z.enum(["piece", "kg", "box", "dozen"]),
  unitPricePaise: paise,
  minQty: z.number(),
  maxQtyPerOrder: z.number(),
  prepHours: z.number(),
  capacityUnitsPerQty: z.number(),
  options: z.array(
    o({ id: z.string(), label: localized, surchargePaise: paise }),
  ),
  dietary: z.array(
    z.enum(["eggless", "vegan", "contains_nuts", "gluten_free"]),
  ),
});

export const PolicyDraftWireSchema = o({
  schemaVersion: z.literal(1),
  business: o({
    name: z.string(),
    slug: z.string(),
    ownerFirstName: z.string(),
    city: z.string(),
    languages: z.array(lang),
    timezone: z.literal("Asia/Kolkata"),
    currency: z.literal("INR"),
  }),
  catalog: z.array(catalogItem),
  capacity: o({
    unitsPerDay: z.number(),
    overrides: z.array(o({ date: z.string(), units: z.number() })),
  }),
  schedule: o({
    closedWeekdays: z.array(z.number()),
    closedDates: z.array(z.string()),
    minLeadHours: z.number(),
    dailyCutoff: z.string().nullable(),
    maxAdvanceDays: z.number(),
  }),
  rush: o({
    withinHours: z.number(),
    surcharge: z.union([
      o({ kind: z.literal("flat"), paise }),
      o({ kind: z.literal("percent"), bp: z.number() }),
    ]),
    maxRushUnitsPerDay: z.number(),
  }).nullable(),
  fulfilment: o({
    pickup: o({ enabled: z.boolean(), areaLabel: z.string().nullable() }),
    delivery: o({
      enabled: z.boolean(),
      areas: z.array(
        o({
          id: z.string(),
          name: z.string(),
          aliases: z.array(z.string()),
          feePaise: paise,
        }),
      ),
      unlistedArea: z.enum(["REFUSE", "ASK_OWNER"]),
    }),
  }),
  orderRules: o({
    minOrderPaise: paise,
    maxLinesPerOrder: z.number(),
    customRequests: z.enum(["REFUSE", "ASK_OWNER"]),
    quoteValidityMinutes: z.number(),
    negotiation: z.literal("NEVER"),
  }),
  cancellation: o({ freeCancelHours: z.number(), note: localized }),
});

export const CompileResultWireSchema = o({
  detectedLanguage: lang,
  policyDraft: PolicyDraftWireSchema.nullable(),
  evidence: z.array(
    o({
      path: z.string(),
      quote: z.string().nullable(),
      turn: z.number(),
      readback: z.string(),
      confidence,
    }),
  ),
  missing: z.array(o({ path: z.string(), why: z.string() })),
  questions: z.array(
    o({
      id: z.string(),
      path: z.string(),
      text: z.string(),
      choices: z.array(z.string()),
    }),
  ),
  assumptions: z.array(
    o({ path: z.string(), value: z.string(), why: z.string() }),
  ),
});

export const ScenarioWireSchema = o({
  id: z.string(),
  customerMessage: z.string(),
  request: o({
    lines: z.array(
      o({
        itemId: z.string(),
        qty: z.number(),
        optionIds: z.array(z.string()),
      }),
    ),
    fulfilment: o({
      kind: z.enum(["pickup", "delivery"]),
      area: z.string().nullable(),
    }),
    daysAhead: z.number(), // code resolves to a LocalDate from the injected clock (R0-5)
    notes: z.string().nullable(),
  }),
  ownerWouldWant: z.enum(["QUOTE", "REFUSE", "ASK_OWNER"]),
  rationale: z.string(),
  relatedPaths: z.array(z.string()),
});

export const ScenariosWireSchema = o({
  scenarios: z.array(ScenarioWireSchema),
});

/** JSON Schema sent to Claude as `output_config.format`. */
export const toWireJsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" }) as Record<
    string,
    unknown
  >;
