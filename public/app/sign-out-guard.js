/* ------------------------------------------------------------------ */
/*  Signed out (another device signed this one out, or the account was */
/*  reset on the server): any API answer that says so goes to sign-in.  */
/* ------------------------------------------------------------------ */
(function signOutGuard() {
  const real = window.fetch.bind(window);
  let leaving = false;
  window.fetch = async function (input, init) {
    const r = await real(input, init);
    if (r.status === 401 && !leaving) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const u = new URL(url, location.href);
      if (u.origin === location.origin && u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/auth/")) {
        leaving = true;
        location.replace("/login?next=" + encodeURIComponent(location.pathname + location.search));
      }
    }
    return r;
  };
})();
