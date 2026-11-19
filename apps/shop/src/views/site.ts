/**
 * Site-wide settings shown in the shop chrome.
 * REPO_URL is the public source repository; the footer shows "Source code" only when it is non-empty.
 */
export const REPO_URL = "https://github.com/shro-2002/agentdoor";

/**
 * The owner's public mailbox (the CONTACT_FORM_RECIPIENT_EMAIL config value), set once at app start.
 * Views read it here so that every page shows the same address; empty means "show nothing".
 */
let ownerContact = "";
export const setOwnerContact = (email: string | null | undefined): void => {
  ownerContact = typeof email === "string" ? email.trim() : "";
};
export const getOwnerContact = (): string => ownerContact;
