import type { BusinessPolicy, Gap, GapCode, GapSeverity } from "@agentdoor/core";
import { fixOptions } from "./gapFix.js";

/**
 * Gap cards come from templates (05 §5.4, R0-2): one per GapCode, in English and in Hinglish
 * (Hindi in Roman letters), filled with the owner's own item names, areas and numbers. No model call.
 */
export type CardLang = "en" | "hinglish";

export interface GapText {
  title: string;
  body: string;
}

export interface GapCard extends GapText {
  gapId: string;
  code: GapCode;
  severity: GapSeverity;
  dismissed: boolean;
  /** The triggering probe or customer message, when there is one. */
  example: string | null;
  paths: string[];
  fixes: { choice: string; label: string; needsValue: boolean }[];
}

const MAX_BODY_WORDS = 40;
const MAX_NAME_CHARS = 30;
const MAX_READBACK_WORDS = 14;
const MAX_LISTED_NAMES = 3;

interface Ctx {
  gap: Gap;
  policy: BusinessPolicy;
  /** A numeric or text param of the gap, as text. */
  p: (key: string) => string;
  item: string;
  areas: string;
  readback: string;
}

type Template = (c: Ctx) => GapText;

const clipWords = (text: string, max: number): string => {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : `${words.slice(0, max).join(" ")}…`;
};
const clipChars = (text: string): string =>
  text.length <= MAX_NAME_CHARS ? text : `${text.slice(0, MAX_NAME_CHARS - 1).trimEnd()}…`;

const itemName = (policy: BusinessPolicy, id: unknown): string =>
  clipChars(policy.catalog.find((c) => c.id === id)?.name.en ?? String(id ?? "this item"));

function areaNamesIn(policy: BusinessPolicy, paths: string[]): string[] {
  return paths.flatMap((path) => {
    const id = /areas\[([^\]]+)\]/.exec(path)?.[1];
    const area = policy.fulfilment.delivery.areas.find((a) => a.id === id);
    return area ? [clipChars(area.name)] : [];
  });
}

const humanize = (code: string): string => code.toLowerCase().replace(/_/g, " ");

const SCENARIO_EXPECTED = {
  en: { QUOTE: "accept the order", REFUSE: "refuse the order", ASK_OWNER: "ask you first" },
  hinglish: { QUOTE: "order accept kare", REFUSE: "order mana kare", ASK_OWNER: "pehle aapse puche" },
} as const;
const SCENARIO_ACTUAL = {
  en: { QUOTED: "quoted it automatically", REFUSED: "refused it", NEEDS_OWNER: "left it to you" },
  hinglish: { QUOTED: "turant quote kar diya", REFUSED: "order mana kar diya", NEEDS_OWNER: "faisla aap par chhod diya" },
} as const;

function scenarioText(lang: CardLang, c: Ctx): GapText {
  const expected = SCENARIO_EXPECTED[lang][c.p("expected") as keyof (typeof SCENARIO_EXPECTED)["en"]] ?? c.p("expected");
  const actual = SCENARIO_ACTUAL[lang][c.p("actual") as keyof (typeof SCENARIO_ACTUAL)["en"]] ?? c.p("actual");
  return lang === "en"
    ? {
        title: "A customer case went the wrong way",
        body: `For this customer you would want the shop to ${expected}, but it ${actual}. The example is below. Change the related rule, or tell us this is fine.`,
      }
    : {
        title: "Ek customer case ulta ho gaya",
        body: `Is customer ke liye aap chahte hain ki shop ${expected}, par usne ${actual}. Example neeche hai. Related rule badliye, ya bataiye ki ye theek hai.`,
      };
}

