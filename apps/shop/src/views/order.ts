/** The order pages, split by step: the form, the quote, and the plain-words refusals they share. */
export { orderPage, type OrderPageInput } from "./order/form.js";
export { firstWorkingDate, problemsFor, type Problem } from "./order/problems.js";
export { quotePage, type CustomerValues, type QuotePageInput, type QuoteView } from "./order/quote.js";
export { OTHER_AREA, emptyValues, type OrderFormValues } from "./order/values.js";
