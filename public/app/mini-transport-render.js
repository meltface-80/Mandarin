/* The mini transport (app/mini-transport.js), 2 of 5: each answer from the server, drawn on the bar and on Now playing. */
// The server's change counter as of the last answer applied, and the zone it
// was for: an answer older than one already painted (a slow one-off fetch
// landing after the long-poll's) is dropped rather than painted backwards.
let stateRev = -1, stateZone = null;
function applyState(zid, j) {
  if (zid !== barZoneId()) return false;
  const rev = typeof j.revision === "number" ? j.revision : -1;
  if (zid === stateZone && rev < stateRev) return false;
  stateRev = rev; stateZone = zid;
  renderZone(j.zone);
  saveTransportState(j.zone);
  return true;
}

async function fetchState() {
  const zid = barZoneId();
  if (!zid) { renderZone(null); return; }   // no zone yet: the bar says so
  try {
    const r = await fetch("/api/zone-state?zone=" + encodeURIComponent(zid), { cache: "no-store" });
    if (!r.ok) return;  // server/network error — keep current state
    applyState(zid, await r.json());
  } catch (e) {
    // network blip — keep what we have
  }
}

function renderZone(zone) {
  currentZone = zone;
  const np = zone && zone.now_playing;
  if (!np) {
    npLen = 0; npSetBase(0); npPrevSrv = null;
    paintBarProgress();
    // The bar is always there, so it can be where a zone is picked: with no
    // zone it says so; with a silent one, whose it is and that it is quiet.
    const idleSig = "idle|" + (zone ? zone.zone_id + "|" + zone.display_name + "|" + (zone.outputs || []).some(o => o.is_muted) : "");
    if (idleSig !== lastBarSig) {
      lastBarSig = idleSig;
      if (kickerEl) kickerEl.textContent = zone ? zone.display_name : "";
      titleEl.textContent  = zone ? "Nothing playing" : "No Zone Selected";
      artistEl.textContent = zone ? "Pick an album to play here" : "Tap the speaker to choose where to play";
      paintTransportArt("");
      iconPlay.classList.remove("hidden"); iconPause.classList.add("hidden");
      btnPP.setAttribute("aria-label", "Play");
      const muted = !!(zone && (zone.outputs || []).some(o => o.is_muted));
      iconVol.classList.toggle("hidden", muted); iconMute.classList.toggle("hidden", !muted);
    }
    refreshVisibility();
    updateNpScreen();
    return;
  }

  // The static mini-bar bits (text, icons, volume) are skipped when nothing
  // changed — this ran every 1.5s before v0.6.10, and unconditional text-node replacement
  // invalidated the fixed bar's paint on every tick even mid-scroll. The
  // seek baseline below always resyncs (it moves every tick by design).
  const volOutput = (zone.outputs || []).find(o => o.volume);
  const muted = (zone.outputs || []).some(o => o.is_muted);
  const playing = zone.state === "playing" || zone.state === "loading";
  const fmt = np.format || null;
  const fmtWord = !fmt ? "" : fmt.kind === "opus" ? ("Opus " + (fmt.text || "").replace(/\s*kbps$/i, "")).trim() : (fmt.text || "");
  const kicker = [zone.display_name, fmtWord].filter(Boolean).join(" · ");
  const barSig = [np.line1, np.line2, np.line3, np.image_key, zone.state, muted, kicker].join("|");
  if (barSig !== lastBarSig) {
    lastBarSig = barSig;
    if (kickerEl) kickerEl.textContent = kicker;

    // Title = track, subtitle = artist · album
    titleEl.textContent  = np.line1 || "—";
    const sub = [np.line2, np.line3].filter(Boolean).join(" · ");
    artistEl.textContent = sub || "—";
    paintTransportArt(np.image_key);

    // Play/pause state
    iconPlay .classList.toggle("hidden",  playing);
    iconPause.classList.toggle("hidden", !playing);
    btnPP.setAttribute("aria-label", playing ? "Pause" : "Play");

    iconVol .classList.toggle("hidden",  muted);
    iconMute.classList.toggle("hidden", !muted);
  }

  // Volume UI — every tick, NOT barSig-gated: a zone switch can leave the
  // signature unchanged, and the sheet must never keep serving the previous
  // zone's range/type. volumeHeld() still guards the value writes.
  if (volOutput) {
    const v = volOutput.volume;
    volSlider.min   = v.min   != null ? v.min  : 0;
    volSlider.max   = volCeiling(v);
    volSlider.step  = v.step  != null ? v.step : 1;
    settleVolumeHold(v.value, v.step);   // once per poll, before either read
    if (!volumeHeld()) {
      volSlider.value = v.value != null ? v.value : 0;
      volVal.textContent = v.value != null ? Math.round(v.value) : "—";
      paintVolFill(volSlider);
    }
    paintVolScale(volMinL, volMaxL, v);
    // Relative-only (incremental) outputs have no absolute scale — the
    // sheet collapses to the −/+ nudge buttons, matching Roon.
    if (volWrap) volWrap.classList.toggle("hidden", (v.type || null) === "incremental");
    btnVol.disabled = false;
  } else {
    btnVol.disabled = true;
  }

  // Reconcile the local clock with the server — do NOT snap to it.
  //
  // What arrives here is always a little stale, by two independent amounts:
  // Roon reports whole seconds (up to 1s of quantisation) on its own ~1Hz
  // event cadence (up to another 1s of age). So the honest expectation is
  // that `srv` sits up to ~2s behind the position already painted, with the
  // two clocks advancing at the same rate thereafter. Assigning it
  // unconditionally is what produced the visible backwards jerk.
  //
  // Re-baseline only when it disagrees by more than that expected lag, which
  // means a real event: a track change, a seek from another remote, a stall.
  // The threshold is deliberately WIDER than the lag it tolerates — too tight
  // and normal staleness re-triggers the jerk this is here to remove. The
  // cost is that an external seek of under ~3s is not followed until the next
  // track change; nobody seeks by two seconds, and our own seeks are exact
  // (npSeekHold below).
  const prevLen = npLen;
  npLen = np.length || 0;
  const srv = np.seek_position != null ? np.seek_position : 0;

  const playingNow   = npPlaying();
  const stateChanged = playingNow !== npWasPlaying;

  // Carry the base forward by the interval just elapsed, using the play state
  // that was in effect FOR that interval, then restart the clock from now.
  //
  // Without this, npBaseAt kept its pre-pause timestamp across a pause and the
  // paused seconds were counted as playback on resume. A 2.5s pause left the
  // bar permanently 2.5s ahead — under the 3s threshold, so never corrected —
  // and a few short pauses accumulated past it, at which point the reconcile
  // fired and yanked the bar back by MORE than three seconds. A rarer, bigger
  // version of the jerk this whole change exists to remove.
  npSetBase(npBase + (npWasPlaying ? (Date.now() - npBaseAt) / 1000 : 0));
  npWasPlaying = playingNow;

  // A track change or a play/pause transition is unambiguous new information,
  // so both take the server's position outright — it is exact at that moment
  // and stale only by the usual fixed lag, whereas the local clock has just
  // counted up to a poll interval of the wrong state. Both bypass the seek
  // hold: gating the track change behind it meant scrubbing to the end of a
  // track — a normal way to skip on — opened the next one pinned at 100%.
  // A server position that has not MOVED since the last poll is not news,
  // it is a stuck feed — and re-baselining to it is how a stuck feed turns
  // into a sawtooth: the local clock counts up, crosses the 3s threshold,
  // gets yanked back to the same stale number, and starts again. Reported
  // as "0 to 4 seconds then returns to 0, and repeats all the time", which
  // is exactly the period this threshold and the poll interval produce.
  //
  // Reconcile against a value that has CHANGED, therefore. When the feed is
  // stuck the local wall clock is the better answer anyway: the track is
  // playing, so time really is passing, whatever the zone last said.
  //
  // A track change or a play/pause transition still takes the server's
  // position outright even when the number repeats — both are unambiguous
  // new information, and at a track change the repeat is usually a genuine
  // 0. Our own seeks are exact and keep their own hold (npSeekHold).
  const srvMoved = npPrevSrv === null || srv !== npPrevSrv;
  npPrevSrv = srv;

  if (npLen !== prevLen || stateChanged) npSetBase(srv);
  else if (srvMoved && Date.now() >= npSeekHold && Math.abs(srv - npNow()) > 3) npSetBase(srv);
  paintBarProgress();

  refreshVisibility();
  updateNpScreen();
}

