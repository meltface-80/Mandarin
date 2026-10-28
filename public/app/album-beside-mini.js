/* ------------------------------------------------------------------ */
/*  The album view beside the mini player on a desktop (item 164)      */
/* ------------------------------------------------------------------ */
/*
 * On a desktop the mini player stays on screen over an open album, and it
 * can be moved (mini-player-move.js): the album was centred whatever it
 * covered. Now it opens in the room beside the player instead: the player
 * on the right half of the screen (its corner, or dragged top right), the
 * album centred in what is left of it; on the left half, the other way. It
 * follows the player as it is dragged. Where that room would be too narrow
 * for the album (under 600px), it stays centred as before. Desktops only, as
 * the player's moving is; Now playing (the same view) hides the player.
 */
(function albumBesideMini() {
  const bar = document.getElementById("mini-transport");
  const modal = document.getElementById("album-modal");
  if (!bar || !modal || !window.matchMedia) return;
  const desk = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1024px)");
  const GAP = 24, ROOM = 600;

  function place() {
    // the album in three columns over the whole screen (album-wide.js, item 214): no room beside the player to keep
    const open = !modal.classList.contains("hidden") && !modal.classList.contains("np-mode") && !modal.classList.contains("album-wide");
    const shown = !bar.classList.contains("hidden") && bar.offsetWidth > 0;
    let left = "", right = "";
    if (desk.matches && open && shown) {
      const r = bar.getBoundingClientRect(), w = window.innerWidth;
      const onRight = r.left + r.width / 2 > w / 2;
      const room = onRight ? r.left - 2 * GAP : w - r.right - 2 * GAP;
      if (room >= ROOM) {
        if (onRight) right = (w - r.left + GAP) + "px";
        else left = (r.right + GAP) + "px";
      }
    }
    modal.style.paddingLeft = left;
    modal.style.paddingRight = right;
    modal.classList.toggle("beside-mini", !!(left || right));
  }

  // The album opened or closed, the player shown, hidden or moved, the window resized.
  new MutationObserver(place).observe(modal, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(place).observe(bar, { attributes: true, attributeFilter: ["class", "style"] });
  window.addEventListener("resize", place);
  if (desk.addEventListener) desk.addEventListener("change", place); else if (desk.addListener) desk.addListener(place);
  place();
})();
