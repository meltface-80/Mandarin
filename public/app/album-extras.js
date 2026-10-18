/* The page's core (app.js until v1.0.5), 27 of 33: an album's extras drawn, and what plays where. */
function renderExtras(extras, album) {
  // 1. The release date on a line of its own under the artists (bug list
  // item 28: beside the sleeve a phone has no room for both on one), the
  // label and the score after it. Asked again after an edit, the previous
  // answer's go first, so it never reads "1997 · 1999". The date is the one
  // the Release date sort orders this album by, to the day wherever one is
  // known; the year is the fallback.
  const dateLine = document.getElementById("modal-date");
  dateLine.innerHTML = "";
  const sepBefore = () => {
    if (!dateLine.childNodes.length) return;
    const sep = document.createElement("span");
    sep.className = "modal-subtitle-year";
    sep.textContent = " · ";
    dateLine.appendChild(sep);
  };
  const yearToShow = formatReleaseDate(extras.release_date) || extras.year ||
    (extras.album && extras.album.year ? String(extras.album.year) : "");
  if (yearToShow) {
    const yearSpan = document.createElement("span");
    yearSpan.className = "modal-subtitle-year";
    yearSpan.textContent = yearToShow;
    dateLine.appendChild(yearSpan);
  }
  if (extras.album && extras.album.label) {
    sepBefore();
    const labelBtn = document.createElement("button");
    labelBtn.className = "modal-artist-link";
    labelBtn.textContent = extras.album.label;
    labelBtn.addEventListener("click", () => {
      // Back from the label's albums returns to this page (v0.6.24).
      const back = { album, opts: { source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter } };
      closeModal();
      if (window.__showLabelAlbums) window.__showLabelAlbums(extras.album.label, false, back);
    });
    dateLine.appendChild(labelBtn);
  }
  if (extras.album && typeof extras.album.score === "number" && !isNaN(extras.album.score)) {
    sepBefore();
    const chip = document.createElement("span");
    chip.className = "pitchfork-score";
    chip.textContent = extras.album.score % 1 === 0
      ? extras.album.score + ".0"
      : String(extras.album.score);
    dateLine.appendChild(chip);
    if (extras.album.isBestNewMusic) {
      const bnm = document.createElement("span");
      bnm.className = "bnm-badge";
      bnm.textContent = "BNM";
      dateLine.appendChild(bnm);
    }
  }

  // 2. Album bio section (description + source link; year/label now in subtitle)
  if (extras.album && (extras.album.description || (extras.album.url && extras.album.source))) {
    const section = document.getElementById("album-bio-section");
    const meta    = document.getElementById("album-meta");
    const text    = document.getElementById("album-bio-text");
    const toggle  = document.getElementById("album-bio-toggle");
    const srcLink = document.getElementById("album-bio-source");

    meta.style.display = "none";

    text.textContent = extras.album.description || "";
    text.style.display = extras.album.description ? "" : "none";

    if (extras.album.url && extras.album.source) {
      srcLink.href = extras.album.url;
      // Pitchfork review text is never shown (UK-law compliance) — the
      // link is the way to read it, so say so explicitly.
      srcLink.textContent = extras.album.source === "Pitchfork"
        ? "Read the full review on Pitchfork"
        : "View on " + extras.album.source;
      srcLink.classList.remove("hidden");
    } else {
      srcLink.classList.add("hidden");
    }

    // WHOSE WORDS THESE ARE, when that is not the same as where the link
    // goes. A Pitchfork-reviewed album now shows WIKIPEDIA's description
    // (their own prose never leaves the server), and the only link beside it
    // says "Read the full review on Pitchfork" — which would read as though
    // the paragraph above it were Pitchfork's. It is not, and one line saying
    // so is the difference between a citation and a misattribution.
    const textSrc = document.getElementById("album-bio-text-source");
    if (textSrc) {
      const ds = extras.album.description_source;
      const show = !!(extras.album.description && ds && ds !== extras.album.source);
      if (show && extras.album.description_url) {
        textSrc.innerHTML = "";
        const a = document.createElement("a");
        a.href = extras.album.description_url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "From " + ds;
        textSrc.appendChild(a);
      } else if (show) {
        textSrc.textContent = "From " + ds;
      }
      textSrc.classList.toggle("hidden", !show);
    }

    section.classList.remove("hidden");
    if (extras.album.description) setupBioToggle(text, toggle);
    else toggle.classList.add("hidden");
  }

  // (Artist bio section removed — the album bio is enough, and the
  // artist Wikipedia lookup was prone to returning wrong articles for
  // less-famous artists.)
}

