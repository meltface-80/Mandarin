/* The page's core: Edit album's Match by sound (bug list item 419). */
// Match by sound: the album's tracks fingerprinted on the server now (the ones it has kept used again) and looked up
// on AcoustID with your key, then the releases the tracks are on, each with how many of them agree and how sure the
// scan is, and why; a tap applies one as Find match's are applied (/api/identify/match, how "sound"). Under way, it
// says how far it has got; it carries on while the editor is closed, and the editor picks it up when opened again.
const aeSound = aeEl && {
  btn: document.getElementById("ae-match-sound"),
  box: document.getElementById("ae-sound"),
  status: document.getElementById("ae-sound-status"),
  list: document.getElementById("ae-sound-cands")
};

/* What Match by sound says, as [bold, rest], for the job's state [j] (GET /api/identify/sound). */
function aeSoundSaid(j) {
  const n = (k, one, many) => k + " " + (k === 1 ? one : many);
  if (j.state === "fingerprinting") return [j.of ? "Fingerprinting " + Math.min((j.done || 0) + 1, j.of) + " of " + n(j.of, "track", "tracks") + "…" : "Fingerprinting the tracks…", " On the server, a track at a time."];
  if (j.state === "asking") return ["Asking AcoustID…", " " + (j.done || 0) + " of " + n(j.of || 0, "track", "tracks") + " (three a second)."];
  if (j.state === "fetching") return ["Asking MusicBrainz for the releases…", " A few seconds: one request a second."];
  switch (j.answer) {
    case "needs-key": return ["No AcoustID key.", " Add an AcoustID key in Settings → API Keys."];
    case "refused": return ["AcoustID refused the key.", " Check it in Settings → API Keys."];
    case "limited": return ["AcoustID asks to wait.", " Try again in a few minutes."];
    case "unreachable": return ["AcoustID can't be reached.", " Try again later."];
    case "no-match": return ["AcoustID doesn't know these recordings.", " Try Find match, or the barcode."];
    case "no-files": return ["No files to listen to.", " Only an album's own files can be matched by sound."];
    case "failed": return ["Matching by sound didn't work", " (" + (j.error || "no answer") + ")."];
    default: return (j.releases || []).length ? ["By sound:", " the releases these tracks are on. Tap the right one to apply."] : ["AcoustID doesn't know these recordings.", " Try Find match, or the barcode."];
  }
}

/* A release's second line: as Find match's, and how many of the tracks are on it by sound. */
const aeSoundLine = c => [aeMatchLineFor(c), c.heard + " of " + c.tracks_heard + " tracks by sound"].filter(Boolean).join(" · ");

function aeSoundShow(j) {
  const [bold, rest] = aeSoundSaid(j);
  aeSound.box.classList.remove("hidden");
  aeSound.status.innerHTML = "<strong>" + escapeHtml(bold) + "</strong>" + escapeHtml(rest);
  aeSound.list.innerHTML = "";
  if (j.state !== "done") return;
  for (const c of j.releases || []) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ae-mcand"; b.setAttribute("data-parity", "album-edit.sound-release");
    const top = document.createElement("div"); top.className = "ae-mcand-top";
    const t1 = document.createElement("span"); t1.className = "ae-mcand-t"; t1.textContent = (c.artist ? c.artist + " — " : "") + (c.title || "—");
    const pc = document.createElement("span"); pc.className = "ae-mcand-pc" + (c.confidence >= 90 ? " is-sure" : ""); pc.textContent = c.confidence + " % sure";
    top.append(t1, pc);
    const t2 = document.createElement("div"); t2.className = "ae-cand-s"; t2.textContent = aeSoundLine(c);
    b.append(top, t2);
    // How sure, and why (item 414b), past how it was found (the line above says it).
    const why = (c.reasons || []).slice(1);
    if (why.length) { const t3 = document.createElement("div"); t3.className = "ae-mreasons"; t3.textContent = why.join(" · "); b.append(t3); }
    b.addEventListener("click", async () => {
      aeSound.list.querySelectorAll(".ae-mcand").forEach(x => { x.disabled = true; });
      await aeMatch(c.mbid, "sound", b);
      aeSound.list.querySelectorAll(".ae-mcand").forEach(x => { x.disabled = false; x.classList.toggle("is-picked", x === b && !ae.err.textContent); });
    });
    aeSound.list.appendChild(b);
  }
}

/* The job followed until it is done, while the editor shows its album. */
async function aeSoundFollow(mine) {
  for (;;) {
    if (aeState !== mine) return;
    let j;
    try {
      const r = await fetch(`/api/identify/sound?offset=${mine.album.offset}`);
      j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    } catch (e) {
      if (aeState === mine) { aeSoundShow({ state: "done", answer: "failed", error: e.message }); aeSound.btn.disabled = false; }
      return;
    }
    if (aeState !== mine) return;
    if (j.state === "none" || j.state === "busy") { aeSound.btn.disabled = false; return; }
    aeSoundShow(j);
    if (j.state === "done") { aeSound.btn.disabled = false; return; }
    await new Promise(r => setTimeout(r, 700));
  }
}

async function aeSoundStart() {
  if (!aeState) return;   // the album's offset is all it needs: no wait for the editor's view
  const mine = aeState;
  aeSound.btn.disabled = true;
  aeSoundShow({ state: "fingerprinting", done: 0, of: 0 });
  try {
    const r = await fetch("/api/identify/sound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offset: mine.album.offset }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  } catch (e) {
    if (aeState === mine) { aeSound.status.textContent = e.message; aeSound.btn.disabled = false; }
    return;
  }
  aeSoundFollow(mine);
}

/* The editor opened on an album: the box emptied, and a job under way for it (or just done) picked up. */
function aeSoundReset() {
  if (!aeSound || !aeSound.btn) return;
  aeSound.box.classList.add("hidden");
  aeSound.status.textContent = ""; aeSound.list.innerHTML = "";
  aeSound.btn.disabled = false;
  if (aeState) aeSoundFollow(aeState);
}

if (aeSound && aeSound.btn) aeSound.btn.addEventListener("click", aeSoundStart);