// Mini bar shows whenever something is playing, EXCEPT on the now-playing
// screen (which has its own transport). It returns on the Queue tab.
// The bar shows everywhere but on the Now playing screen — with nothing
// playing, and with no zone chosen, too: it is where a zone is picked.
function refreshVisibility() {
  bar.classList.toggle("hidden", onNowPlayingScreen());
}

// Last-rendered signature of the mini transport bar's static content —
// renderZone skips its DOM writes while this is unchanged.
let lastBarSig = "";

// Track title with any trailing "(…)" detail broken onto its own line
// (e.g. "Hangover Sex (with Viktoria Tolstoy)" → main line + sub-line).
let lastNpTitle = null;
// The format badge under the album name (now_playing.format from the
// server: { kind: "opus" | "lossless" | "lossy", text }). Opus wears its
// logo, drawn by the stylesheet, beside the bit rate.
let lastNpFormatSig = null;
function paintNpFormat(np) {
  if (!npFormat) return;
  const f = np && np.format;
  const sig = f ? f.kind + "|" + (f.text || "") : "";
  if (sig === lastNpFormatSig) return;
  lastNpFormatSig = sig;
  npFormat.textContent = "";
  npFormat.className = "np-format" + (f ? " is-" + f.kind : " hidden");
  if (!f) { npFormat.removeAttribute("aria-label"); return; }
  if (f.kind === "opus") {
    const logo = document.createElement("span");
    logo.className = "np-format-opus";
    logo.setAttribute("aria-hidden", "true");
    npFormat.appendChild(logo);
  }
  if (f.text) {
    const t = document.createElement("span");
    t.className = "np-format-text";
    t.textContent = f.text;
    npFormat.appendChild(t);
  }
  npFormat.setAttribute("aria-label", f.kind === "opus" ? ("Opus " + (f.text || "")).trim() : f.text);
  npFormat.setAttribute("role", "img");
}

