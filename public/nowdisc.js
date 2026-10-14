// @ts-check
/*
 * nowdisc.js — a small disc on an album page's playing track (v1.0.1): set
 * between the track's number and its name, centred in the space between
 * them, on the name's line and inside the row's lines. It turns while the
 * zone plays and stops where it is when it pauses; with reduced motion it
 * stands still. The titles don't move for it.
 *
 * The playing track is the selected zone's (app.js's __getCurrentNp), found
 * on the page by its id (each row's data-track-id). Looked at again whenever
 * the album's rows are drawn and whenever the mini player changes (its title,
 * or its play button's Play or Pause).
 */
(function nowDisc() {
  "use strict";
  const rows = document.getElementById("modal-tracks");
  const bar = document.getElementById("mini-transport");
  if (!rows || !bar) return;
  const w = /** @type {any} */ (window);
  const DISC = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" opacity=".16"/><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2.5v3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  /** @type {CanvasRenderingContext2D | null} */
  let pen = null;

  /**
   * How wide the row's number is drawn (its ::before), to centre the disc
   * between the number's end and the name's start.
   * @param {Element} li
   * @param {number} n
   * @returns {number}
   */
  function numberWidth(li, n) {
    const cs = getComputedStyle(li, "::before");
    if (!pen) pen = document.createElement("canvas").getContext("2d");
    if (!pen) return 7 * String(n).length;
    pen.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return pen.measureText(String(n)).width;
  }

  /**
   * The row's gap, which the disc's slot takes back so the name doesn't move;
   * and where the disc goes from the number's box (where the slot starts): the
   * middle of the room between the number's last figure and the name.
   * @param {HTMLElement} li
   * @param {number} n
   * @returns {{ gap: number, x: number }}
   */
  function placeFor(li, n) {
    const box = parseFloat(getComputedStyle(li, "::before").width) || 22;
    const gap = parseFloat(getComputedStyle(li).columnGap) || 0;
    return { gap, x: (numberWidth(li, n) - box + gap) / 2 };
  }

  function sync() {
    const np = typeof w.__getCurrentNp === "function" ? w.__getCurrentNp() : null;
    const id = np && np.track_id != null ? String(np.track_id) : "";
    const pp = document.getElementById("mt-playpause");
    const paused = !pp || pp.getAttribute("aria-label") !== "Pause";
    const list = /** @type {HTMLElement[]} */ ([...rows.querySelectorAll("li.t-row")]);
    list.forEach((li, i) => {
      const on = id !== "" && li.dataset.trackId === id;
      let disc = /** @type {HTMLElement | null} */ (li.querySelector(":scope > .now-disc"));
      if (!on) { if (disc) disc.remove(); li.classList.remove("is-now-track"); return; }
      if (!disc) {
        disc = document.createElement("span");
        disc.className = "now-disc";
        disc.innerHTML = DISC;
        li.insertBefore(disc, li.firstChild);
      }
      li.classList.add("is-now-track");
      disc.classList.toggle("is-paused", paused);
      const at = placeFor(li, i + 1);
      disc.style.marginLeft = -at.gap + "px";
      disc.style.setProperty("--nd-x", at.x.toFixed(1) + "px");
    });
  }

  let queued = false;
  const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; sync(); }); };
  new MutationObserver(soon).observe(rows, { childList: true });
  new MutationObserver(soon).observe(bar, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label"] });
  sync();
})();
