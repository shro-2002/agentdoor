import { simulateBusyDay } from "@agentdoor/core";
import { formBody } from "../http/body.js";
import { EditError, editRules, type Form } from "./edit.js";
import { commitPolicy } from "./ops.js";
import { HTTP, type RouteKit } from "./route-kit.js";
import type { DraftRow } from "./state.js";
import { updateState } from "./store.js";
import type { BusyDayView } from "./views/busy-day.js";
import type { ViewCtx } from "./views/frame.js";
import { messagePage } from "./views/start.js";

/**
 * The busy-day simulation is a plain GET (`?simulate=1`): it reads the draft, computes in memory and
 * writes nothing, so a reload or a shared link gives the same answer for the same rules and day.
 */
export function busyDayFor(simulate: unknown, c: Pick<ViewCtx, "id" | "state" | "nowMs">): BusyDayView {
  const requested = simulate === "1";
  return { requested, result: requested && c.state.policy ? simulateBusyDay(c.state.policy, c.id, c.nowMs) : null };
}

/** "Set a daily limit" on the result: the same capacity rule the Rules page edits, then straight back to a re-run. */
export function registerBusyDay(kit: Pick<RouteKit, "router" | "pool" | "now" | "sameOrigin">): void {
  const { router, pool, now, sameOrigin } = kit;
  router.post("/launch/w/:id/busy-day/limit", formBody, sameOrigin, async (req, res) => {
    const row = res.locals.row as DraftRow;
    try {
      await updateState(pool, row.id, (s) => {
        if (!s.policy) throw new EditError("Set up your business first.");
        commitPolicy(s, editRules(s.policy, "capacity", (req.body ?? {}) as Form, new Date(now()).toISOString()), now(), row.id);
      });
      res.redirect(303, `/launch/w/${row.id}/rehearse?simulate=1#busy-day`);
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      res.status(HTTP.badRequest).set("Cache-Control", "no-store").type("html").send(messagePage("Check the number", e.message));
    }
  });
}