function setNpTrack(title) {
  title = title || "—";
  if (title === lastNpTitle) return;   // poll runs every 1.5s — skip rebuilds
  lastNpTitle = title;
  npTrack.textContent = "";
  const m = /^(.*\S)\s*(\([^()]*\))$/.exec(title);
  if (m) {
    npTrack.append(m[1]);
    const sub = document.createElement("div");
    sub.className = "np-track-sub";
    sub.textContent = m[2];
    npTrack.appendChild(sub);
  } else {
    npTrack.textContent = title;
  }
}

// The artist line, as individual links — the same control the album view
// offers, driven by the same library-validated split (the server sends it on
// now_playing.artists, see creditLinks).
//
// Signature-gated like setNpTrack: this runs on the 1.5s poll, and rebuilding
// a row of buttons every tick would drop keyboard focus mid-press and thrash
// the DOM behind the artwork.
let lastNpArtistSig = null;
function setNpArtists(np) {
  const parts = (np && Array.isArray(np.artists) && np.artists.length)
    ? np.artists
    // Older server, or a credit the server couldn't split (no library yet):
    // show the raw line as plain text rather than nothing.
    : ((np && np.line2) ? [{ name: np.line2, linkable: false }] : []);
  const sig = JSON.stringify(parts);
  if (sig === lastNpArtistSig) return;
  lastNpArtistSig = sig;
  if (!parts.length) { npArtist.textContent = ""; return; }
  if (window.__renderArtistLinks) {
    window.__renderArtistLinks(npArtist, parts, {
      separator: " · ",
      linkClass:  "np-artist-link",
      sepClass:   "np-artist-sep",
      plainClass: "np-artist-plain",
    });
  } else {
    // The modal IIFE didn't export the renderer — never expected, but the
    // artist line must still say who is playing.
    npArtist.textContent = parts.map(p => p.name).join(" · ");
  }
}

