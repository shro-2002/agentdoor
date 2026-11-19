import { html, icon, type SafeHtml } from "@agentdoor/ui";
import type { LaunchState } from "../db/launch-state.js";
import { layout } from "./layout.js";
import { bannerFor, identityOf } from "./storefront.js";

export type ContactNotice = "sent" | "saved" | null;

function notice(n: ContactNotice, owner: string): SafeHtml {
  if (n === "sent")
    return html`<div class="alert alert--ok" role="status"><p class="alert__title">${icon("check")}Thank you, your message was sent</p><p>${owner} will reply to the email address you gave. A reply usually comes within a day.</p></div>`;
  if (n === "saved")
    return html`<div class="alert alert--note" role="status"><p class="alert__title">${icon("alert")}We saved your message, but the email did not go out</p><p>${owner} will still see it in the shop's inbox. If it is urgent, please try again in a few minutes.</p></div>`;
  return html``;
}

export function contactPage(n: ContactNotice, launch: LaunchState): string {
  const owner = launch.launched ? launch.policy.business.ownerFirstName : "The owner";
  const body = html`<section class="wrap section narrow">
    <p class="eyebrow">Get in touch</p>
    <h1 class="page-title">Contact ${owner}</h1>
    <p class="section__lead">Questions about an order, a custom cake, or a delivery area we don't list? Write here and ${owner} will answer by email.</p>
    ${notice(n, owner)}
    <form method="post" action="/contact" class="order-form">
      <fieldset class="group">
        <legend class="visually-hidden">Your message</legend>
        <label class="label" for="c-name">Your name</label>
        <input class="input" id="c-name" name="name" maxlength="60" required autocomplete="name">
        <label class="label" for="c-email">Your email <span class="muted">(so ${owner} can reply)</span></label>
        <input class="input" id="c-email" type="email" name="email" maxlength="120" required autocomplete="email">
        <label class="label" for="c-message">Message</label>
        <textarea class="input textarea" id="c-message" name="message" rows="6" maxlength="2000" required></textarea>
        <div class="hp" aria-hidden="true"><label for="c-website">Leave this empty</label><input id="c-website" name="website" tabindex="-1" autocomplete="off"></div>
      </fieldset>
      <p class="form-actions"><button type="submit" class="btn btn--primary btn--lg">Send message</button></p>
      <p class="hint">${icon("check")} Your email is used only to reply to you.</p>
    </form>
  </section>`;
  return layout({ title: "Contact", body, shop: identityOf(launch), banner: bannerFor(launch), active: "contact" });
}
