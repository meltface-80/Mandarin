/* The mini transport (app/mini-transport.js), 3 of 5: the progress line, the waveform and the playback modes. */
// Thin progress line along the top of the mini bar (Roon-style).
// `pos` is optional and follows paintSeek's convention: pass the position
// being painted so both the line and the thumb are drawn from one number.
function paintBarProgress(pos) {
  if (!progFill) return;
  const at = Number.isFinite(pos) ? pos
           : (userIsDraggingSeek ? (parseFloat(npSeek.value) || 0) : npNow());
  const pct = npLen > 0 ? Math.max(0, Math.min(100, (at / npLen) * 100)) : 0;
  progFill.style.width = pct.toFixed(2) + "%";
}

// Paint the elapsed portion of the scrubber blue (before the thumb).
// `pos` is passed in rather than read back out of the input: the input is
// step-quantised, so round-tripping through it threw away the sub-second part
// and the fill could only ever move in whole-second jumps.
/* ---------------- Waveform ---------------- */
/*
 * The shape of the track, drawn under the seek bar.
 *
 * Local files and streamed ones alike: Roon sends audio to the endpoint and
 * never to an extension, so the server reads a local file directly and
 * fetches a streamed track from Qobuz or TIDAL with the user's own account to
 * measure it. Either way this end is the same — it asks /api/waveform for a
 * few thousand levels and draws them; a track the server cannot identify
 * answers with none and keeps the plain bar.
 *
 * The canvas is decoration UNDER the range input, never a replacement for it:
 * the input keeps the drag, the keyboard, the thumb and the disabled state,
 * and if any of this fails the bar is exactly what it was before.
 */
const npWave = document.getElementById("np-wave");
const npProgressEl = document.querySelector(".np-progress");
let npWavePeaks = null;     // Uint8Array for the current track, or null
let npWaveKey = "";         // which track those peaks are for
let npWaveReq = 0;          // generation, so a slow answer cannot land late

function npWaveIdentity() {
  const np = (currentZone && currentZone.now_playing) || null;
  if (!np) return null;
  const t3 = np.three_line || {};
  const track  = t3.line1 || np.line1 || "";
  const artist = t3.line2 || np.line2 || "";
  const album  = t3.line3 || np.line3 || "";
  return track ? { track, artist, album, key: track + " " + album } : null;
}

// Redraw when the canvas changes size (v0.6.1). drawWave sizes its bars
// from the canvas's width AT THE TIME IT DRAWS, and while a track is paused
// nothing else redraws it — so a reflow after the draw (a web font arriving
// and moving the time labels, a rotation, a resize) left the shape
// stretched to the old width, its silences a couple of pixels off the
// playhead.
if (npWave && typeof ResizeObserver === "function") {
  let lastW = -1, lastH = -1;
  new ResizeObserver(() => {
    const w = npWave.clientWidth, h = npWave.clientHeight;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    if (npWavePeaks && npWavePeaks.length) drawWave();
  }).observe(npWave);
}

