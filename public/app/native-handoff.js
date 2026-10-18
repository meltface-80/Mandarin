/* ------------------------------------------------------------------ */
/*  Android app only: what its native screens hand back to the page    */
/*  (docs/specs/native-parity.md). A native screen that has an item     */
/*  the page does with its own sheet or its own room asks for it here,  */
/*  by name, rather than reaching into the page: Group zones and Device */
/*  power open the page's own sheets; a room chosen on Play on becomes  */
/*  the page's room too, so its mini player follows. True when done.    */
/* ------------------------------------------------------------------ */
window.__musicdNative = function (what, arg) {
  if (what === "group") { openGroupSheet(); return true; }
  if (what === "power") { openDevicePowerSheet(); return true; }
  if (what === "zone") {
    if (!zoneSel || !arg || ![...zoneSel.options].some(o => o.value === arg)) return false;
    if (zoneSel.value !== arg) { zoneSel.value = arg; zoneSel.dispatchEvent(new Event("change")); }
    return true;
  }
  return false;
};
