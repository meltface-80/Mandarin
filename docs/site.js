// site.js — shared by every page: the feature cards' ⓘ, and the Copy buttons beside commands.
// The feature cards' ⓘ buttons: each opens its card's how-to, and closes it again.
document.addEventListener("click", function (e) {
  var btn = e.target.closest && e.target.closest(".card h3 .info");
  if (!btn) return;
  var how = document.getElementById(btn.getAttribute("aria-controls"));
  if (!how) return;
  var open = btn.getAttribute("aria-expanded") !== "true";
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  how.hidden = !open;
});
document.querySelectorAll("[data-copy]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var text = btn.parentNode.querySelector("pre").textContent;
    var done = function () { btn.textContent = "Copied"; btn.classList.add("done");
      setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
  });
});
