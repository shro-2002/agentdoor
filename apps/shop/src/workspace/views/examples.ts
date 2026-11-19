export interface Example {
  /** The short label on the pill. */
  label: string;
  text: string;
}

/** Real home-bakery descriptions. The pills fill the composer; without JavaScript they link to `/launch?example=N`. */
export const EXAMPLES: Example[] = [
  {
    label: "Eggless cakes in Bengaluru",
    text: "I bake eggless cakes at home in Indiranagar, Bengaluru. Chocolate truffle is ₹1,200 a kg and pineapple is ₹900 a kg. Pickup only, I need two days' notice, and I'm closed on Mondays.",
  },
  {
    label: "Cookie boxes in Delhi",
    text: "I sell assorted cookie boxes and brownies from my kitchen in Saket, Delhi. A cookie box is ₹650. I deliver to Saket, Hauz Khas and Green Park for ₹60. Minimum order ₹300, and I can make about 10 boxes a day.",
  },
  {
    label: "Birthday cakes in Mumbai",
    text: "I make custom birthday cakes and cupcakes in Andheri, Mumbai. Cakes start at ₹1,500 for a kg, cupcakes are ₹120 each, box of six. Customers should order at least three days ahead. No delivery beyond Andheri and Juhu.",
  },
  {
    label: "Hinglish: Pune home baker",
    text: "Main ghar par cakes aur cupcakes banati hoon, Pune mein Kothrud ke paas. Delivery sirf Kothrud aur Baner tak, ₹60 charge. Ek din mein 8 cakes se zyada nahi bana sakti. Order ke liye 2 din pehle batana padta hai.",
  },
];

/** The text of `?example=N` (1-based), or an empty string for anything that is not a valid index. */
export function exampleText(raw: unknown): string {
  const n = typeof raw === "string" && /^[1-9]\d{0,1}$/.test(raw) ? Number(raw) : 0;
  return EXAMPLES[n - 1]?.text ?? "";
}
