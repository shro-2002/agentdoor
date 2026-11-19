// Progressive enhancement only: every page works without this file.
(function () {
  "use strict";

  // Quantity steppers: the plain number input stays; minus and plus buttons are added around it.
  function enhanceQty(box) {
    var input = box.querySelector("input[type=number]");
    if (!input || box.dataset.enhanced) return;
    box.dataset.enhanced = "1";
    var name = (input.closest(".pick") || document).querySelector(".pick__name");
    var label = name ? name.textContent.trim() : "item";
    function make(sign, text) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "qty__btn";
      b.textContent = sign;
      b.setAttribute("aria-label", text + " " + label);
      b.addEventListener("click", function () {
        var max = Number(input.max) || 1000;
        var next = (Number(input.value) || 0) + (sign === "+" ? 1 : -1);
        input.value = String(Math.min(Math.max(next, 0), max));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return b;
    }
    box.insertBefore(make("−", "Fewer"), input);
    box.insertBefore(make("+", "More"), input.nextSibling);
    box.classList.add("qty--js");
  }
  document.querySelectorAll("[data-qty]").forEach(enhanceQty);

  // The saved-link field selects itself so it is easy to copy.
  var link = document.getElementById("statuslink");
  if (link) link.addEventListener("focus", function () { link.select(); });
})();
