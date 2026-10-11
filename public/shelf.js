  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    clearTimeout(d.lp);
    stage.classList.remove("grabbing"); shuttleOn(null);
    if (e.type === "pointercancel") { settleTo(Math.round(p)); return; }
    // A long press chose a track: nothing else — but any drift before it
    // fired is put right, or the shelf would stop a fraction off its album.
    if (d.pressed) { settleTo(Math.round(p)); return; }
    const now = performance.now();
    const dx = d.x - d.x0;
    let v = 0;   // px per ms over the last ~100 ms; a finger that stopped before lifting has none
    const s = d.samples.filter((q) => now - q[0] < 100);
    if (s.length >= 2 && now - s[s.length - 1][0] < 80) v = (s[s.length - 1][1] - s[0][1]) / Math.max(8, s[s.length - 1][0] - s[0][0]);
    if (!d.moved) {
      if (d.caught) { settleTo(Math.round(p)); return; }
      // On the back of a case, a press that slid up or down is not a tap: it
      // neither chooses nor turns the case back.
      if (d.onBack && d.wob > SLOP) { settleTo(Math.round(p)); return; }
      if (d.nav) { turnPage(d.nav); settleTo(Math.round(p)); return; }
      const bk = backOf();
      if (d.track >= 0 && bk) {
        // Shift-click: the run from the last track chosen. Ctrl/⌘-click, or a
        // tap while choosing: this one, in or out.
        if (d.shift) { pickRun(bk._album, d.track); settleTo(Math.round(p)); return; }
        if (d.mod || picking()) { pickTrack(bk._album, d.track); settleTo(Math.round(p)); return; }
      }
      tapAt(e.clientX, e.clientY);
      return;
    }
    if (d.shuttle) { vp = d.rate / 1000; settleTo(Math.round(p + Math.sign(d.rate) * 0.4)); return; }
    // A slow, no-flick swipe still moves one album, even when a busy CI run or
    // a slightly wider stage makes the swipe a touch longer than the ideal step.
    // The velocity check makes sure that a real flick is not treated as a one-step
    // swipe, while a short, slow drag still settles on the next album.
    const oneStep = Math.max(stepPx * SWIPE, clamp(W * 0.16, 80, 240));
    if (Math.abs(v) < 1.5 && Math.abs(dx) <= oneStep) { settleTo(Math.round(d.p0) + (dx < 0 ? 1 : -1)); return; }
    if (Math.abs(v) >= 1.7 && Math.abs(dx) >= Math.max(140, W * 0.16) && now - d.t0 < 700) { spin(v < 0 ? 1 : -1, Math.abs(v)); return; }
    vp = -v / (stepPx * SWIPE);
    if (Math.abs(dx) < clamp(W * 0.16, 80, 240)) { settleTo(Math.round(d.p0) + (dx < 0 ? 1 : -1)); return; }
    settleTo(Math.round(p + vp * 240));
  }