function drawWave(pos) {
  if (!npWave || !npProgressEl) return;
  const peaks = npWavePeaks;
  if (!peaks || !peaks.length) {
    npWave.classList.add("hidden");
    npProgressEl.classList.remove("has-wave");
    return;
  }
  npWave.classList.remove("hidden");
  npProgressEl.classList.add("has-wave");

  // Size the backing store to the DEVICE pixels actually on screen, or the
  // bars are soft on every phone made in the last decade.
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(npWave.clientWidth));
  const h = Math.max(1, Math.round(npWave.clientHeight));
  if (npWave.width !== w * dpr || npWave.height !== h * dpr) {
    npWave.width = w * dpr; npWave.height = h * dpr;
  }
  const ctx = npWave.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cs = getComputedStyle(document.documentElement);
  const played = cs.getPropertyValue("--accent").trim() || "#4cb7e6";
  // The track ahead is drawn in the TEXT colour, not the border colour: it is
  // the shape of the music and it should be as legible as the title above it.
  // `--text` is near-white on the dark palettes and near-black on the light
  // ones, so "white" here means "reads clearly", in both.
  const ahead  = cs.getPropertyValue("--text").trim() || "#e9eaec";
  const at = Number.isFinite(pos) ? pos : npNow();
  const frac = npLen > 0 ? Math.max(0, Math.min(1, at / npLen)) : 0;

  /*
   * WHERE THE THUMB ACTUALLY IS, which is not frac * width.
   *
   * A range input cannot let its thumb hang off either end, so the CENTRE
   * travels from thumbW/2 to width - thumbW/2 rather than from 0 to width.
   * The bars were laid from 0 to w regardless, so the two mappings from TIME
   * to X disagreed by thumbW * (0.5 - frac): half a thumb ahead of the music
   * at the start, level in the middle, half a thumb behind it at the end. On
   * a phone that is seven pixels of a ~350px bar — several seconds of a
   * five-minute track — and it reads as the waveform failing to keep up.
   * Zero in the middle, which is how it survived being looked at.
   *
   * So the shape is inset to the thumb's travel and both are computed from
   * `span`. A peak is then under the dot at the moment you hear it, at every
   * point in the track rather than only halfway through.
   */
  // Read from the PROGRESS block, which is where --seek-thumb is declared —
  // a custom property inherits downward, so asking documentElement (its
  // ancestor, not its descendant) would silently get nothing and fall back.
  const thumbW = parseFloat(
    getComputedStyle(npProgressEl).getPropertyValue("--seek-thumb")) || 14;
  const inset = thumbW / 2;
  const span = Math.max(1, w - thumbW);
  const head = inset + frac * span;

  /*
   * ONE BAR PER DEVICE-PIXEL PITCH, not per 2 CSS pixels.
   *
   * A phone has three device pixels to every CSS one and the old step threw
   * two of them away: ~190 bars for a five-minute track, a second and a half
   * each, which is a coarse picture of a record however well it is measured.
   * Two device pixels of ink and one of gap gives ~360 on the same phone, and
   * each one lands on a whole device pixel, so they stay separate instead of
   * blurring into a band. The store holds 4000 values, so there is data for
   * them.
   *
   * Drawn in DEVICE pixels for that reason — the transform is dropped here
   * and put back at the end. A screen with no pixels to spare keeps the old
   * one-and-one, because at 1x a two-pixel bar and a one-pixel gap is a
   * different, worse drawing rather than a finer one.
   */
  const pitch = dpr >= 2 ? 3 : 2;
  const ink = pitch - 1;
  const devSpan = span * dpr, devInset = inset * dpr, devHead = head * dpr;
  const bars = Math.max(1, Math.floor(devSpan / pitch));
  // Fractional so the bars fill the travel exactly; the LEFT EDGE of each is
  // rounded, which is what keeps them crisp.
  const step = devSpan / bars;
  const mid = Math.round((h / 2) * dpr);
  const height = (h - 2) * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < bars; i++) {
    /*
     * Folded the way the server folds, and for the same reason: these are RMS
     * levels, so the RMS of them is exactly the level of the whole span — a
     * bar drawn from eleven stored values is the same height it would be if
     * the track had been analysed straight into this many buckets. A MAXIMUM
     * here would put the flattening straight back, because the loudest bucket
     * in a bar of a limited record is the same number in every bar of it.
     */
    const a = Math.floor(i * peaks.length / bars);
    const b = Math.min(peaks.length, Math.max(a + 1, Math.floor((i + 1) * peaks.length / bars)));
    let sum = 0;
    for (let j = a; j < b; j++) sum += peaks[j] * peaks[j];
    const v = Math.sqrt(sum / (b - a));
    /*
     * NOT ROUNDED TO A WHOLE PIXEL. Everything up to here is exact and then
     * the height used to be snapped to a pixel, which threw away more than
     * the stored value ever had: at 34px a whole pixel is 2.9% of full scale
     * against a stored value good to 0.4%. A fractional height antialiases
     * the two END CAPS and nothing else — the bar stays on whole device
     * pixels horizontally, so the top edge gains precision rather than the
     * whole shape losing crispness.
     *
     * The floor stays, in device pixels: silence is a line rather than a gap,
     * because a gap reads as "the waveform stopped loading".
     */
    const barH = Math.max(1, (v / 255) * height);
    const x = Math.round(devInset + i * step);
    // A bar counts as played once its MIDDLE is behind the playhead, so the
    // boundary lands where the dot is rather than a bar's width either side.
    const done = (x + ink / 2) <= devHead;
    ctx.fillStyle = done ? played : ahead;
    // The played side goes to full strength so the accent still reads as the
    // position marker against a now-bright track ahead of it.
    ctx.globalAlpha = done ? 1 : 0.72;
    // Centred on the midline exactly. Rounding the offset as well as the
    // height pushed an odd-numbered bar half a pixel upwards, every time.
    ctx.fillRect(x, mid - barH / 2, ink, barH);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// The switch's state, fetched once. loadWaveformEnabled() in the settings
// module also writes window.__waveformOn, but that only runs when the
// Settings pane is opened — without this the waveform stayed invisible on a
// fresh load until you happened to go and look at the setting.
let waveFlagPending = null;
function waveformOn() {
  if (window.__waveformOn !== undefined) return Promise.resolve(window.__waveformOn);
  if (!waveFlagPending) {
    waveFlagPending = fetch("/api/settings/waveform")
      .then(r => (r.ok ? r.json() : null))
      .then(j => { window.__waveformOn = !!(j && j.enabled); return window.__waveformOn; })
      .catch(() => { window.__waveformOn = false; return false; });
  }
  return waveFlagPending;
}

async function loadWaveform() {
  if (!npWave) return;
  const on = await waveformOn();
  const id = npWaveIdentity();
  if (!id || !on) {
    npWavePeaks = null; npWaveKey = "";
    drawWave();
    return;
  }
  if (id.key === npWaveKey) return;    // same track: what we have still applies
  npWaveKey = id.key;
  npWavePeaks = null;
  drawWave();                          // plain bar while we ask
  const mine = ++npWaveReq;
  try {
    // The LENGTH goes with it. For a streaming track the server has no file
    // and matches the track on the service by title AND duration — without
    // this it cannot tell a song from a remaster of it that shares the title,
    // so it declines rather than guessing and nothing is ever drawn.
    const q = "track=" + encodeURIComponent(id.track) +
              "&album=" + encodeURIComponent(id.album) +
              "&artist=" + encodeURIComponent(id.artist) +
              "&length=" + encodeURIComponent(npLen || 0);
    const r = await fetch("/api/waveform?" + q);
    if (!r.ok) return;
    const j = await r.json();
    // The track may have moved on while the server was decoding. Landing a
    // stale waveform under a different song is worse than none: it looks
    // authoritative and it is simply the wrong shape.
    //
    // The KEY check is the one that does the work, and it catches two things:
    // a skip (the key is now the next track's) and the setting being switched
    // off mid-decode (__repaintWaveform blanks the key without touching the
    // generation). The generation is belt and braces — every path that bumps
    // it without changing the key is a repeat request for the SAME track, so
    // a late answer there is the right shape anyway. It stays because it is
    // what keeps this correct if the key logic is ever changed.
    if (mine !== npWaveReq || npWaveKey !== id.key) return;
    // "busy" means the server is decoding a DIFFERENT track and will be free
    // in a moment. Leaving the key set would latch this track to no waveform
    // for as long as it plays, so drop it and let the next poll ask again —
    // the request costs nothing while the server is busy, because it answers
    // without decoding.
    if (j && j.reason === "busy") { npWaveKey = ""; return; }
    if (!j || !j.peaks) return;
    const bin = atob(j.peaks);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    npWavePeaks = u8;
    drawWave();
  } catch (e) {
    /* No waveform is a normal answer — a streaming track, an undecodable
       file, the server busy. The plain bar is already showing. */
  }
}

// The settings switch repaints through this rather than reaching into the
// module: turning it off must clear a waveform already on screen.
window.__repaintWaveform = () => { npWaveKey = ""; loadWaveform(); };

function paintSeek(pos) {
  if (!npSeek) return;
  const max = parseFloat(npSeek.max) || 0;
  // Number.isFinite, not `!= null`: NaN passes a null check and would reach
  // the gradient string as "NaN%", which is invalid and drops the fill
  // entirely rather than reading zero.
  const val = Number.isFinite(pos) ? pos : (parseFloat(npSeek.value) || 0);
  const pct = max > 0 ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;

  // The waveform carries the same progress, from the same number, so the two
  // can never disagree about where the track is. Drawn FIRST because this is
  // what adds and removes .has-wave, which the fill below reads.
  drawWave(val);

  // With a waveform showing, the range's own 4px track draws a line straight
  // through the middle of the shape, and the canvas already paints the
  // played/unplayed split. The stylesheet sets --seek-fill to transparent for
  // that case, but an INLINE custom property beats any stylesheet rule
  // however specific, so it has to be REMOVED here rather than overridden —
  // writing the gradient unconditionally is what put a grey line across the
  // waveform in v1.7.90.
  if (npProgressEl && npProgressEl.classList.contains("has-wave")) {
    npSeek.style.removeProperty("--seek-fill");
    return;
  }
  // The unplayed part in --seek-rest where a theme sets it (Mandarin's
  // level meter uses its unlit-segment colour), the border colour otherwise.
  npSeek.style.setProperty("--seek-fill",
    "linear-gradient(to right, var(--accent) 0%, var(--accent) " + pct + "%, " +
    "var(--seek-rest, var(--border)) " + pct + "%, var(--seek-rest, var(--border)) 100%)");
}

async function seek(seconds) {
  if (!currentZone) return;
  // Believe our own seek, BEFORE the await so the caller can paint straight
  // after this returns into its first suspension. The refresh scheduled below
  // almost always arrives before Roon has applied the seek, so the pre-seek
  // position came back and yanked the bar to where it had just been — then a
  // later poll yanked it forward again. Two visible jumps for one drag.
  // Base and hold are set together, here, so a future second caller cannot
  // get one without the other and freeze the bar at a stale position.
  npSetBase(seconds);
  npSeekHold = Date.now() + 1500;   // longer than the refresh it guards
  try {
    await fetch("/api/seek", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zone_or_output_id: currentZone.zone_id, seconds })
    });
    setTimeout(fetchState, 200);
  } catch (e) { /* seek is best-effort; fetchState() already scheduled above */ }
}

