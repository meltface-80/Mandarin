/* The page's core: Edit album's Version (bug list item 420). */
// This copy's version: its version name (what the Versions tab and its label among versions say), label, catalogue
// number, barcode, country, this pressing's year and format, each as the match applied gives it, else the files, else
// yours (GET /api/album/edit's "version": value, was, from, edited). A field that differs from the match's or the
// files' says theirs under it, with Put back; Save sends them all and the server keeps as yours only those that differ.
// A release applied from here (Find match, Match by sound, another edition) fills every field you haven't changed:
// one you saved as yours stays (the server's word), and one you have typed in since the editor opened stays as typed.
// The words are the Android app's (core AlbumEdit.kt).
const AE_VERSION = ["name", "label", "catno", "barcode", "country", "year", "format"];

/** A field's input. @param {string} f */
const aeVInput = f => /** @type {HTMLInputElement | null} */ (document.getElementById("ae-v-" + f));

/** What is said under a field whose words differ from the match's or the files' ([v]: the field's "version" entry; [matched]: a match is applied), as AlbumEdit.versionWas. @param {any} v @param {string} now @param {boolean} matched */
function aeVersionWasText(v, now, matched) {
  const was = (v && v.was) || "";
  if (now.trim() === was) return null;
  const from = (v && v.from) || (matched ? "match" : "files");
  return "From the " + (from === "match" ? "match" : "files") + ": " + (was || "(none)") + " · ";
}

/** Under field [f]: what the match or the files say, and Put back, once its words differ. @param {string} f */
function aeVersionWas(f) {
  const box = aeEl && aeEl.querySelector(`[data-ae-was="v-${f}"]`), input = aeVInput(f);
  if (!box || !input || !aeState || !aeState.data) return;
  const v = (aeState.data.version || {})[f];
  const said = aeVersionWasText(v, input.value, !!aeState.data.match);
  box.innerHTML = "";
  if (said == null) return;
  box.appendChild(document.createTextNode(said));
  const b = document.createElement("button");
  b.type = "button"; b.textContent = "Put back"; b.setAttribute("data-parity", "album-edit.put-back");
  b.addEventListener("click", () => {
    input.value = (v && v.was) || "";
    if (aeState && aeState.vTyped) aeState.vTyped.delete(f);
    aeVersionWas(f);
  });
  box.appendChild(b);
}

/** The editor's view [d] in the fields: every one, or ([keepTyped]) those not typed in since it opened. @param {any} d @param {boolean} keepTyped */
function aeVersionShow(d, keepTyped) {
  if (!aeState) return;
  if (!keepTyped || !aeState.vTyped) aeState.vTyped = new Set();
  const box = document.getElementById("ae-version");
  if (box) box.classList.toggle("hidden", !(d && d.version && d.version.name));
  for (const f of AE_VERSION) {
    const input = aeVInput(f);
    if (!input) continue;
    if (!aeState.vTyped.has(f)) input.value = (d && d.version && d.version[f] && d.version[f].value) || "";
    aeVersionWas(f);
  }
}

/** The fields emptied, and the section put away until the album's view says its version, as the editor opens on another album. */
function aeVersionClear() {
  const box = document.getElementById("ae-version");
  if (box) box.classList.add("hidden");
  for (const f of AE_VERSION) {
    const input = aeVInput(f);
    if (input) input.value = "";
  }
  if (aeState) aeState.vTyped = new Set();
}

/** Save's "version": each field as typed; null when the editor has none to send. */
function aeVersionBody() {
  if (!aeState || !aeState.data || !aeState.data.version || !aeState.data.version.name) return null;
  /** @type {Record<string, string>} */
  const o = {};
  for (const f of AE_VERSION) { const input = aeVInput(f); if (input) o[f] = input.value.trim(); }
  return o;
}

/** Why the version can't be saved (null: it can): this pressing's year is four digits, or none. @param {any} body */
const aeVersionError = body => body && body.year && !/^\d{4}$/.test(body.year) ? "This pressing's year should be four digits, like 2008." : null;

for (const f of AE_VERSION) {
  const input = aeVInput(f);
  if (input) input.addEventListener("input", () => {
    if (!aeState || !aeState.data) return;
    if (!aeState.vTyped) aeState.vTyped = new Set();
    aeState.vTyped.add(f);
    aeVersionWas(f);
  });
}
