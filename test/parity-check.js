"use strict";
/*
 * The screens contract on the page (test/parity.test.js, and a classical album's page in test/classical-works.test.js): the
 * check run in the browser.
 */
/*
 * In the page: the screen [name] under [rootSel] checked against [items].
 * What is under the root but another screen's ([shared]: the mini player and
 * the row along the foot, on a wall) is held by that screen's own check.
 * Returns what is wrong, one line each: an empty list is a screen that keeps
 * the contract.
 */
const CHECK = (name, items, rootSel, shared = []) => `(async () => {
  const S = ${JSON.stringify(name)}, items = ${JSON.stringify(items)}, shared = ${JSON.stringify(shared)};
  const root = document.querySelector(${JSON.stringify(rootSel)});
  if (!root) return ["no " + ${JSON.stringify(rootSel)} + " on the page"];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const shown = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const CONTROL = "button, input, select, textarea, a[href], [role=button], [role=tab], [role=slider], [tabindex]:not([tabindex='-1']), [contenteditable=true]";
  const keysOf = e => (e.getAttribute && e.getAttribute("data-parity") || "").split(/\\s+/).filter(k => k.startsWith(S + ".")).map(k => k.slice(S.length + 1));
  const keyOf = e => { for (let x = e; x && x !== root.parentElement; x = x.parentElement) { const k = keysOf(x); if (k.length) return k[0]; } return null; };
  const sharedKeyed = e => { for (let x = e; x && x !== root.parentElement; x = x.parentElement) { const ks = (x.getAttribute && x.getAttribute("data-parity") || "").split(/\\s+/); if (ks.some(k => shared.some(s => k.startsWith(s + ".")))) return true; } return false; };
  const describe = e => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\\s+/).join(".") : "");
  const labelOf = e => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\\s+/g, " ");
  const pattern = l => new RegExp("^" + l.replace(/[.*+?^$()|[\\]\\\\]/g, "\\\\$&").replace(/\\{[^}]+\\}/g, ".+") + "$");
  const el = k => root.querySelector('[data-parity~="' + S + "." + k + '"]');
  const out = new Set();
  // What is on screen now: each control and each thing shown carries a key of the right kind.
  const sweep = (state) => {
    for (const e of root.querySelectorAll(CONTROL)) {
      if (!shown(e) || sharedKeyed(e)) continue;
      const k = keyOf(e);
      if (!k) out.add(state + ": a control the contract doesn't list: " + describe(e) + " (" + labelOf(e) + ")");
      else if (items[k] && items[k].kind !== "action") out.add(state + ": " + k + " is a control; the contract says it only shows");
    }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const p = n.parentElement;
      if (n.textContent.trim() && shown(p) && !p.closest(CONTROL) && !keyOf(p) && !sharedKeyed(p)) out.add(state + ": text the contract doesn't list: " + describe(p) + " (" + n.textContent.trim().slice(0, 40) + ")");
    }
    for (const e of root.querySelectorAll("img, canvas, svg, video")) {
      if (shown(e) && !e.closest(CONTROL) && !keyOf(e) && !sharedKeyed(e)) out.add(state + ": a picture the contract doesn't list: " + describe(e));
    }
    for (const e of root.querySelectorAll("[data-parity]")) for (const k of keysOf(e)) if (!items[k]) out.add("the page has " + S + "." + k + ", which the contract doesn't");
  };
  // Each item of [opener] (none: the screen as it opens) there, and called what the contract says.
  const present = (opener) => {
    for (const [k, it] of Object.entries(items)) {
      if ((it.in || null) !== opener) continue;
      const e = el(k);
      // Shown only sometimes (or only on a desktop): its key is held in the page's source by the gate
      // (npm run parity); here it is checked when it is on screen, as anything on screen is.
      if (it.when || it.only) { if (!e || !shown(e)) continue; }
      else if (!e) { out.add(S + "." + k + " is not on the page"); continue; }
      if (!shown(e)) { out.add(S + "." + k + " is not shown" + (opener ? " once " + opener + " is tapped" : "")); continue; }
      if (it.kind !== "action" || !it.label) continue;
      // The control itself, or the first inside it; a row the page makes tappable itself (a queue's) is its own.
      const target = e.matches(CONTROL) ? e : ([...e.querySelectorAll(CONTROL)].find(shown) || e);
      const labels = [].concat(it.label), got = labelOf(target);
      if (!labels.some(l => pattern(l).test(got))) out.add(S + "." + k + " is called \\"" + got + "\\", the contract says " + labels.map(l => "\\"" + l + "\\"").join(" or "));
    }
  };
  sweep("as it opens");
  present(null);
  for (const opener of [...new Set(Object.values(items).map(it => it.in).filter(Boolean))]) {
    const b = el(opener);
    if (!b || !shown(b)) continue;
    b.click(); await sleep(800);
    sweep(opener + " tapped");
    present(opener);
    // Closed by its own close (a sheet's ✕, "<opener>-close") where it has one; else the opener toggles it.
    const closer = el(opener + "-close");
    if (closer && shown(closer)) closer.click(); else b.click();
    await sleep(300);
  }
  return [...out];
})()`;

module.exports = { CHECK };
