/* Now playing's signal path (item 247): the lines under the album, centred — what goes out, how it was made, what is
   being made for next time — and, a tap on them away, every step of the way from the file to the room, as the server
   says it (now_playing.signal: SignalPath.cs). Each step's dot says what it did to the sound: nothing (lossless), on
   purpose (enhanced), lost some (lossy), or not yet (pending). An older server's badge is drawn as it was. */
const npSignalLines = document.getElementById("np-signal-lines");
const npSignal = document.getElementById("np-signal");
const npSignalSteps = document.getElementById("np-signal-steps");
let lastNpSignal = null, npSignalData = null;

// The signal's lines drawn under the album, in the badge's place; false when there are none (a phone, a Sonos room,
// an older server: the badge is drawn instead).
function paintNpSignal(np) {
  const s = np && np.signal;
  if (!npSignalLines || !s || !Array.isArray(s.lines) || !s.lines.length) {
    if (npSignalLines) npSignalLines.classList.add("hidden");
    npSignalData = null; lastNpSignal = null; closeNpSignal();
    return false;
  }
  npSignalData = s;
  const sig = JSON.stringify(s);
  if (sig === lastNpSignal) return true;
  lastNpSignal = sig;
  lastNpFormatSig = null;   // the badge, should it come back, is drawn afresh
  if (npFormat) npFormat.className = "np-format hidden";
  npSignalLines.textContent = "";
  npSignalLines.classList.remove("hidden");
  s.lines.forEach((line, i) => {
    const l = document.createElement("span");
    l.className = "np-signal-line" + (i === 0 ? " is-out" : "");
    l.textContent = line;
    npSignalLines.appendChild(l);
  });
  if (npSignal && !npSignal.classList.contains("hidden")) drawNpSignalSteps();
  return true;
}

function drawNpSignalSteps() {
  if (!npSignalSteps || !npSignalData) return;
  npSignalSteps.textContent = "";
  for (const step of npSignalData.steps || []) {
    const li = document.createElement("li");
    li.className = "np-signal-step is-" + (step.quality || "pending");
    li.setAttribute("data-parity", "now-playing.signal-step");
    const dot = document.createElement("span");
    dot.className = "np-signal-dot";
    dot.setAttribute("aria-hidden", "true");
    const words = document.createElement("div");
    const title = document.createElement("div");
    title.className = "np-signal-title";
    title.textContent = step.title || "";
    const detail = document.createElement("div");
    detail.className = "np-signal-detail";
    detail.textContent = step.detail || "";
    words.append(title, detail);
    // A step that can be acted on: the bit-perfect check (item 275), asked for here, its progress and verdict said in the step.
    if (step.action === "bitperfect" && step.button) words.append(npSignalCheck(step.button));
    li.append(dot, words);
    npSignalSteps.appendChild(li);
  }
}

// The bit-perfect check's button: the track played again from its start and checked; why not, said in a toast.
function npSignalCheck(label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "np-signal-action";
  b.textContent = label;
  b.setAttribute("data-parity", "now-playing.signal-check");
  b.addEventListener("click", async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try {
      const r = await fetch("/api/bitperfect", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_or_output_id: currentZone && currentZone.zone_id }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); if (window.__showToast) window.__showToast(j.error || "The check couldn't start", "error"); b.disabled = false; }
      setTimeout(fetchState, 300);
    } catch (err) { b.disabled = false; }
  });
  return b;
}

function openNpSignal() {
  if (!npSignal || !npSignalData) return;
  drawNpSignalSteps();
  npSignal.classList.remove("hidden");
  npSignalLines.setAttribute("aria-expanded", "true");
}

function closeNpSignal() {
  if (!npSignal || npSignal.classList.contains("hidden")) return;
  npSignal.classList.add("hidden");
  if (npSignalLines) npSignalLines.setAttribute("aria-expanded", "false");
}

if (npSignalLines) npSignalLines.addEventListener("click", (e) => {
  e.stopPropagation();
  if (npSignal && npSignal.classList.contains("hidden")) openNpSignal(); else closeNpSignal();
});
document.addEventListener("click", (e) => { if (npSignal && !npSignal.contains(e.target)) closeNpSignal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNpSignal(); });
