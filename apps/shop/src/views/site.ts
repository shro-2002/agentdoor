/**
 * Site-wide settings shown in the shop chrome.
 * REPO_URL is empty on purpose: it is filled in later, and the footer shows "Source code" only when it is set.
 */
export const REPO_URL = "";

/**
 * The owner's public mailbox (the CONTACT_FORM_RECIPIENT_EMAIL config value), set once at app start.
 * Views read it here so that every page shows the same address; empty means "show nothing".
 */
let ownerContact = "";
export const setOwnerContact = (email: string | null | undefined): void => {
  ownerContact = typeof email === "string" ? email.trim() : "";
};
export const getOwnerContact = (): string => ownerContact;
