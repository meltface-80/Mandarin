/* The share card (app/share-card.js), 3 of 3: "If you like this", the suggestions under the card. */
/*
 * Each suggestion is somewhere to GO, not a line of text.
 *
 *   IN THE LIBRARY -> a button that queues it. The server resolved it and
 *     sent the offset plus the library's own title and artist, and those go
 *     with the request: /api/play relocates a drifted offset rather than
 *     playing whatever now sits at it, and that guarantee is worth nothing
 *     if the caller does not send the identity to check against.
 *   NOT IN THE LIBRARY -> a link to the default service's search for it.
 *
 * The two are visibly different before they are tapped, because "this adds
 * to your queue" and "this leaves the app" should not look the same.
 */
/*
 * ONE ROW BUILDER, used by the suggestions under the card and by the
 * Discover screen. They ask different questions — "acts like this one" and
 * "new records by acts you play" — but the answer is the same KIND of thing
 * in both: a record that is either in the library or on a service, and the
 * rules about which (send the library's own identity with a queue, leave via
 * the default service otherwise) must not have two implementations that can
 * drift apart. The caller supplies the two lines; everything about where the
 * row GOES lives here.
 *
 * @param {object} item     { in_library, offset, library_title,
 *                            library_subtitle, services[] }
 * @param {string} primary  the bold line
 * @param {string} sub      the quiet line, or ""
 */
function goRow(item, primary, sub, art) {
  const label = document.createElement("span");
  label.className = "share-similar-name";
  label.textContent = primary;
  const rec = document.createElement("span");
  rec.className = "share-similar-rec";
  if (sub) rec.textContent = sub;

  /*
   * WITH ARTWORK, the two lines become a column beside the cover; without it
   * they stay direct children of the row exactly as before.
   *
   * Two shapes rather than one, deliberately. The suggestions under the share
   * card are a compact list inside a sheet and carry no artwork — that is
   * the older decision and this must not quietly change it — while Discover
   * is a full screen of RECORDS, where a wall of text is the odd one out.
   * Callers that pass no art get byte-identical markup to before.
   */
  let holder = null;
  if (art) {
    holder = document.createElement("span");
    holder.className = "row-text";
    holder.appendChild(label);
    if (sub) holder.appendChild(rec);
  }
  const fill = (row) => {
    if (art) { row.appendChild(rowArt(art)); row.appendChild(holder); }
    else { row.appendChild(label); if (sub) row.appendChild(rec); }
  };

  let row;
  if (item.in_library && typeof item.offset === "number") {
    row = document.createElement("button");
    row.type = "button";
    row.className = "share-similar-act is-library";
    fill(row);
    row.appendChild(tagEl("Queue"));
    row.addEventListener("click", () => queueSuggestion(item, row));
  } else {
    const ids = (item.services || []).map(x => x.id);
    const svc = (item.services || []).find(x => x.id === preferredService(ids));
    if (svc) {
      row = document.createElement("a");
      row.className = "share-similar-act is-service";
      row.href = svc.url;
      row.target = "_blank";
      row.rel = "noopener noreferrer";
      fill(row);
      row.appendChild(tagEl(svc.name));
    } else {
      // Nothing to link to — every service switched off, or no record was
      // named. Still shown, because the name itself is the answer.
      row = document.createElement("div");
      row.className = "share-similar-act";
      fill(row);
    }
  }
  if (art) row.classList.add("has-art");
  return row;
}

/*
 * A row's cover, in a box that holds its place whether or not the image ever
 * arrives.
 *
 * THE TILE IS ALWAYS THERE AND THE IMAGE IS WHAT IS OPTIONAL. These covers
 * come from a third party (Deezer, for a record the library does not have),
 * so some fraction of them will 404, be blocked, or simply not exist — and
 * an <img> with a dead src draws the browser's broken-image glyph, which
 * reads as "this app is broken" rather than "this record has no cover". On
 * error the img removes itself and the empty tile stands, so every row keeps
 * the same shape either way.
 */
function rowArt(url) {
  const box = document.createElement("span");
  box.className = "row-art";
  // What this tile was ASKED for, kept on the box rather than only on the
  // img: the img removes itself when the cover does not load, and without
  // this there is then nothing left to say which URL was tried — neither for
  // a person looking at the row nor for a test asserting that an in-library
  // record used Roon's art rather than a streaming service's.
  box.dataset.artSrc = url;
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = "";
  img.addEventListener("error", () => {
    box.dataset.artFailed = "1";
    if (img.parentNode) img.parentNode.removeChild(img);
  });
  img.src = url;
  box.appendChild(img);
  return box;
}