async function control(command) {
  if (!currentZone) return;
  try {
    const r = await fetch("/api/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zone_or_output_id: currentZone.zone_id, command })
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      console.warn("control failed:", j.error || r.status);
    }
    // Refresh quickly so the icon updates
    setTimeout(fetchState, 200);
  } catch (e) { /* transport control is best-effort; fetchState() already scheduled above */ }
}

// Roon's per-zone playback modes. The server always sends `settings`, but a
// page kept alive across an extension update can briefly be talking to the
// old one — an absent block reads as everything off rather than throwing.
function zoneModes() {
  const s = (currentZone && currentZone.settings) || {};
  return {
    shuffle:    !!s.shuffle,
    loop:       (s.loop === "loop" || s.loop === "loop_one") ? s.loop : "disabled",
    auto_radio: !!s.auto_radio
  };
}

const LOOP_LABEL = { disabled: "Repeat off", loop: "Repeat queue", loop_one: "Repeat track" };
// Tapping repeat cycles off → whole queue → this track, as Roon's remote does.
const LOOP_NEXT  = { disabled: "loop", loop: "loop_one", loop_one: "disabled" };

let lastModeSig = "";
function paintModeButtons() {
  const live = !!currentZone;
  const m = zoneModes();
  // updateNpScreen() runs on the 1.5s poll, and setAttribute() marks an
  // attribute dirty even when the value is unchanged — the same reason the
  // mini bar's repaint is gated by lastBarSig. Nothing below changes unless
  // the zone's modes do, so skip the whole thing when they haven't.
  const sig = [live, m.shuffle, m.loop, m.auto_radio].join("|");
  if (sig === lastModeSig) return;
  lastModeSig = sig;
  if (npShuffle) {
    npShuffle.disabled = !live;
    npShuffle.classList.toggle("is-on", live && m.shuffle);
    npShuffle.setAttribute("aria-pressed", String(live && m.shuffle));
    npShuffle.setAttribute("aria-label", live && m.shuffle ? "Shuffle on" : "Shuffle");
  }
  if (npLoop) {
    const loop = live ? m.loop : "disabled";
    npLoop.disabled = !live;
    npLoop.classList.toggle("is-on", loop !== "disabled");
    npLoop.setAttribute("aria-label", LOOP_LABEL[loop]);
    if (npLoopBadge) npLoopBadge.classList.toggle("hidden", loop !== "loop_one");
  }
}
