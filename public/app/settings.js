/* ------------------------------------------------------------------ */
/*  Settings sheet: theme toggle (lives here now), version, repo link  */
/* ------------------------------------------------------------------ */
// The Settings sheet's toasts go through window.__showToast, the bridge the
// core (app.js) sets beside its own showToast. When the sheet was a block of
// its own, showToast was not in scope here, and bare showToast() calls threw
// ReferenceError instead of showing a message: token saves, display
// settings, and the Qobuz/TIDAL connect flows all failed silently. An alias
// fixed them all at once (v1.0.5: named settingsToast, as the page's parts
// share one top and the core's showToast is a name of its own).
const settingsToast = (msg, kind) => {
  if (window.__showToast) window.__showToast(msg, kind);
};
const openBtn    = document.getElementById("settings-toggle");
const settingsOverlay    = document.getElementById("settings-overlay");
// While Settings covers the page, the page behind it doesn't scroll — so its
// scrollbar isn't drawn beside a Settings page that has nothing to scroll.
const markOpen = () => document.body.classList.toggle("settings-open", !settingsOverlay.classList.contains("hidden"));
new MutationObserver(markOpen).observe(settingsOverlay, { attributes: true, attributeFilter: ["class"] });
markOpen();
const versionEl  = document.getElementById("settings-version");
const radioToggle = document.getElementById("radio-toggle");
const roonRadioToggle = document.getElementById("roon-radio-toggle");
const zoneSelect  = document.getElementById("zone-select");
const labelOrderSelect = document.getElementById("label-order-select");
const labelMinSelect   = document.getElementById("label-min-select");

// Label album order (alphabetical default). Persisted in localStorage and
// read by the labels browser when it loads a label's albums.
if (labelOrderSelect) {
  labelOrderSelect.value =
    localStorage.getItem("rra-label-order") === "random" ? "random" : "alpha";
  labelOrderSelect.addEventListener("change", () => {
    const v = labelOrderSelect.value === "random" ? "random" : "alpha";
    localStorage.setItem("rra-label-order", v);
  });
}

// Minimum albums per label — hides one-off outliers from the labels grid.
if (labelMinSelect) {
  const stored = localStorage.getItem("rra-label-min");
  // "Show all" until chosen otherwise — what labelMin() in the labels browser assumes.
  labelMinSelect.value = (stored === "2" || stored === "5" || stored === "10") ? stored : "1";
  labelMinSelect.addEventListener("change", () => {
    localStorage.setItem("rra-label-min", labelMinSelect.value);
  });
}

// The two radios for the selected zone. Both answer "what plays when this
// queue runs out", so both on means two things racing to fill one queue: the
// server switches the other off, and these read back from it rather than
// assuming it did — a change the Core rejects must not leave a switch lit.
//
// Every paint and every write of the two switches is stamped with a
// generation. Only the newest may paint.
//
// Serialising the writes (below) stops two of them being in flight at once,
// but it cannot stop an answer arriving after the user has tapped again — and
// that answer, painted, drags both switches back to the state before the tap.
// Reads carry a generation for the same reason: loadRadio() is two round
// trips, and a tap during them must win.
let radioGen = 0, radioInFlight = false, radioQueued = null;

function paintRadios(s) {
  if (!s) return;
  if (radioToggle)     radioToggle.checked     = !!s.own;
  if (roonRadioToggle) roonRadioToggle.checked = !!s.roon;
}

// Read both switches for a zone. `gen` is passed by callers that already hold
// one (a write falling back to a re-read); anyone else is the newest intent
// and takes a fresh one.
async function loadRadio(zoneId, gen) {
  // The switches now live on each device's page (initAudioDevicesPane);
  // with neither here there is nothing to read for.
  if (!radioToggle && !roonRadioToggle) return;
  if (!zoneSelect || !zoneSelect.value) return;
  const zone = zoneId || zoneSelect.value;
  const g = (gen === undefined) ? ++radioGen : gen;
  // Together rather than one after the other: sequential awaits painted the
  // two switches a beat apart every time the pane opened.
  const [own, roon] = await Promise.all([
    fetch("/api/radio?zone=" + encodeURIComponent(zone), { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j ? !!j.enabled : null))
      .catch(() => null),   // network error — null means "don't know", below
    fetch("/api/zone-state?zone=" + encodeURIComponent(zone), { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const s = j && j.zone && j.zone.settings;
        return j ? !!(s && s.auto_radio) : null;
      })
      .catch(() => null),
  ]);
  // A newer tap or read happened while these were in the air. Its answer is
  // the current truth and this one would undo it.
  if (g !== radioGen) return;
  // null is "don't know" — leave that switch where it is rather than
  // reporting a radio off because the request for it failed.
  if (own  !== null && radioToggle)     radioToggle.checked     = own;
  if (roon !== null && roonRadioToggle) roonRadioToggle.checked = roon;
}
// One radio write, bounded.
//
// Bounded for the reason postVolume is: neither route answers until Roon's
// change_settings callback fires, and a Core that drops mid-call never
// settles the promise. With the in-flight guard below that would leave the
// switches queueing behind a request that never returns — dead until reload,
// which is the v1.7.69 volume bug wearing a different hat.
//
// Returns the server's `radios` block, or null when it refused or failed —
// the caller re-reads rather than trusting the switch the user moved.
async function postRadio(which, on, zoneId) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const t   = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
  try {
    const r = await fetch(which === "own" ? "/api/radio" : "/api/zone-settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(which === "own"
        ? { zone: zoneId, enabled: on }
        : { zone_or_output_id: zoneId, auto_radio: on }),
      signal: ctl ? ctl.signal : undefined,
    });
    const j = await r.json().catch(() => null);
    return (r.ok && j && j.radios) ? j.radios : null;
  } finally {
    if (t) clearTimeout(t);
  }
}

