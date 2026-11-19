import { html, type SafeHtml } from "@agentdoor/ui";
import { checkMark, postForm } from "./kit.js";
import { frame, type ViewCtx } from "./frame.js";

function statusRow(ok: boolean, label: string, detail: string): SafeHtml {
  return html`<li class="status__row${ok ? " is-ok" : ""}"><span class="status__mark" aria-hidden="true">${ok ? checkMark() : ""}</span><div><p class="status__label">${label}<span class="sr-only">${ok ? ": yes" : ": not yet"}</span></p><p class="muted">${detail}</p></div></li>`;
}

function statusBlock(ctx: ViewCtx): SafeHtml {
  const { ready } = ctx;
  const approved = ready.approvals.required > 0 && ready.approvals.approved === ready.approvals.required;
  const agent = ready.hasRun && !ready.stale && ready.counts !== null && ready.counts.engine === 0 && approved;
  return html`<section class="card" aria-labelledby="status-h"><h2 id="status-h" class="card__title">Status</h2><ul class="status">
    ${statusRow(ready.hasPolicy, "Storefront generated", ready.hasPolicy ? "Built from your products and rules." : "Set up your business first.")}
    ${statusRow(approved, "Business policies approved", `${ready.approvals.approved} of ${ready.approvals.required} required rules approved.`)}
    ${statusRow(agent, "AI ordering (MCP) ready in preview", agent ? "The same engine that prices orders is passing every check. Preview only: orders are off." : "Becomes ready when the rehearsal passes with every rule approved.")}
  </ul></section>`;
}

function previewCard(ctx: ViewCtx): SafeHtml {
  if (!ctx.ready.hasPolicy) return html``;
  const link = ctx.previewPath ? `${ctx.origin}${ctx.previewPath}` : null;
  return html`<section class="card" aria-labelledby="prev-h"><h2 id="prev-h" class="card__title">Preview</h2>
    <p class="muted">A private page that looks like your shop. Anyone with the link can look, but orders are off.</p>
    ${
      link
        ? html`<div class="field"><label for="plink">Preview link</label><div class="copy"><input id="plink" class="input" readonly value="${link}"><button class="btn btn--sm" type="button" data-copy-from="plink">Copy</button></div></div>
          <p class="row"><a class="btn btn--primary" href="${ctx.previewPath}">Open preview</a></p>`
        : postForm(`${ctx.base}/preview`, html`<button class="btn btn--primary" type="submit">Preview your storefront</button>`)
    }
  </section>`;
}

function publishCard(ctx: ViewCtx): SafeHtml {
  const { ready } = ctx;
  const head = html`<h2 id="pub-h" class="card__title">Publish</h2>`;
  if (!ready.canPublish)
    return html`<section class="card" aria-labelledby="pub-h">${head}<p class="lock-text"><strong>Locked.</strong> ${ready.blockers.length ? ready.blockers.join(" ") : "Finish the rehearsal first."}</p><p><a class="btn" href="${ctx.base}/rehearse">Go to Rehearse</a></p></section>`;
  if (!ctx.owner)
    return html`<section class="card" aria-labelledby="pub-h">${head}
      <p><strong>Publishing needs the owner's authorization.</strong></p>
      <p class="muted">A preview is not a live website. Publishing to a real domain goes through AgentDoor's authorized deployment, which only the shop owner can start. Share the preview link meanwhile.</p>
      <p class="row">${ctx.previewPath ? html`<a class="btn" href="${ctx.previewPath}">Open preview</a>` : ""}<a class="link" href="/owner/login">Owner sign-in</a></p>
    </section>`;
  if (!ctx.prepared)
    return html`<section class="card" aria-labelledby="pub-h">${head}
      <p class="muted">Everything is approved and rehearsed. Prepare the signed package that the authorized deployment publishes.</p>
      ${postForm(`${ctx.base}/prepare`, html`<button class="btn btn--primary" type="submit">Prepare for publishing</button>`)}
    </section>`;
  return html`<section class="card card--ok" aria-labelledby="pub-h">${head}
    <p><strong>Package prepared.</strong> Your approved rules are stored, signed and ready.</p>
    <p class="muted">Next: download the package, then hand it to AgentDoor's authorized deployment on your own computer (it uses your GoDaddy sign-in, which never reaches this site). It publishes your storefront to your domain.</p>
    <p class="row"><a class="btn btn--primary" href="${ctx.base}/package.json" download="agentdoor-package.json">Download package</a></p>
  </section>`;
}

export function storefrontTabPage(ctx: ViewCtx): string {
  return frame(ctx, "storefront", "Storefront", html`<div class="stack">${statusBlock(ctx)}${previewCard(ctx)}${publishCard(ctx)}</div>`);
}
