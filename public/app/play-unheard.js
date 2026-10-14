/* ------------------------------------------------------------------ */
/*  Play Unheard — topbar compass button with 2-second spin           */
/* ------------------------------------------------------------------ */
(function initPlayUnheard() {
  const btn        = document.getElementById("play-unheard-topbar");
  const zoneSelect = document.getElementById("zone-select");
  if (!btn) return;

  // `spinEl` is whichever control the user actually pressed — the top-bar
  // compass or the Home tile. Forwarding a click from one to the other would
  // have left the pressed control inert for the two seconds it takes.
  async function playUnheard(spinEl) {
    const el = spinEl || btn;
    const zone = zoneSelect && zoneSelect.value;
    if (!zone) { if (window.__showToast) window.__showToast("Select a zone first"); return; }
    if (el.classList.contains("spinning")) return;

    // Spin the compass for 2 seconds, then fetch. The Random Album disc speeds
    // up from where it is (v0.6.1) rather than jumping to another angle — the
    // same animation, run faster, and (v0.6.10) turning again if it had stopped.
    el.classList.add("spinning");
    const disc = el.querySelector && el.querySelector(".unheard-disc");
    discTurns(disc, Infinity);
    rampDisc(disc, 7.5);   // 6s a turn becomes 0.8s, as it was
    await new Promise(r => setTimeout(r, 2000));

    // The album is CHOSEN here and offered (from Rouen v1.9.3): Play now,
    // Play next or Queue. It used to start playing at once, replacing
    // whatever was on.
    let album = null;
    try {
      const r = await fetch("/api/pick-unheard", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.album) {
        if (window.__showToast) window.__showToast(j.error || "Could not choose an album", "error");
      } else {
        album = j.album;
      }
    } catch (e) {
      if (window.__showToast) window.__showToast("Request failed", "error");
    } finally {
      el.classList.remove("spinning");
      rampDisc(disc, 1);
      // Then still again at the end of the turn it is on: back where it began.
      discTurns(disc, 0);
    }
    if (album) showPick(album);
  }

  // ----- The chosen album, and what to do with it --------------------------
  const pickOv     = document.getElementById("random-pick-overlay");
  const pickArt    = document.getElementById("random-pick-art");
  const pickTitle  = document.getElementById("random-pick-title");
  const pickArtist = document.getElementById("random-pick-artist");
  let picked = null;
  function showPick(album) {
    if (!pickOv) return;
    picked = album;
    pickTitle.textContent = album.title || "Untitled";
    pickArtist.textContent = album.subtitle || "";
    pickArt.textContent = "";
    pickArt.classList.toggle("no-image", !album.image_key);
    if (album.image_key) {
      const img = document.createElement("img");
      img.alt = "";
      img.addEventListener("error", () => { img.remove(); pickArt.classList.add("no-image"); });
      img.src = "/api/image/" + encodeURIComponent(album.image_key) + "?size=600";
      pickArt.appendChild(img);
    }
    for (const b of pickOv.querySelectorAll("[data-kind]")) b.disabled = false;
    pickOv.classList.remove("hidden");
    try { pickOv.querySelector('[data-kind="play_now"]').focus({ preventScroll: true }); } catch (e) { /* focus is a courtesy */ }
  }
  function closePick() {
    if (!pickOv) return;
    pickOv.classList.add("hidden");
    picked = null;
  }
  async function sendPick(kind) {
    const album = picked;
    if (!album) return;
    const zone = zoneSelect && zoneSelect.value;
    if (!zone) { if (window.__showToast) window.__showToast("Select a zone first"); return; }
    // One send per choice: a second tap while the first is on its way would
    // add the album twice.
    for (const b of pickOv.querySelectorAll("[data-kind]")) b.disabled = true;
    try {
      const r = await fetch("/api/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offset: album.offset, zone_or_output_id: zone, kind })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      const said = { play_now: "Playing", play_next: "Playing next", queue: "Queued" }[kind];
      if (window.__showToast) window.__showToast(said + ": " + (album.title || "random album"));
      if (picked === album) closePick();
    } catch (e) {
      if (window.__showToast) window.__showToast(e.message || "Could not start playback", "error");
      for (const b of pickOv.querySelectorAll("[data-kind]")) b.disabled = false;
    }
  }
  if (pickOv) {
    for (const b of pickOv.querySelectorAll("[data-kind]")) {
      b.addEventListener("click", () => sendPick(b.dataset.kind));
    }
    const close = document.getElementById("random-pick-close");
    if (close) close.addEventListener("click", closePick);
    pickOv.addEventListener("click", (e) => {
      if (e.target.classList && e.target.classList.contains("confirm-backdrop")) closePick();
    });
    // Captured on the window, ahead of the album view's and the side menu's own
    // Escape handlers on the document: one Escape closes the popup on top and
    // nothing under it.
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || pickOv.classList.contains("hidden")) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      closePick();
    }, true);
  }

  // The disc's turns: Infinity to keep it going (and start it if it had
  // stopped), 0 to stop at the end of the current turn. The animation stays
  // the same one throughout, so the angle never jumps.
  function discTurns(disc, n) {
    if (!disc || typeof disc.getAnimations !== "function") return;
    const anim = disc.getAnimations()[0];
    if (!anim || !anim.effect) return;   // reduced motion: no animation
    if (n === Infinity) {
      anim.effect.updateTiming({ iterations: Infinity });
      if (anim.playState !== "running") anim.play();
    } else {
      const turn = anim.effect.getTiming().duration || 6000;
      anim.effect.updateTiming({ iterations: Math.floor((Number(anim.currentTime) || 0) / turn) + 1 });
    }
  }

  // Eases the disc's own animation to `rate` times its speed over 0.6s.
  function rampDisc(disc, rate) {
    if (!disc || typeof disc.getAnimations !== "function") return;
    const anim = disc.getAnimations()[0];
    if (!anim) return;   // reduced motion: no animation to speed up
    clearTimeout(disc.__rampTimer);
    const from = anim.playbackRate || 1;
    const t0 = Date.now();
    // Timed steps (~60 a second) rather than requestAnimationFrame: the same
    // smoothness on screen, and a ramp that still finishes if no frame is
    // drawn meanwhile (a backgrounded tab), so the disc never stays fast.
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / 600);
      // Set directly: like updatePlaybackRate() it keeps the current angle,
      // and it is in effect at once rather than at the animation's next
      // "ready", which a ramp of quick steps would outrun.
      anim.playbackRate = from + (rate - from) * (1 - Math.pow(1 - k, 3));
      if (k < 1) disc.__rampTimer = setTimeout(step, 16);
    };
    step();
  }
  btn.addEventListener("click", () => playUnheard(btn));
  window.__playUnheard = playUnheard;
})();