function renderSimilar(acts) {
  if (!similarEl || !similarLs) return;
  similarLs.innerHTML = "";
  for (const act of (acts || [])) {
    if (!act || !act.name) continue;
    // An act whose records could not be named is still worth showing, so the
    // record line is optional rather than the row being dropped.
    const sub = act.album
      ? (act.year ? act.album + " \u00b7 " + act.year : act.album) : "";
    const row = goRow(act, act.name, sub);
    row.setAttribute("data-parity", "share-card.act");
    // Why it is here (v0.7.6): near which of your acts, or one you know
    // with a record you don't have.
    if (act.reason) {
      const why = document.createElement("span");
      why.className = "share-similar-why";
      why.textContent = act.reason;
      row.appendChild(why);
    }
    similarLs.appendChild(row);
  }
  similarEl.classList.toggle("hidden", !similarLs.children.length);
}

function tagEl(text) {
  const t = document.createElement("span");
  t.className = "share-similar-tag";
  t.textContent = text;
  return t;
}

/*
 * Queue a suggestion that is in the library.
 *
 * Sends the LIBRARY's title and artist, not Deezer's: /api/play compares the
 * identity against what sits at the offset and relocates or refuses when
 * they disagree, and Deezer's punctuation is not Roon's.
 */
async function queueSuggestion(act, row) {
  const zone = (window.__selectedZoneId && window.__selectedZoneId()) || null;
  if (!zone) { if (window.__showToast) window.__showToast("Pick a zone first", "err"); return; }
  if (row.dataset.busy === "1") return;
  row.dataset.busy = "1";
  const tag = row.querySelector(".share-similar-tag");
  const was = tag ? tag.textContent : "";
  if (tag) tag.textContent = "\u2026";
  try {
    const r = await fetch("/api/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset:   act.offset,
        title:    act.library_title    || act.album || "",
        subtitle: act.library_subtitle || "",
        zone_or_output_id: zone,
        kind: "queue",
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    if (typeof j.offset === "number" && j.offset >= 0) act.offset = j.offset;
    if (tag) tag.textContent = "Queued";
    if (window.__showToast) window.__showToast("Queued " + (act.album || act.name), "ok");
  } catch (e) {
    if (tag) tag.textContent = was;
    if (window.__showToast) window.__showToast("Couldn't queue that", "err");
  } finally {
    row.dataset.busy = "";
  }
}

function renderLinks(links) {
  if (!linksEl) return;
  lastLinks = links || null;
  linksEl.innerHTML = "";
  const all = [
    ...((links && links.services) || []).map(l => ({ link: l, review: false })),
    ...((links && links.reviews)  || []).map(l => ({ link: l, review: true  })),
  ];
  for (const { link, review } of all) {
    if (!link || !link.url) continue;
    const a = document.createElement("a");
    a.className = "share-link" + (review ? " is-review" : ""); a.setAttribute("data-parity", "share-card.link");
    a.href = link.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    // textContent, not innerHTML: the label is a constant today, and this is
    // what keeps it harmless if it ever stops being one.
    a.textContent = link.chip || link.name || link.id;
    // Only a SERVICE can be the default — a review site is not somewhere to
    // hear a record, so holding one does nothing.
    if (!review) {
      a.dataset.service = link.id;
      holdToPrefer(a, link.id);
    }
    linksEl.appendChild(a);
  }
  // An empty row is a gap under the card, not a row.
  linksEl.classList.toggle("hidden", !linksEl.children.length);
  markPreferredChip();
}

/*
 * An iOS app added to the home screen, as opposed to iOS in a browser tab.
 *
 * Two separate facts, and both are needed. `navigator.standalone` is the
 * iOS-only flag for a home-screen launch; the display-mode query is the
 * standard one and covers an installed app elsewhere. The platform test is
 * what keeps this from firing on an installed desktop PWA, where downloading
 * works perfectly well — and it checks maxTouchPoints because an iPad reports
 * its platform as "MacIntel" and is indistinguishable from a Mac without it.
 */
function iosStandalone() {
  try {
    const p = (navigator.platform || "") + " " + (navigator.userAgent || "");
    const isIOS = /iPhone|iPad|iPod/.test(p) ||
                  (/Mac/.test(p) && (navigator.maxTouchPoints || 0) > 1);
    if (!isIOS) return false;
    if (navigator.standalone === true) return true;
    return !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  } catch (e) {
    // A UA sniff that throws must not take the share sheet with it; the
    // download button is the safe answer because it is what every other
    // platform gets.
    return false;
  }
}

function buildActions(blob, title, artist) {
  actions.innerHTML = "";
  const fileName =
    `${(artist || "artist").replace(/[^a-z0-9]+/gi, "_")}-` +
    `${(title  || "card"  ).replace(/[^a-z0-9]+/gi, "_")}.png`;

  const canShare = (() => {
    try {
      if (!navigator.share || !navigator.canShare) return false;
      const probe = new File([new Uint8Array([0])], "p.png", { type: "image/png" });
      return navigator.canShare({ files: [probe] });
    } catch { return false; }
  })();
  const canCopy = typeof window.ClipboardItem !== "undefined"
    && navigator.clipboard && typeof navigator.clipboard.write === "function";

  if (canCopy) {
    const b = mkBtn("ghost", icon("copy"), "Copy image", "share-card.copy");
    b.onclick = async () => {
      try {
        await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
        setLabel(b, "Copied!"); setTimeout(() => setLabel(b, "Copy image"), 2000);
      } catch (e) { errEl.textContent = e.message || String(e); }
    };
    actions.appendChild(b);
  }
  if (canShare) {
    const b = mkBtn("primary", icon("share"), "Share…", "share-card.share");
    b.onclick = async () => {
      try {
        const file = new File([blob], fileName, { type: "image/png" });
        await navigator.share({ files: [file] });
      } catch (e) { if (e && e.name !== "AbortError") errEl.textContent = e.message || String(e); }
    };
    actions.appendChild(b);
  }
  // NOT on an installed iOS app. `<a download>` is not implemented in WebKit
  // on iOS — the attribute is ignored, so the button either navigates away
  // from the app to a blob: URL or does nothing at all, and in a standalone
  // PWA there is no browser chrome to get back from it. Long-pressing the
  // image gives the real Save Image, which is what the hint already says.
  //
  // Narrowed to STANDALONE rather than to iOS: in Safari proper the tab is
  // still there to return from, and on every other platform it works.
  // In the Android app (v0.6.0-RC4): a download link does nothing in its
  // WebView, so the app saves the card itself — to Pictures/Mandarin.
  const app = window.MusicDShare;
  if (app && typeof app.saveImage === "function") {
    const b = mkBtn("ghost", icon("download"), "Download", "share-card.download");
    b.onclick = async () => {
      try {
        const url = await blobToDataUrl(blob);
        const ok = app.saveImage(String(url).slice(String(url).indexOf(",") + 1), fileName, "image/png");
        setLabel(b, ok ? "Saved to Pictures" : "Couldn’t save");
        setTimeout(() => setLabel(b, "Download"), 2500);
      } catch (e) { errEl.textContent = e.message || String(e); }
    };
    actions.appendChild(b);
  } else if (!iosStandalone()) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName; a.setAttribute("data-parity", "share-card.download");
    a.appendChild(document.createTextNode(""));
    a.innerHTML = `${icon("download")}<span>Download</span>`;
    actions.appendChild(a);
  }

  hintEl.textContent = (canCopy || canShare)
    ? "Tap a button above, or long-press the card to save."
    : "Long-press the card to save.";
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}
function mkBtn(cls, iconSvg, label, key) {
  const b = document.createElement("button");
  b.className = cls; b.setAttribute("data-parity", key);
  b.type = "button";
  b.innerHTML = `${iconSvg}<span>${label}</span>`;
  return b;
}
function setLabel(btn, text) {
  const s = btn.querySelector("span");
  if (s) s.textContent = text;
}
function icon(name) {
  const I = {
    share:    '<polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>',
    copy:     '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ""}</svg>`;
}

// Wire the share button inside the album modal
if (modalBtn) {
  modalBtn.addEventListener("click", () => {
    // On the now-playing screen read the live zone state directly via
    // window.__getCurrentNp() (not a mirrored global) so the card always
    // reflects the current track, not the album that was playing when the
    // modal first opened, regardless of which modal tab is active.
    const npModal = document.getElementById("album-modal");
    const isNp = npModal && npModal.classList.contains("np-mode");
    const np = isNp && window.__getCurrentNp && window.__getCurrentNp();
    if (np) {
      openShare({ title: np.line3 || "", artist: np.line2 || "", image_key: np.image_key });
      return;
    }
    const a = window.__currentAlbum;
    if (!a) return;
    openShare({ title: a.title || "", artist: a.subtitle || "", image_key: a.image_key });
  });
}
