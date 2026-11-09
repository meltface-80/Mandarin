// @ts-check
/* The sign-in page's light/dark choice, the app's own if this device has made one: read before the page is drawn, as
   it was inline in login.html until the page's script was its own files alone (item 366: script-src 'self'). */
try { if (/light/.test(localStorage.getItem("rra-theme-v2") || "")) document.documentElement.dataset.theme = "light"; } catch (e) { /* no storage: dark */ }
