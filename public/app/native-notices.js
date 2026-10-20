/* ------------------------------------------------------------------ */
/*  Android app only: the page's notices at the head of its screens,   */
/*  told to the app (bug list item 69), whose native Home is in front  */
/*  of them and hid them: the server's notice (server-notice.js: an    */
/*  empty library, no rooms, a music folder gone with Forget) and the  */
/*  update offer (updater.js). The page goes on deciding what they say */
/*  and doing what their buttons do (the app taps them by name,        */
/*  native-handoff.js "notice-button", "update"); the app draws them,  */
/*  told afresh each time either changes (MusicdApp.notices).          */
/* ------------------------------------------------------------------ */
(function nativeNotices() {
  const app = window.MusicdApp;
  const notice = document.getElementById("server-notice"), toast = document.getElementById("update-toast");
  if (!app || typeof app.notices !== "function" || !notice || !toast) return;
  const text = (el) => (el ? el.textContent || "" : "").replace(/\s+/g, " ").trim();
  // The server's notice: one paragraph, or (a folder gone) one per folder with its button.
  const noticeNow = () => {
    if (notice.classList.contains("hidden")) return null;
    const paras = [...notice.children].filter(e => e.tagName === "DIV");
    return { lines: paras.length ? paras.map(text) : [text(notice)], error: notice.classList.contains("error"),
      buttons: [...notice.querySelectorAll(".server-notice-btn")].map(text) };
  };
  const updateNow = () => {
    if (!toast.classList.contains("open")) return null;
    const notes = document.getElementById("update-notes"), now = document.getElementById("update-now"), actions = document.getElementById("update-actions");
    const busy = actions.classList.contains("busy") || now.disabled;
    return { text: text(document.getElementById("update-text")), notes: notes.classList.contains("hidden") ? "" : notes.textContent || "",
      now: busy ? null : text(now), later: !busy, error: toast.classList.contains("is-error") };
  };
  let told = "";
  const tell = () => {
    const now = JSON.stringify({ notice: noticeNow(), update: updateNow() });
    if (now === told) return;
    told = now;
    try { app.notices(now); } catch (e) { /* an app without this call: it shows neither */ }
  };
  const watch = new MutationObserver(tell);
  for (const el of [notice, toast]) watch.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "disabled"] });
  tell();
})();
