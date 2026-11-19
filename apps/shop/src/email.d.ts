/** Types for the vended GoDaddy `sendEmail` helper (email.js, copied verbatim, never edited). */
export interface EmailInput {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  from?: string;
}

export function sendEmail(input: EmailInput): Promise<{ messageId: string }>;
