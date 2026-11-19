import { html, type SafeHtml } from "@agentdoor/ui";
import { frame, type Device, type ViewCtx } from "./frame.js";
import { icon } from "./icons.js";
import { postForm } from "./kit.js";

const DEVICES: { key: Device; label: string }[] = [
  { key: "desktop", label: "Desktop" },
  { key: "phone", label: "Phone" },
];

function statusRow(ok: boolean, label: string, detail: string): SafeHtml {
  return html`<li class="status__row${ok ? " is-ok" : ""}"><span class="status__mark" aria-hidden="true">${ok ? icon("check") : ""}</span><div><p class="status__label">${label}<span class="sr-only">${ok ? ": yes" : ": not yet"}</span></p><p class="status__detail">${detail}</p></div></li>`;
}

function statusBlock(ctx: ViewCtx): SafeHtml {
  const { ready } = ctx;
  const approved = ready.approvals.required > 0 && ready.approvals.approved === ready.approvals.required;
  const agent = ready.hasRun && !ready.stale && ready.counts !== null && ready.counts.engine === 0 && approved;
  return html`<section class="card" aria-labelledby="status-h"><h2 id="status-h" class="card__title">Status</h2><ul class="status">
    ${statusRow(ready.hasPolicy, "Storefront generated", ready.hasPolicy ? "Built from your products and rules." : "Set up your business first.")}
    ${statusRow(approved, "Rules approved", `${ready.approvals.approved} of ${ready.approvals.required} required rules approved.`)}
    ${statusRow(agent, "AI ordering ready in preview", agent ? "The engine that prices orders passes every check. Preview only: orders are off." : "Ready when the rehearsal passes with every rule approved.")}
  </ul></section>`;
}

const deviceSwitch = (ctx: ViewCtx): SafeHtml =>
  html`<div class="seg seg--device" role="group" aria-label="Preview size">${DEVICES.map((d) => html`<a class="seg__btn${ctx.device === d.key ? " is-on" : ""}" href="${ctx.base}/storefront?device=${d.key}" data-device="${d.key}"${ctx.device === d.key ? html` aria-current="true"` : ""}>${icon(d.key === "phone" ? "phone" : "desktop")}${d.label}</a>`)}</div>`;

/** The real draft storefront in a device frame. The page is served by this app, so it is framed same-origin only. */
function stage(ctx: ViewCtx): SafeHtml {
  if (!ctx.ready.hasPolicy) return html``;
  if (!ctx.previewPath)
    return html`<section class="stage stage--empty" aria-labelledby="stage-h"><span class="stage__icon">${icon("storefront")}</span><h2 id="stage-h" class="stage__title">See your shop as a customer would</h2><p>Make a private preview page from your products and rules. Orders stay off.</p>
      ${postForm(`${ctx.base}/preview`, html`<button class="btn btn--primary" type="submit">${icon("sparkle")}Preview your storefront</button>`)}</section>`;
  return html`<section class="stage" aria-label="Storefront preview">
    <div class="stage__bar">${deviceSwitch(ctx)}<p class="stage__url">${ctx.previewPath}</p></div>
    <div class="device device--${ctx.device}" data-device-frame>
      <div class="device__chrome" aria-hidden="true"><i></i><i></i><i></i></div>
      <iframe class="device__screen" src="${ctx.previewPath}" title="Preview of your storefront" loading="lazy" sandbox="allow-same-origin allow-popups"></iframe>
    </div>
  </section>`;
}

const PREVIEW_NOTE = "This is a preview. Publishing to your own domain needs the owner's authorization.";

function copyRow(ctx: ViewCtx): SafeHtml {
  if (!ctx.previewPath) return html``;
  return html`<div class="field"><label for="plink">Preview link</label><div class="copy"><input id="plink" class="input" readonly value="${ctx.origin}${ctx.previewPath}"><button class="btn btn--sm" type="button" data-copy-from="plink">${icon("copy")}<span class="btn__label">Copy preview link</span></button></div></div>`;
}

function ownerSteps(ctx: ViewCtx): SafeHtml {
  if (!ctx.owner) return html`<p class="row"><a class="link" href="/owner/login">Owner sign-in</a></p>`;
  if (!ctx.prepared)
    return html`<p class="muted">Everything is approved and rehearsed. Prepare the signed package that the authorized deployment publishes.</p>
      ${postForm(`${ctx.base}/prepare`, html`<button class="btn btn--primary" type="submit">Prepare for publishing</button>`)}`;
  return html`<p><strong>Package prepared.</strong> Your approved rules are stored, signed and ready.</p>
    <p class="muted">Download the package and hand it to AgentDoor's authorized deployment on your own computer. It uses your GoDaddy sign-in, which never reaches this site.</p>
    <p class="row"><a class="btn btn--primary" href="${ctx.base}/package.json" download="agentdoor-package.json">${icon("arrow")}Download package</a></p>`;
}

function publishCard(ctx: ViewCtx): SafeHtml {
  const { ready } = ctx;
  const locked = !ready.canPublish
    ? html`<p class="lockline">${icon("lock")}<span><strong>Locked.</strong> ${ready.blockers.length ? ready.blockers.join(" ") : "Finish the rehearsal first."}</span></p><p><a class="btn btn--sm" href="${ctx.base}/rehearse">Go to Rehearse</a></p>`
    : ownerSteps(ctx);
  return html`<section class="card${ctx.prepared && ready.canPublish ? " card--ok" : ""}" aria-labelledby="pub-h"><h2 id="pub-h" class="card__title">Publish</h2>
    <p class="publish__note">${PREVIEW_NOTE}</p>${copyRow(ctx)}${locked}</section>`;
}

export function storefrontTabPage(ctx: ViewCtx): string {
  const open = ctx.previewPath ? html`<a class="btn btn--ghost" href="${ctx.previewPath}" target="_blank" rel="noopener">${icon("external")}Open in new tab</a>` : html``;
  const head = { title: "Storefront", lede: "Your shop, as customers will see it.", actions: open };
  return frame(ctx, "storefront", head, html`<div class="split split--wide"><div class="split__main">${stage(ctx)}</div><div class="stack">${statusBlock(ctx)}${publishCard(ctx)}</div></div>`);
}
