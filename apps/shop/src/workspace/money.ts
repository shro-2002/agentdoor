const PAISE_PER_RUPEE = 100;
const MAX_FRACTION_DIGITS = 2;

/** Integer paise as rupees with Indian digit grouping: 1125000 -> "₹11,250", 4050 -> "₹40.50". */
export function rupees(paise: number): string {
  const whole = paise % PAISE_PER_RUPEE === 0;
  const digits = whole ? 0 : MAX_FRACTION_DIGITS;
  return `₹${(paise / PAISE_PER_RUPEE).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: MAX_FRACTION_DIGITS })}`;
}
