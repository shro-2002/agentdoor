/* AgentDoor workspace: progressive enhancement only. Every page works without this file;
   it polls a running job, shows a character count, auto-submits a chosen answer and copies links. */
(function () {
  "use strict";

  var POLL_MIN_MS = 2000;
  var POLL_MAX_MS = 5000;

  function pollJob(url) {
    var delay = POLL_MIN_MS;
    function next() {
      window.setTimeout(tick, delay);
      delay = Math.min(POLL_MAX_MS, delay + 500);
    }
    function tick() {
      fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" })
        .then(function (res) {
          return res.ok ? res.json() : Promise.reject(new Error("status"));
        })
        .then(function (data) {
          if (data.status === "queued" || data.status === "running") next();
          else window.location.reload();
        })
        .catch(next);
    }
    next();
  }

  var job = document.querySelector("[data-job-url]");
  if (job) pollJob(job.getAttribute("data-job-url"));

  var counter = document.querySelector("[data-count]");
  var area = document.getElementById("description");
  if (counter && area) {
    var max = Number(counter.getAttribute("data-count"));
    var update = function () {
      counter.textContent = area.value.length + " / " + max;
    };
    area.addEventListener("input", update);
    update();
  }

  Array.prototype.forEach.call(document.querySelectorAll("form"), function (form) {
    form.addEventListener("submit", function () {
      var buttons = form.querySelectorAll("button[type=submit]");
      window.setTimeout(function () {
        Array.prototype.forEach.call(buttons, function (b) {
          b.disabled = true;
          b.classList.add("is-busy");
        });
      }, 0);
      if (form.hasAttribute("data-start") && buttons[0]) buttons[0].textContent = "Creating…";
    });
  });

  var questionForm = document.querySelector(".question__form");
  if (questionForm) {
    var other = questionForm.querySelector("input[name=other]");
    questionForm.addEventListener("change", function (event) {
      var target = event.target;
      if (target && target.type === "radio") {
        if (other) other.value = "";
        questionForm.requestSubmit();
      }
    });
    if (other) {
      other.addEventListener("input", function () {
        Array.prototype.forEach.call(questionForm.querySelectorAll("input[type=radio]"), function (r) {
          r.checked = false;
        });
      });
    }
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-copy-from]"), function (button) {
    button.addEventListener("click", function () {
      var source = document.getElementById(button.getAttribute("data-copy-from"));
      if (!source || !navigator.clipboard) return;
      navigator.clipboard.writeText(source.value).then(function () {
        var label = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(function () {
          button.textContent = label;
        }, 1500);
      });
    });
  });

  var active = document.querySelector(".navlink.is-active");
  if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "center" });
})();