// Drive one switch. Serialised, latest-wins — the volume control's shape
// (v1.7.69), for its reasons and one of its own.
//
// The two switches write to DIFFERENT endpoints, so with nothing holding them
// apart a quick Random-on then Roon-on puts two requests in flight at once.
// They finish in whatever order the Core answers, the older answer paints
// last, and the switches settle on the tap before last. On the server the two
// routes are reading and writing the same zone set concurrently, and the
// interleaving where each cancels the other's radio leaves BOTH off.
async function writeRadio(which, on) {
  if (!zoneSelect || !zoneSelect.value) return;
  const zoneId = zoneSelect.value;

  // Show the rule NOW: as this switch comes on, the other goes off. It is a
  // rule the client knows and the server is about to confirm, and waiting for
  // a Core round trip to draw it left the other switch lit for long enough to
  // read as broken — displaying, of all things, the both-on state the rule
  // exists to prevent. Reconciled against the server's answer below, the same
  // trade the volume slider makes. Only for ON: the rule is "at most one",
  // so switching a radio off says nothing about the other.
  if (on) paintRadios(which === "own" ? { own: true, roon: false }
                                      : { own: false, roon: true });

  const gen = ++radioGen;
  if (radioInFlight) { radioQueued = { which, on, zoneId, gen }; return; }
  radioInFlight = true;
  let job = { which, on, zoneId, gen };
  try {
    while (job) {
      let radios = null;
      // Inside the loop, so one failed write does not abandon a tap already
      // queued behind it and already painted.
      try { radios = await postRadio(job.which, job.on, job.zoneId); }
      catch (e) { radios = null; }   // blip, or the 5s timeout above
      // Superseded: a newer tap is queued or already painted, and this answer
      // describes the state before it.
      if (job.gen === radioGen) {
        if (radios) paintRadios(radios);
        // Refused or never landed. We don't know what the server did, so go
        // and look rather than leave the switch showing a change that may
        // never have happened.
        else loadRadio(job.zoneId, job.gen);
      }
      job = radioQueued; radioQueued = null;
    }
  } finally {
    // In a finally so an unexpected throw cannot wedge every later tap.
    radioInFlight = false;
  }
}

if (radioToggle) {
  radioToggle.addEventListener("change", () => writeRadio("own", radioToggle.checked));
}
if (roonRadioToggle) {
  roonRadioToggle.addEventListener("change", () => writeRadio("roon", roonRadioToggle.checked));
}
// The switches belong to the selected zone, and nothing re-read them when it
// changed: with the Playback pane open, changing zone left both showing the
// PREVIOUS zone's radios — and the next tap wrote that stale reading to the
// new zone. Runs alongside the other two listeners on this select (the active
// zone, and the now-playing refresh); it only reads.
if (zoneSelect) zoneSelect.addEventListener("change", () => loadRadio());

let versionLoaded = false;
// Still settling: asked again the next time Settings opens.
const going = cs => !!(cs && cs.matched === false && ["asking", "fetching", "downloading", "restarting"].includes(cs.phase));
async function loadVersion() {
  if (versionLoaded || !versionEl) return;
  try {
    const r = await fetch("/api/update/status", { cache: "no-store" });
    if (r.ok) {
      const s = await r.json();
      if (s && s.current) {
        const parts = (s.current || "").split(".");
        versionEl.textContent = parts.length >= 3
          ? "Mandarin v" + parts[0] + "." + parts[1] + " (Build " + parts[2] + ")"
          : "Mandarin v" + s.current;
        // The C# server in front of another version (v0.8.25): being brought
        // up to this one, or (couldn't be) to be brought by a new image.
        const cs = s.csharp;
        if (cs && cs.version && cs.matched === false) {
          versionEl.textContent += going(cs) ? " · bringing its C# server up to date"
            : " · C# server v" + cs.version + (s.is_docker ? " (pull the image again to update it)" : "");
          versionEl.title = cs.error || "";
        }
        versionLoaded = !going(cs);
      }
    }
  } catch (e) { /* network error loading version — settings panel shows without version, non-critical */ }
}

