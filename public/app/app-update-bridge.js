/* ------------------------------------------------------------------ */
/*  Android app only: the app's own update, looked for by the app on   */
/*  GitHub, so one Update button can do the server and the app. Null   */
/*  anywhere else (browsers, the iPhone home-screen app, older apps).  */
/* ------------------------------------------------------------------ */
window.__musicdAppUpd = (function () {
  const app = window.MusicdApp;
  if (!app || typeof app.appUpdateStatus !== "function") return null;
  try { app.pageHandlesUpdates(); } catch (e) { /* an app without this call (older than the page): nothing to do */ }
  const waiters = [];
  const status = () => { try { return JSON.parse(app.appUpdateStatus()); } catch (e) { return null; } };
  window.__musicdAppUpdateChanged = () => { const s = status(); waiters.splice(0).forEach(w => w(s)); };
  return {
    status,
    // Resolves with {current, latest, available} once the app has looked
    // (at most hourly unless forced); never waits more than 12 s.
    look(force) {
      return new Promise(resolve => {
        waiters.push(resolve);
        setTimeout(() => resolve(status()), 12000);
        try { app.lookForAppUpdate(!!force); } catch (e) { resolve(status()); }
      });
    },
    install() { try { app.installAppUpdate(); } catch (e) { /* an app without this call (older than the page): nothing to do */ } }
  };
})();
