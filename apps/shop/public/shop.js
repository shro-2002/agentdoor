// Progressive enhancement only: every page and the whole order flow work without this file.
(function () {
  "use strict";

  var DEFAULT_MAX = 1000;

  // Quantity stepper: the real number input stays, with minus and plus buttons around it.
  function enhanceQty(box) {
    var input = box.querySelector("input[type=number]");
    if (!input || box.dataset.enhanced) return;
    box.dataset.enhanced = "1";
    var pick = input.closest("[data-pick]");
    var nameEl = pick && pick.querySelector(".pick__name");
    var label = nameEl ? nameEl.textContent.trim() : "item";
    var minus = makeButton("−", "Fewer " + label, -1);
    var plus = makeButton("+", "More " + label, 1);

    function limit() {
      return Number(input.max) || DEFAULT_MAX;
    }
    function sync() {
      var n = Number(input.value) || 0;
      minus.disabled = n <= 0;
      plus.disabled = n >= limit();
    }
    function makeButton(sign, text, step) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "qty__btn";
      b.textContent = sign;
      b.setAttribute("aria-label", text);
      b.addEventListener("click", function () {
        var next = (Number(input.value) || 0) + step;
        input.value = String(Math.min(Math.max(next, 0), limit()));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return b;
    }
    box.insertBefore(minus, input);
    box.insertBefore(plus, input.nextSibling);
    box.classList.add("qty--js");
    input.addEventListener("input", sync);
    sync();
  }

  // "26 Nov" style label for the summary, from the date input's own value.
  function dayLabel(value) {
    var d = new Date(value + "T00:00:00Z");
    if (!value || isNaN(d.getTime())) return "Not chosen yet";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }

  // The order summary mirrors the form as it is filled in. It never shows a price: the quote does.
  function enhanceSummary(form) {
    var list = form.querySelector("[data-summary-items]");
    var dateOut = form.querySelector("[data-summary-date]");
    var howOut = form.querySelector("[data-summary-how]");
    var date = form.querySelector("#date");
    if (!list || !dateOut || !howOut || !date) return;

    function render() {
      var rows = [];
      form.querySelectorAll("[data-pick]").forEach(function (pick) {
        var qty = Number(pick.querySelector("input[type=number]").value) || 0;
        if (qty > 0) rows.push(qty + " × " + pick.dataset.name);
      });
      list.textContent = "";
      (rows.length ? rows : ["Nothing chosen yet"]).forEach(function (text) {
        var li = document.createElement("li");
        li.textContent = text;
        if (!rows.length) li.className = "summary__empty";
        list.appendChild(li);
      });
      dateOut.textContent = dayLabel(date.value);
      var chosen = form.querySelector("input[name=fulfilment]:checked");
      howOut.textContent = chosen && chosen.value === "delivery" ? "Delivery" : "Pickup";
    }
    form.addEventListener("input", render);
    form.addEventListener("change", render);
    render();
  }

  // The area picker only matters for delivery, so pickup hides it. Without this script it is always shown.
  function enhanceArea(form) {
    var box = form.querySelector("[data-area-box]");
    if (!box) return;
    function show() {
      var chosen = form.querySelector("input[name=fulfilment]:checked");
      box.hidden = !!chosen && chosen.value !== "delivery";
    }
    form.addEventListener("change", show);
    show();
  }

  document.querySelectorAll("[data-qty]").forEach(enhanceQty);
  var checkout = document.querySelector("form.checkout");
  if (checkout) {
    enhanceSummary(checkout);
    enhanceArea(checkout);
  }

  // The saved-link field selects itself so it is easy to copy.
  var link = document.getElementById("statuslink");
  if (link) link.addEventListener("focus", function () { link.select(); });
})();