const forceRescanBtn    = document.getElementById("force-rescan-btn");
const forceRescanStatus = document.getElementById("force-rescan-status");
if (forceRescanBtn) {
  forceRescanBtn.addEventListener("click", async () => {
    if (forceRescanBtn.disabled) return;
    forceRescanBtn.disabled = true;
    forceRescanBtn.textContent = "Starting…";
    if (forceRescanStatus) forceRescanStatus.classList.add("hidden");
    try {
      const r = await fetch("/api/labels/rescan-force", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      forceRescanBtn.textContent = j.started === false ? "Done" : "Rescan started";
      if (forceRescanStatus) {
        forceRescanStatus.textContent = j.started === false
          ? "Labels re-read from the library's tags and folders" + (j.count != null ? ": " + j.count + " label" + (j.count === 1 ? "" : "s") + "." : ".")
          : "Full rescan started — this may take several minutes. Label data will update as results come in.";
        forceRescanStatus.classList.remove("hidden");
      }
      setTimeout(() => {
        forceRescanBtn.disabled = false;
        forceRescanBtn.textContent = "Force rescan";
      }, 5000);
    } catch (e) {
      forceRescanBtn.disabled = false;
      forceRescanBtn.textContent = "Force rescan";
      if (forceRescanStatus) { forceRescanStatus.textContent = "Error: " + e.message; forceRescanStatus.classList.remove("hidden"); }
    }
  });
}

// Whether each API key works (v0.6.1): the server asks the service, and the
// box says so — a brass ✓ and "Checked and working", or a red ✕ and "Not
// accepted". No answer (offline, the service down) is not shown as bad.
function paintKeyCheck(input, badge, j, emptyHint) {
  const state = j && j.set ? j.check : null;
  if (badge) {
    badge.classList.toggle("hidden", state !== "ok" && state !== "invalid");
    badge.classList.toggle("is-ok", state === "ok");
    badge.classList.toggle("is-bad", state === "invalid");
    badge.textContent = state === "ok" ? "✓" : state === "invalid" ? "✕" : "";
    badge.setAttribute("aria-label", state === "ok" ? "Key checked and working"
      : state === "invalid" ? "Key refused by the service" : "");
    badge.title = badge.getAttribute("aria-label");
  }
  if (input) {
    input.classList.toggle("is-ok", state === "ok");
    input.classList.toggle("is-bad", state === "invalid");
    input.placeholder = !(j && j.set) ? emptyHint
      : state === "ok" ? "Checked and working — " + j.masked
      : state === "invalid" ? "Not accepted — paste a new one"
      : "Saved — " + j.masked;
  }
}
function keyStatusText(j) {
  if (!j.set) return "Not set";
  if (j.check === "ok") return "✓ Checked and working: " + j.masked;
  if (j.check === "invalid") return "The service refused this key (" + j.masked + "). Check it was copied in full.";
  return "Current: " + j.masked + " — couldn’t reach the service to check it.";
}

// One API key's box, status line and Save: Discogs' token and FanArt.tv's key.
function wireKey({ route, field, inputId, saveId, statusId, checkId, service, noun }) {
  const input  = document.getElementById(inputId);
  const save   = document.getElementById(saveId);
  const status = document.getElementById(statusId);
  const badge  = document.getElementById(checkId);
  const hint   = input ? input.placeholder : "";
  const paint = (j) => {
    paintKeyCheck(input, badge, j, hint);
    if (status) status.textContent = keyStatusText(j);
  };
  async function load() {
    try {
      const r = await fetch("/api/settings/" + route);
      paint(await r.json());
    } catch (_) { /* display-only status — if the fetch fails, silence is fine; status just stays stale */ }
  }
  if (save) save.addEventListener("click", async () => {
    const value = input ? input.value.trim() : "";
    if (!value) return;
    save.disabled = true;
    try {
      const r = await fetch("/api/settings/" + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value })
      });
      const j = await r.json();
      if (j.ok) {
        if (input) input.value = "";
        paint(j);
        if (j.check === "invalid") settingsToast("Saved, but " + service + " refused this " + noun, "error");
        else settingsToast(service + " " + noun + " saved" + (j.check === "ok" ? " — checked and working" : ""), "ok");
      } else {
        settingsToast(j.error || "Failed to save " + noun, "error");
      }
    } catch (e) {
      settingsToast("Failed: " + e.message, "error");
    } finally {
      save.disabled = false;
    }
  });
  return load;
}
const loadDiscogsToken = wireKey({ route: "discogs-token", field: "token", inputId: "discogs-token-input", saveId: "discogs-token-save",
  statusId: "discogs-token-status", checkId: "discogs-token-check", service: "Discogs", noun: "token" });
const loadFanartKey = wireKey({ route: "fanart-key", field: "key", inputId: "fanart-key-input", saveId: "fanart-key-save",
  statusId: "fanart-key-status", checkId: "fanart-key-check", service: "FanArt.tv", noun: "key" });
const loadLastfmKey = wireKey({ route: "lastfm-key", field: "key", inputId: "lastfm-key-input", saveId: "lastfm-key-save",
  statusId: "lastfm-key-status", checkId: "lastfm-key-check", service: "Last.fm", noun: "key" });