const TEMPLATES: Record<GapCode, { en: Template; hinglish: Template }> = {
  NO_CAPACITY_LIMIT: {
    en: (c) => ({
      title: "Orders have no real daily limit",
      body: `Customers could order up to ${c.p("unitsPerDay")} units in one day. Nobody can bake that much, so one big order could swallow your week. How many units can you really make in a day?`,
    }),
    hinglish: (c) => ({
      title: "Roz ki koi asli limit nahi hai",
      body: `Customer ek din mein ${c.p("unitsPerDay")} units tak order kar sakte hain. Itna koi nahi bana sakta, ek bada order poora hafta kha jayega. Aap ek din mein sach mein kitne bana sakte hain?`,
    }),
  },
  RUSH_UNBOUNDED: {
    en: (c) => ({
      title: "Rush orders have no safe cap",
      body: `Same-day rush orders are allowed up to ${c.p("maxRushUnitsPerDay")} units a day, while normal capacity is ${c.policy.capacity.unitsPerDay}. A burst of rush orders could break your day. Choose a small rush cap, or turn rush off.`,
    }),
    hinglish: (c) => ({
      title: "Rush orders ki koi surakshit limit nahi",
      body: `Same-day rush orders ${c.p("maxRushUnitsPerDay")} units tak allowed hain, jabki normal capacity ${c.policy.capacity.unitsPerDay} hai. Rush orders ki bheed aapka din bigaad sakti hai. Chhoti rush limit chuniye ya rush band kijiye.`,
    }),
  },
  RUSH_LEAD_CONFLICT: {
    en: (c) => ({
      title: "Rush window is longer than notice",
      body: `Orders due within ${c.p("withinHours")} hours count as rush, but normal notice is only ${c.p("minLeadHours")} hours. Rush would then cover orders that are not really urgent. Make the two numbers agree.`,
    }),
    hinglish: (c) => ({
      title: "Rush window notice se lamba hai",
      body: `${c.p("withinHours")} ghante ke andar wale orders rush maane jate hain, par normal notice sirf ${c.p("minLeadHours")} ghante ka hai. Isse rush ka matlab bigad jata hai. Dono numbers ko barabar kijiye.`,
    }),
  },
  PREP_EXCEEDS_LEAD: {
    en: (c) => ({
      title: "Prep time is longer than notice",
      body: `${c.item} needs ${c.p("prepHours")} hours to prepare, but your usual notice is ${c.p("minLeadHours")} hours. The shop will use the longer time. Fine as it is, or raise the notice?`,
    }),
    hinglish: (c) => ({
      title: "Taiyari ka time notice se zyada hai",
      body: `${c.item} banane mein ${c.p("prepHours")} ghante lagte hain, par aapka usual notice ${c.p("minLeadHours")} ghante ka hai. Shop lamba time hi use karegi. Aise hi theek hai, ya notice badhayein?`,
    }),
  },
  UNLISTED_AREA_POLICY: {
    en: (c) => ({
      title: "Unknown delivery areas not decided",
      body: `You deliver to ${c.areas}. If someone asks for another area, AgentDoor guessed what to do. Should the shop refuse, or ask you first?`,
    }),
    hinglish: (c) => ({
      title: "Anjaan area ka faisla baaki hai",
      body: `Aap ${c.areas} mein deliver karte hain. Kisi aur area ka order aaye to AgentDoor ne andaza lagaya hai. Shop mana kare, ya pehle aapse puche?`,
    }),
  },
  AREA_ALIAS_AMBIGUOUS: {
    en: (c) => {
      const [a = "one area", b = "another area"] = areaNamesIn(c.policy, c.gap.paths);
      return {
        title: "Two areas look alike",
        body: `${a} and ${b} share a name or alias, so a customer could be matched to the wrong area and fee. Rename or remove one alias.`,
      };
    },
    hinglish: (c) => {
      const [a = "ek area", b = "doosra area"] = areaNamesIn(c.policy, c.gap.paths);
      return {
        title: "Do areas ke naam milte-julte hain",
        body: `${a} aur ${b} ka naam ya alias milta hai, isliye customer ko galat area aur fee mil sakti hai. Ek alias badal dijiye ya hata dijiye.`,
      };
    },
  },
  NO_MIN_ORDER: {
    en: (c) => ({
      title: "No minimum order amount",
      body: `Right now any order is accepted, even a single ${c.item} with free delivery. That may cost more than it earns. Set a minimum order amount, or keep this.`,
    }),
    hinglish: (c) => ({
      title: "Minimum order amount set nahi hai",
      body: `Abhi koi bhi order chal jata hai, free delivery ke saath sirf ek ${c.item} bhi. Isme nuksan ho sakta hai. Minimum order amount rakhiye ya aise hi rehne dijiye.`,
    }),
  },
  UNAPPROVED_RULE: {
    en: (c) => ({
      title: "A rule is waiting for your OK",
      body: `You have not confirmed this yet: "${c.readback}". AgentDoor will not launch it until you approve or change it.`,
    }),
    hinglish: (c) => ({
      title: "Ek rule aapki haan ka intezaar kar raha",
      body: `Ye abhi confirm nahi hua: "${c.readback}". Jab tak aap approve ya badal nahi dete, AgentDoor ise launch nahi karega.`,
    }),
  },
  LOW_CONFIDENCE_SOURCE: {
    en: (c) => ({
      title: "AgentDoor is not sure about this rule",
      body: `AgentDoor was unsure when it wrote down: "${c.readback}". Please read it and approve it yourself, or change it.`,
    }),
    hinglish: (c) => ({
      title: "AgentDoor ko is rule par shak hai",
      body: `AgentDoor ko ye likhte waqt pakka nahi tha: "${c.readback}". Ise khud padhkar approve kijiye ya badal dijiye.`,
    }),
  },
  DIETARY_CLAIM_UNSUPPORTED: {
    en: (c) => ({
      title: "Dietary label not in your words",
      body: `${c.item} is marked ${c.p("tag")}, but you never said that in your description. A wrong dietary label can hurt a customer. Confirm it, or remove the label.`,
    }),
    hinglish: (c) => ({
      title: "Dietary label aapke shabdon mein nahi",
      body: `${c.item} par ${c.p("tag")} likha hai, par aapne ye kabhi bola nahi. Galat dietary label customer ko nuksan pahuncha sakta hai. Confirm kijiye ya label hata dijiye.`,
    }),
  },
  CUSTOM_REQUESTS_UNDEFINED: {
    en: () => ({
      title: "Custom orders not decided yet",
      body: "If a customer asks for a custom design or something not on your menu, AgentDoor guessed the answer. Should the shop refuse, or ask you first?",
    }),
    hinglish: () => ({
      title: "Custom orders ka faisla baaki hai",
      body: "Koi custom design ya menu se bahar ka order maange to AgentDoor ne andaza lagaya hai. Shop mana kare, ya pehle aapse puche?",
    }),
  },
  SCENARIO_UNHANDLED: { en: (c) => scenarioText("en", c), hinglish: (c) => scenarioText("hinglish", c) },
  ENGINE_PROBE_FAILED: {
    en: (c) => ({
      title: "AgentDoor's own self-test failed",
      body: `A built-in check (${humanize(c.p("family"))}) gave a wrong answer. This is a bug in AgentDoor, not in your rules. Launch stays blocked until it is fixed.`,
    }),
    hinglish: (c) => ({
      title: "AgentDoor ka apna test fail hua",
      body: `Ek built-in jaanch (${humanize(c.p("family"))}) ne galat jawab diya. Ye AgentDoor ka bug hai, aapke rules ka nahi. Theek hone tak launch band rahega.`,
    }),
  },
  PROBE_NEEDS_OWNER: {
    en: (c) => ({
      title: "A check needs your decision",
      body: `A test case (${humanize(c.p("family"))}) cannot be settled by the rules you set, so the shop would pass it to you. Check the rule behind it.`,
    }),
    hinglish: (c) => ({
      title: "Ek jaanch aapke faisle par atki hai",
      body: `Ek test case (${humanize(c.p("family"))}) aapke rules se tay nahi hota, isliye shop use aap par chhodegi. Uske peeche ka rule dekh lijiye.`,
    }),
  },
};

