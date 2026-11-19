import { Router } from "express";
import { insertContact, markContactSent } from "../db/queries.js";
import { newOrderId } from "../db/ids.js";
import { sendEmail as vendedSendEmail, type EmailInput } from "../email.js";
import { formBody } from "../http/body.js";
import { sendError } from "../http/envelope.js";
import { requireSameOrigin } from "../security/origin.js";
import type { Limiters } from "../security/rate-limits.js";
import type { ServiceContext } from "../services/context.js";
import { ContactSchema } from "../services/schemas.js";
import { contactPage } from "../views/pages.js";

export type SendEmail = (input: EmailInput) => Promise<{ messageId: string }>;

export function contactRouter(
  ctx: ServiceContext,
  limiters: Limiters,
  sendEmail: SendEmail = vendedSendEmail,
): Router {
  const router = Router();

  router.get("/contact", (req, res) => {
    const sent = req.query.sent;
    res.type("html").send(contactPage(sent === "1" ? "sent" : sent === "0" ? "saved" : null));
  });

  router.post("/contact", limiters.contact, formBody, requireSameOrigin(ctx.config), async (req, res) => {
    const body = ContactSchema.safeParse(req.body);
    if (!body.success) return sendError(req, res, "VALIDATION_FAILED");
    // Bots fill the hidden field: look like success, store and send nothing (SEC-13).
    if (body.data.website) return res.redirect(303, "/contact?sent=1");
    const { name, email, message } = body.data;
    const id = newOrderId(ctx.now());
    await insertContact(ctx.pool, { id, name, email, message, at: new Date(ctx.now()) });
    const shop = ctx.launch.launched ? ctx.launch.policy.business.name : "AgentDoor shop";
    try {
      // The recipient is fixed from env; user input only reaches the body, the subject name and Reply-To.
      await sendEmail({
        to: ctx.config.contactRecipient,
        subject: `${shop} contact form: message from ${name}`,
        text: `From: ${name} <${email}>\n\n${message}`,
        replyTo: email,
      });
      await markContactSent(ctx.pool, id);
    } catch (err) {
      // The raw gateway error stays in the log; the visitor sees generic text (03 §6).
      ctx.log({ level: "error", event: "contact_email_failed", contactId: id, message: (err as Error).message });
      return res.redirect(303, "/contact?sent=0");
    }
    res.redirect(303, "/contact?sent=1");
  });

  return router;
}