function setupBioToggle(textEl, toggleEl) {
  requestAnimationFrame(() => {
    textEl.dataset.clipped = "true";
    if (textEl.scrollHeight > textEl.clientHeight + 4) {
      toggleEl.classList.remove("hidden");
      toggleEl.textContent = "Show more";
      toggleEl.onclick = () => {
        const isClipped = textEl.dataset.clipped === "true";
        textEl.dataset.clipped = isClipped ? "false" : "true";
        toggleEl.textContent  = isClipped ? "Show less" : "Show more";
      };
    } else {
      toggleEl.classList.add("hidden");
    }
  });
}
// Shared with the artist-albums view and the Qobuz artist screen (separate
// IIFEs) — same clamp/expand behavior everywhere a bio renders.
window.__setupBioToggle = setupBioToggle;

// The phone's own music plays on the phone, through the app, whatever
// zone is picked: the server never has these files.
function invokePhone(album, index, kind) {
  const dl = window.MusicdDownloads;
  if (!dl || typeof dl.playLocal !== "function") { showToast("Only the Mandarin app plays music on this phone", "error"); return false; }
  try { dl.playLocal(phoneKey(album), index, kind); } catch (e) { showToast(e.message, "error"); return false; }
  showToast((kind === "queue" ? "Queued" : kind === "play_next" || kind === "add_next" ? "Next" : "Playing") + " → This phone");
  return true;
}
async function invoke(kind, btn) {
  if (!currentAlbum) return;
  if (isPhoneAlbum(currentAlbum)) { invokePhone(currentAlbum, -1, kind); return; }
  if (!selectedZoneId) { showToast("Pick a zone first", "error"); return; }
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "…";
  try {
    const r = await fetch("/api/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset: currentAlbum.offset,
        // Identity travels with the play so a stale offset is relocated
        // (or refused with a 409) server-side — never played blind.
        title:    currentAlbum.title    || "",
        subtitle: currentAlbum.subtitle || "",
        zone_or_output_id: selectedZoneId,
        kind,
        filter_type:   currentDetailFilter ? currentDetailFilter.type   : "",
        filter_value:  currentDetailFilter ? currentDetailFilter.value  : "",
        filter_parent: currentDetailFilter && currentDetailFilter.parent ? currentDetailFilter.parent : ""
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if (typeof j.offset === "number" && j.offset >= 0) currentAlbum.offset = j.offset;
    const said = { play_now: "Playing", play_next: "Playing next", queue: "Queued", shuffle: "Shuffling", radio: "Radio" }[j.action || kind] || orig;
    showToast(`${said} → ${zoneName(selectedZoneId)}`);
    // Keep the album view open after playing so the user stays on the album.
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

function zoneName(id) {
  const z = zones.find(z => z.zone_id === id);
  return z ? z.display_name : "zone";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

// While a text field has the focus (the keyboard is up), the page says so
// on <html>. The Android app's stylesheet hides the mini transport bar
// then: its WebView shrinks the page to fit above the keyboard, so the bar
// rode up with it and sat on top of the keys. Browsers ignore the class.
(function watchTyping() {
  const typing = el => !!el && (el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && !/^(checkbox|radio|range|button|submit|file|color)$/i.test(el.type || "text")));
  document.addEventListener("focusin", (e) => { if (typing(e.target)) document.documentElement.classList.add("is-typing"); });
  document.addEventListener("focusout", (e) => {
    if (!typing(e.target)) return;
    // The focus may be moving to another field: decide once it has settled.
    setTimeout(() => { if (!typing(document.activeElement)) document.documentElement.classList.remove("is-typing"); }, 50);
  });
})();