function context(gap: Gap, policy: BusinessPolicy): Ctx {
  const path = gap.paths[0] ?? "";
  const readback = policy.provenance[path]?.readback.text ?? path;
  const listed = policy.fulfilment.delivery.areas.slice(0, MAX_LISTED_NAMES).map((a) => clipChars(a.name));
  return {
    gap,
    policy,
    p: (key) => String(gap.params[key] ?? ""),
    item: itemName(policy, gap.params.itemId ?? policy.catalog[0]?.id),
    areas: listed.length > 0 ? listed.join(", ") : "your listed areas",
    readback: clipWords(readback, MAX_READBACK_WORDS),
  };
}

/** Title (<= 8 words) and body (<= 40 words) for a gap in the owner's language. */
export function gapText(gap: Gap, policy: BusinessPolicy, lang: CardLang): GapText {
  const text = TEMPLATES[gap.code][lang](context(gap, policy));
  return { title: text.title, body: clipWords(text.body, MAX_BODY_WORDS) };
}

/** The card the launcher shows: template text, the triggering example and the typed fix choices. */
export function gapCard(
  gap: Gap & { dismissed?: boolean },
  policy: BusinessPolicy,
  lang: CardLang,
  example: string | null = null,
): GapCard {
  return {
    ...gapText(gap, policy, lang),
    gapId: gap.id,
    code: gap.code,
    severity: gap.severity,
    dismissed: Boolean(gap.dismissed),
    example,
    paths: gap.paths,
    fixes: fixOptions(gap, policy).map((f) => ({
      choice: f.choice,
      label: lang === "en" ? f.label.en : f.label.hinglish,
      needsValue: Boolean(f.needsValue),
    })),
  };
}
