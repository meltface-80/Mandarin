/* ------------------------------------------------------------------ */
/*  Settings info-icon toasts                                         */
/* ------------------------------------------------------------------ */
/* An ⓘ after a setting's name: its help, shown when tapped (v0.6.0-RC7 puts
 * every longer explanation behind one, as Smart Picks and the rest had). */
// [key]: its screens-contract key, where its page has one.
function settingsInfo(text, key) {
  const t = String(text == null ? "" : text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return ' <button class="settings-info-btn" type="button" data-info="' + t + '"' + (key ? ' data-parity="' + key + '"' : "") + ' aria-label="Info">ⓘ</button>';
}

(() => {
  let toast = null;
  let dismissTimer = null;

  function getToast() {
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "settings-info-toast";
      toast.setAttribute("role", "tooltip");
      document.body.appendChild(toast);
    }
    return toast;
  }

  function hideToast() {
    if (!toast) return;
    toast.classList.remove("visible");
    clearTimeout(dismissTimer);
  }

  function showToast(text) {
    const t = getToast();
    t.textContent = text;
    t.classList.add("visible");
    clearTimeout(dismissTimer);
    // Long enough to READ (v0.6.1): 5s was gone halfway through the longer
    // notes. About a fifth of a second a word on top of four seconds, at most
    // 25s; any tap elsewhere still closes it at once.
    const words = String(text || "").split(/\s+/).length;
    dismissTimer = setTimeout(hideToast, Math.min(25000, 4000 + words * 220));
  }

  // Every ⓘ was announced as just "Info". Each is named after the setting it
  // explains, read from the label it sits in — the ones in the page now and
  // the ones the settings screens draw later.
  function nameInfoButtons(root) {
    const list = root.matches && root.matches(".settings-info-btn") ? [root]
      : root.querySelectorAll ? root.querySelectorAll(".settings-info-btn") : [];
    for (const btn of list) {
      if (btn.getAttribute("aria-label") && btn.getAttribute("aria-label") !== "Info") continue;
      const host = btn.closest(".settings-label, .settings-block-title") || btn.parentElement;
      const name = host ? host.textContent.replace(/[ⓘ\u24D8]/g, "").trim() : "";
      btn.setAttribute("aria-label", name && name.length <= 60 ? "About " + name : "More information");
    }
  }
  nameInfoButtons(document);
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) nameInfoButtons(n);
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".settings-info-btn");
    if (btn) {
      e.stopPropagation();
      showToast(btn.dataset.info || "");
      return;
    }
    hideToast();
  }, true);
})();
