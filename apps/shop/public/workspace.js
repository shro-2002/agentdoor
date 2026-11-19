/* AgentDoor workspace: progressive enhancement only. Every page works without this file.
   It polls a running job, runs its timer and steps, fills the composer, opens the early-access
   dialog, resolves fixes in place, steps numbers, switches the preview frame and copies links. */
(() => {
  "use strict";

  const POLL_MIN_MS = 2000;
  const POLL_MAX_MS = 5000;
  const POLL_STEP_MS = 500;
  const TICK_MS = 1000;
  const SECONDS_PER_MINUTE = 60;
  const RESOLVE_HOLD_MS = 900;
  const COPIED_MS = 1500;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  document.documentElement.classList.add("js");

  // ---- a running job: poll the real status, show the real elapsed time ----
  function pollJob(url) {
    let delay = POLL_MIN_MS;
    const next = () => {
      window.setTimeout(tick, delay);
      delay = Math.min(POLL_MAX_MS, delay + POLL_STEP_MS);
    };
    const tick = () =>
      fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("status"))))
        .then((data) => (data.status === "queued" || data.status === "running" ? next() : window.location.reload()))
        .catch(next);
    next();
  }

  function runTimer(work) {
    const started = Number(work.dataset.elapsed) * TICK_MS - performance.now();
    const pace = Number(work.dataset.stepSeconds);
    const steps = $$(".wstep", work);
    const timer = $("[data-timer]", work);
    const render = () => {
      const seconds = Math.max(0, Math.floor((started + performance.now()) / TICK_MS));
      if (timer) timer.textContent = `${Math.floor(seconds / SECONDS_PER_MINUTE)}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, "0")}`;
      const current = Math.min(steps.length - 1, Math.floor(seconds / pace));
      steps.forEach((el, i) => {
        el.classList.toggle("is-done", i < current);
        el.classList.toggle("is-active", i === current);
        el.classList.toggle("is-todo", i > current);
      });
    };
    render();
    window.setInterval(render, TICK_MS);
  }

  const work = $("[data-job-url]");
  if (work) {
    pollJob(work.dataset.jobUrl);
    runTimer(work);
  }

  // ---- landing: composer, examples, early-access dialog ----
  const composer = $("[data-composer]");
  const area = $("#description");
  const counter = $("[data-count]");
  const updateCount = () => {
    if (counter && area) counter.textContent = `${area.value.length} / ${counter.dataset.count}`;
  };
  if (area) {
    area.addEventListener("input", updateCount);
    updateCount();
  }

  const shortcut = $("[data-shortcut]");
  if (shortcut && /Mac|iPhone|iPad/.test(navigator.platform)) shortcut.textContent = "⌘ ↵";
  if (composer && area) {
    area.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });
  }

  $$("[data-example]").forEach((pill) =>
    pill.addEventListener("click", (event) => {
      if (!area) return;
      event.preventDefault();
      area.value = pill.dataset.example;
      updateCount();
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }),
  );

  const gate = $("[data-gate]");
  if (gate && composer && typeof gate.showModal === "function") {
    composer.addEventListener("submit", (event) => {
      if (composer.dataset.access !== "needed") return;
      event.preventDefault();
      if (!composer.reportValidity()) return;
      $("[data-gate-description]", gate).value = area.value;
      gate.showModal();
    });
    $("[data-gate-close]", gate).addEventListener("click", () => gate.close());
    gate.addEventListener("click", (event) => {
      if (event.target === gate) gate.close();
    });
  }

  // ---- every form: show it is working, once ----
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (event.defaultPrevented || !(form instanceof HTMLFormElement) || form.classList.contains("js-resolve")) return;
    const buttons = $$("button[type=submit]", form);
    window.setTimeout(() => buttons.forEach((b) => ((b.disabled = true), b.classList.add("is-busy"))), 0);
    const label = $(".btn__label", form);
    if (label && form.hasAttribute("data-composer")) label.textContent = "Building…";
  });

  // ---- fixes and approvals: resolve in place, then show the fresh page ----
  const settle = (form, body) => {
    const card = form.closest(".issue, .rule");
    const targets = card ? [card] : $$(".rules--flat .rule");
    targets.forEach((el) => el.classList.add("is-resolved"));
    // "Accept" settles the card but protects nothing, so the card must not claim it did.
    const panel = card && $(".issue__resolved", card);
    if (panel && body.get("choice") === panel.dataset.accept) card.classList.add("is-accepted");
  };

  async function resolve(form, body) {
    const res = await fetch(form.action, { method: "POST", body, credentials: "same-origin", headers: { Accept: "text/html" } });
    if (!res.ok) throw new Error("status");
    const fresh = new DOMParser().parseFromString(await res.text(), "text/html");
    settle(form, body);
    window.setTimeout(() => {
      const main = $("#main");
      const next = $("#main", fresh);
      if (main && next) main.innerHTML = next.innerHTML;
    }, RESOLVE_HOLD_MS);
  }

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.classList.contains("js-resolve")) return;
    event.preventDefault();
    // The entry list is read first: a disabled submit button would not send its choice.
    const body = new URLSearchParams(new FormData(form, event.submitter));
    const buttons = $$("button", form);
    buttons.forEach((b) => (b.disabled = true));
    // If the quiet request fails, fall back to the ordinary form post and full page load.
    resolve(form, body).catch(() => {
      buttons.forEach((b) => (b.disabled = false));
      form.classList.toggle("js-resolve", false);
      form.requestSubmit(event.submitter);
    });
  });

  // ---- clicks: steppers, device switch, copy ----
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const stepBtn = target && target.closest("[data-step]");
    if (stepBtn) {
      const input = $("input[type=number]", stepBtn.parentElement);
      const min = Number(input.min);
      const max = Number(input.max);
      const base = input.value === "" ? min - Number(stepBtn.dataset.step) : Number(input.value);
      input.value = Math.min(max, Math.max(min, base + Number(stepBtn.dataset.step)));
      return;
    }
    const device = target && target.closest("[data-device]");
    if (device) {
      event.preventDefault();
      const frame = $("[data-device-frame]");
      if (frame) frame.className = `device device--${device.dataset.device}`;
      $$("[data-device]").forEach((a) => {
        const on = a === device;
        a.classList.toggle("is-on", on);
        if (on) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
      return;
    }
    const copy = target && target.closest("[data-copy-from]");
    const source = copy && document.getElementById(copy.dataset.copyFrom);
    if (source && navigator.clipboard) {
      navigator.clipboard.writeText(source.value).then(() => {
        const label = $(".btn__label", copy) || copy;
        const text = label.textContent;
        label.textContent = "Copied";
        window.setTimeout(() => (label.textContent = text), COPIED_MS);
      });
    }
  });

  // ---- setup: choosing an answer sends it ----
  const answer = $(".answer");
  if (answer) {
    const other = $("input[name=other]", answer);
    answer.addEventListener("change", (event) => {
      if (event.target && event.target.type === "radio") {
        if (other) other.value = "";
        answer.requestSubmit();
      }
    });
    if (other) other.addEventListener("input", () => $$("input[type=radio]", answer).forEach((r) => (r.checked = false)));
  }

  const active = $(".navlink.is-active");
  if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "center" });
})();