// Populate the Roon-style now-playing screen from the live zone state.
function updateNpScreen() {
  // Big art + ambient glow track the playing album on BOTH np-mode tabs —
  // the Queue tab hides the art but shows the glow — so update them BEFORE
  // the tab-album gate below (onNowPlayingScreen() is false on tab-queue,
  // which would otherwise leave the glow stale across album changes).
  const np = currentZone && currentZone.now_playing;
  const npModeVisible = modalEl
    && !modalEl.classList.contains("hidden")
    && modalEl.classList.contains("np-mode");
  if (npModeVisible && bigArt && np && np.image_key && np.image_key !== lastNpImgKey) {
    bigArt.src = "/api/image/" + encodeURIComponent(np.image_key) + "?size=800";
    lastNpImgKey = np.image_key;
    // Same URL as the big art, so the browser serves it from cache.
    if (window.__setModalAmbient) window.__setModalAmbient(bigArt.src);
  }

  if (!npTrack || !onNowPlayingScreen()) return;
  // Playback modes belong to the ZONE, not to the track — a stopped zone can
  // still have shuffle on, and Roon lets you set it before pressing play.
  paintModeButtons();
  paintNpFormat(np);
  if (!np) { setNpTrack(null); setNpArtists(null); npAlbum.textContent = ""; return; }

  setNpTrack(np.line1);
  setNpArtists(np);
  npAlbum.textContent  = np.line3 || "";
  if (npAlbum) npAlbum.setAttribute("aria-label", "Open album: " + (np.line3 || ""));

  const playing = currentZone.state === "playing" || currentZone.state === "loading";
  npIconPlay .classList.toggle("hidden",  playing);
  npIconPause.classList.toggle("hidden", !playing);
  npPlayPause.setAttribute("aria-label", playing ? "Pause" : "Play");
  npPrev.disabled = !currentZone.is_previous_allowed;
  npNext.disabled = !currentZone.is_next_allowed;

  // Progress / seek (blue fill before the thumb, like Roon)
  const seekable = !!currentZone.is_seek_allowed && npLen > 0;
  npSeek.disabled = !seekable;
  // The position the fill is painted from must be the one the thumb is at.
  // A stream with no length pins the input to 0/max 100, and npNow() keeps
  // counting regardless — passing it here would paint a fill under a thumb
  // parked at zero.
  let seekPos = 0;
  if (npLen > 0) {
    npSeek.max = npLen;
    seekPos = userIsDraggingSeek ? (parseFloat(npSeek.value) || 0)
                                 : Math.min(npNow(), npLen);
    if (!userIsDraggingSeek) {
      npSeek.value = seekPos;
      npCur.textContent = fmtTime(seekPos);
    }
    npTot.textContent = fmtTime(npLen);
  } else {
    npSeek.max = 100; npSeek.value = 0;
    npCur.textContent = "0:00"; npTot.textContent = "0:00";
  }
  paintSeek(seekPos);
  // Cheap on every poll: loadWaveform returns immediately unless the track
  // key actually changed, so this is a string compare, not a fetch.
  loadWaveform();

  // Volume — show the controls only when the endpoint has a controllable
  // volume; otherwise show "Volume control is fixed" (matches Roon).
  const volOutput = (currentZone.outputs || []).find(o => o.volume);
  if (volOutput) {
    const v = volOutput.volume;
    npVolSlider.min  = v.min  != null ? v.min  : 0;
    npVolSlider.max  = volCeiling(v);
    npVolSlider.step = v.step != null ? v.step : 1;
    if (!volumeHeld()) {
      npVolSlider.value = v.value != null ? v.value : 0;
      if (npVolValue) npVolValue.textContent = v.value != null ? Math.round(v.value) : "—";
      paintVolFill(npVolSlider);
    }
    paintVolScale(npVolMinL, npVolMaxL, v);
    if (npVolWrap) npVolWrap.classList.toggle("hidden", (v.type || null) === "incremental");
    if (npVolControls) npVolControls.classList.remove("hidden");
    if (npVolFixed) npVolFixed.classList.add("hidden");
  } else {
    if (npVolControls) npVolControls.classList.add("hidden");
    if (npVolFixed) npVolFixed.classList.remove("hidden");
  }
  const muted = (currentZone.outputs || []).some(o => o.is_muted);
  npIconVol .classList.toggle("hidden",  muted);
  npIconMute.classList.toggle("hidden", !muted);
}
